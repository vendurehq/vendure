import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { OrderListOptions } from '@vendure/common/lib/generated-types';
import { Allow, Ctx, Order, Permission, RequestContext, Transaction, TransactionalConnection } from '@vendure/core';

import { MarketplaceService } from '../marketplace.service';
import { MerchantApiTokenService } from '../merchant-api-token.service';

@Resolver()
export class AdminMarketplaceResolver {
    constructor(
        private marketplaceService: MarketplaceService,
        private connection: TransactionalConnection,
        private merchantApiTokenService: MerchantApiTokenService,
    ) {}

    /** 为指定商家渠道签发 merchant-api 令牌（仅平台超管） */
    @Mutation('issueMerchantApiToken')
    @Allow(Permission.SuperAdmin)
    issueMerchantApiToken(
        @Args() args: { channelId: string; ttlSeconds?: number },
    ): { token: string; expiresAt: string } {
        const ttl = args.ttlSeconds && args.ttlSeconds > 0 ? args.ttlSeconds : 24 * 60 * 60;
        return {
            token: this.merchantApiTokenService.issue(args.channelId, ttl),
            expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
        };
    }

    @Mutation('approveMarketplaceProduct')
    @Transaction()
    @Allow(Permission.UpdateProduct, Permission.SuperAdmin)
    async approveMarketplaceProduct(
        @Ctx() ctx: RequestContext,
        @Args() args: { productId: string },
    ): Promise<boolean> {
        await this.marketplaceService.approveMarketplaceProduct(ctx, args.productId);
        return true;
    }

    @Mutation('rejectMarketplaceProduct')
    @Transaction()
    @Allow(Permission.UpdateProduct, Permission.SuperAdmin)
    async rejectMarketplaceProduct(
        @Ctx() ctx: RequestContext,
        @Args() args: { productId: string; reason: string },
    ): Promise<boolean> {
        await this.marketplaceService.rejectMarketplaceProduct(ctx, args.productId, args.reason);
        return true;
    }

    @Mutation('submitForMarketplaceAdmin')
    @Transaction()
    @Allow(Permission.UpdateCatalog, Permission.UpdateProduct, Permission.SuperAdmin)
    async submitForMarketplaceAdmin(
        @Ctx() ctx: RequestContext,
        @Args() args: { productId: string },
    ): Promise<boolean> {
        await this.marketplaceService.submitForMarketplaceOwnedByChannel(ctx, args.productId, ctx.channelId);
        return true;
    }

    @Query('marketplacePendingProducts')
    @Allow(Permission.ReadProduct, Permission.SuperAdmin)
    async marketplacePendingProducts(@Ctx() ctx: RequestContext) {
        const products = await this.marketplaceService.getPendingProducts(ctx);
        return products as any;
    }

    @Query('approvedMarketplaceProducts')
    @Allow(Permission.ReadProduct, Permission.SuperAdmin)
    async approvedMarketplaceProducts(@Ctx() ctx: RequestContext) {
        const products = await this.marketplaceService.getApprovedProducts(ctx);
        return products as any;
    }

    @Query('platformCollections')
    @Allow(Permission.ReadProduct, Permission.SuperAdmin)
    async platformCollections(@Ctx() ctx: RequestContext) {
        return this.marketplaceService.getPlatformCollections(ctx);
    }

    @Mutation('setProductPlatformCategory')
    @Transaction()
    @Allow(Permission.UpdateProduct, Permission.SuperAdmin)
    async setProductPlatformCategory(
        @Ctx() ctx: RequestContext,
        @Args() args: { productId: string; collectionId?: string },
    ): Promise<boolean> {
        await this.marketplaceService.setProductPlatformCategory(ctx, args.productId, args.collectionId ?? '');
        return true;
    }

    @Query('marketplaceMerchantChannel')
    @Allow(Permission.ReadOrder)
    marketplaceMerchantChannel(@Ctx() ctx: RequestContext) {
        return ctx.channel;
    }

    @Query('merchantOrders')
    @Allow(Permission.ReadOrder)
    async merchantOrders(
        @Ctx() ctx: RequestContext,
        @Args() args: { saleSource?: string; options?: OrderListOptions },
    ) {
        const qb = this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder('order')
            .leftJoinAndSelect('order.channels', 'channel')
            .where('channel.id = :channelId', { channelId: ctx.channelId });
        const orders = await qb.getMany();
        const filtered = args.saleSource
            ? orders.filter(o => o.customFields?.saleSource === args.saleSource)
            : orders;
        const skip = args.options?.skip ?? 0;
        const take = args.options?.take ?? filtered.length;
        return {
            items: filtered.slice(skip, skip + take),
            totalItems: filtered.length,
        };
    }
}