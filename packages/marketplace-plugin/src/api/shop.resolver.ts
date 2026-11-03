import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
    Allow,
    Ctx,
    InternalServerError,
    LanguageCode,
    Permission,
    RequestContext,
    Transaction,
    TransactionalConnection,
} from '@vendure/core';
import { Product } from '@vendure/core';

import { MarketplaceSellerService } from '../marketplace-seller-service';
import { MarketplaceService } from '../marketplace.service';
import { CreateSellerInput } from '../types';

@Resolver()
export class ShopResolver {
    constructor(
        private marketplaceSellerService: MarketplaceSellerService,
        private marketplaceService: MarketplaceService,
        private connection: TransactionalConnection,
    ) {}

    /** Product.name/slug 为非实体列，需从 translations 取（优先当前语言，回退首个） */
    private translate(product: Product): { name?: string; slug?: string } {
        const translations = (product.translations ?? []) as Array<{
            languageCode: LanguageCode;
            name?: string;
            slug?: string;
        }>;
        return translations.find(t => t.languageCode === LanguageCode.zh_Hans) ?? translations[0] ?? {};
    }

    @Mutation('registerMarketplaceSeller')
    @Transaction()
    @Allow(Permission.Public)
    async registerMarketplaceSeller(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: { shopName: string; seller: CreateSellerInput } },
    ) {
        try {
            const channel = await this.marketplaceSellerService.registerMarketplaceSeller(ctx, args.input);
            return {
                __typename: 'RegisterMarketplaceSellerSuccess',
                id: channel.id,
                code: channel.code,
                token: channel.token,
            };
        } catch (e) {
            if (e instanceof InternalServerError) {
                return { __typename: 'RegisterMarketplaceSellerError', errorCode: 'INTERNAL_SERVER_ERROR', message: e.message };
            }
            throw e;
        }
    }

    /** 聚合列表项映射：product → GraphQL MarketplaceProduct */
    private toMarketplaceProduct(product: Product) {
        return {
            id: product.id,
            name: this.translate(product).name ?? '',
            slug: this.translate(product).slug ?? '',
            barcode: product.customFields.barcode ?? null,
            internalCode: product.customFields.internalCode ?? null,
            merchantChannel: product.customFields.merchantRef
                ? {
                      id: (product.customFields.merchantRef as any).id,
                      code: (product.customFields.merchantRef as any).code,
                      name:
                          (product.customFields.merchantRef as any).seller?.name ??
                          (product.customFields.merchantRef as any).code,
                  }
                : null,
        };
    }

    /** take 限定 1..100，skip 不得为负；未传时保持原行为（不限制） */
    private normalizePaging(take?: number | null, skip?: number | null) {
        return {
            take: take == null ? undefined : Math.min(Math.max(Math.trunc(take), 1), 100),
            skip: skip == null ? undefined : Math.max(Math.trunc(skip), 0),
        };
    }

    @Query('marketplaceProducts')
    @Allow(Permission.Public)
    async marketplaceProducts(
        @Ctx() ctx: RequestContext,
        @Args() args: { take?: number; skip?: number },
    ) {
        const paging = this.normalizePaging(args.take, args.skip);
        const products = await this.marketplaceService.getMarketplaceProducts(ctx, paging);
        return products.map(product => this.toMarketplaceProduct(product));
    }

    /** 分页版本：返回切片 + totalItems（不改变 marketplaceProducts 的返回类型） */
    @Query('marketplaceProductPage')
    @Allow(Permission.Public)
    async marketplaceProductPage(
        @Ctx() ctx: RequestContext,
        @Args() args: { take?: number; skip?: number },
    ) {
        const take = Math.min(Math.max(Math.trunc(args.take ?? 12), 1), 100);
        const skip = Math.max(Math.trunc(args.skip ?? 0), 0);
        const [products, totalItems] = await Promise.all([
            this.marketplaceService.getMarketplaceProducts(ctx, { take, skip }),
            this.marketplaceService.countMarketplaceProducts(ctx),
        ]);
        return {
            items: products.map(product => this.toMarketplaceProduct(product)),
            totalItems,
        };
    }

    @Mutation('submitForMarketplace')
    @Transaction()
    @Allow(Permission.UpdateCatalog, Permission.UpdateProduct)
    async submitForMarketplace(
        @Ctx() ctx: RequestContext,
        @Args() args: { productId: string },
    ): Promise<boolean> {
        await this.marketplaceService.submitForMarketplace(ctx, args.productId);
        return true;
    }

    @Query('myMerchantProducts')
    @Allow(Permission.ReadCatalog, Permission.ReadProduct)
    async myMerchantProducts(@Ctx() ctx: RequestContext) {
        const products = await this.connection.getRepository(ctx, Product).find({
            where: { channels: { id: ctx.channelId } } as any,
        });
        return products.map(product => ({
            id: product.id,
            name: this.translate(product).name ?? '',
            slug: this.translate(product).slug ?? '',
            barcode: product.customFields.barcode ?? null,
            internalCode: product.customFields.internalCode ?? null,
            marketplaceStatus: product.customFields.marketplaceStatus ?? 'pending',
            rejectReason: product.customFields.rejectReason ?? null,
            listedInMarketplace: product.customFields.listedInMarketplace ?? false,
        }));
    }

    @Query('marketplacePendingProducts')
    @Allow(Permission.SuperAdmin, Permission.UpdateProduct)
    async marketplacePendingProducts(@Ctx() ctx: RequestContext) {
        const products = await this.marketplaceService.getPendingProducts(ctx);
        return products.map(product => ({
            id: product.id,
            name: this.translate(product).name ?? '',
            slug: this.translate(product).slug ?? '',
            barcode: product.customFields.barcode ?? null,
            internalCode: product.customFields.internalCode ?? null,
            marketplaceStatus: product.customFields.marketplaceStatus ?? 'pending',
            rejectReason: product.customFields.rejectReason ?? null,
            listedInMarketplace: product.customFields.listedInMarketplace ?? false,
        }));
    }

    @Mutation('marketplaceApprove')
    @Transaction()
    @Allow(Permission.SuperAdmin, Permission.UpdateProduct)
    async marketplaceApprove(
        @Ctx() ctx: RequestContext,
        @Args() args: { productId: string },
    ): Promise<boolean> {
        await this.marketplaceService.approveMarketplaceProduct(ctx, args.productId);
        return true;
    }

    @Mutation('marketplaceReject')
    @Transaction()
    @Allow(Permission.SuperAdmin, Permission.UpdateProduct)
    async marketplaceReject(
        @Ctx() ctx: RequestContext,
        @Args() args: { productId: string; reason: string },
    ): Promise<boolean> {
        await this.marketplaceService.rejectMarketplaceProduct(ctx, args.productId, args.reason);
        return true;
    }
}