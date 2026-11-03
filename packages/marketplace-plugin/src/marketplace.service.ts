import { Injectable } from '@nestjs/common';
import {
    Channel,
    ChannelService,
    Collection,
    EntityHydrator,
    ID,
    idsAreEqual,
    Logger,
    Product,
    ProductService,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import {
    MARKETPLACE_STATUS_APPROVED,
    MARKETPLACE_STATUS_PENDING,
    MARKETPLACE_STATUS_REJECTED,
} from './constants';

export interface MarketplaceProductsOptions {
    take?: number;
    skip?: number;
}

@Injectable()
export class MarketplaceService {
    constructor(
        private connection: TransactionalConnection,
        private entityHydrator: EntityHydrator,
        private channelService: ChannelService,
        private productService: ProductService,
    ) {}

    /** 校验条形码在平台内唯一（跨所有 Channel）。返回所属 ProductId 与首个 VariantId；空则无冲突。 */
    async findBarcodeOwner(barcode: string): Promise<{ productId: ID; variantId: ID } | null> {
        if (!barcode) return null;
        const repo = this.connection.rawConnection.getRepository(Product);
        const product = await repo.findOne({
            where: { customFields: { barcode } as any },
            relations: ['variants'],
        });
        if (!product || !product.variants || product.variants.length === 0) {
            return null;
        }
        return { productId: product.id, variantId: product.variants[0].id };
    }

    /** 保存前校验：若 barcode 已被其他商品占用则抛错 */
    async assertBarcodeUnique(barcode: string, excludeProductId?: ID): Promise<void> {
        const owner = await this.findBarcodeOwner(barcode);
        if (owner && (!excludeProductId || owner.productId !== excludeProductId)) {
            throw new UserInputError(`条形码 ${barcode} 已被占用`);
        }
    }

    async getProductOrThrow(ctx: RequestContext, productId: ID): Promise<Product> {
        const product = await this.connection.getRepository(ctx, Product).findOne({
            where: { id: productId as any },
        });
        if (!product) {
            throw new UserInputError('商品不存在');
        }
        return product;
    }

    /** 校验商品归属指定渠道后可提交上架（供 admin API，防止商户提审他人商品） */
    async submitForMarketplaceOwnedByChannel(
        ctx: RequestContext,
        productId: ID,
        channelId: ID,
    ): Promise<void> {
        const product = await this.getProductOrThrow(ctx, productId);
        await this.entityHydrator.hydrate(ctx, product, { relations: ['channels'] } as any);
        const owned = (product.channels || []).some(c => idsAreEqual(c.id, channelId));
        if (!owned && channelId != null) {
            throw new UserInputError('只能对当前店铺的商品提交上架');
        }
        await this.submitForMarketplace(ctx, productId);
    }

    /** 商家提交商品上架 marketplace（置审批中，不对外展示） */
    async submitForMarketplace(ctx: RequestContext, productId: ID): Promise<void> {
        const product = await this.getProductOrThrow(ctx, productId);
        if (product.customFields.barcode) {
            await this.assertBarcodeUnique(product.customFields.barcode, productId);
        }
        product.customFields.listedInMarketplace = false;
        product.customFields.marketplaceStatus = MARKETPLACE_STATUS_PENDING;
        product.customFields.rejectReason = undefined;
        await this.connection.getRepository(ctx, Product).save(product);
    }

    /** 平台运营/超管审批通过：对外展示 */
    async approveMarketplaceProduct(ctx: RequestContext, productId: ID): Promise<void> {
        const product = await this.getProductOrThrow(ctx, productId);
        // 商家商品归属于 default + 商家渠道：merchantRef 指向非默认渠道（与分单策略一致）。
        // 仅属于 default 的自营商品则 merchantRef 保持 null。
        await this.entityHydrator.hydrate(ctx, product, { relations: ['channels'] } as any);
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        const nonDefaultChannel = product.channels?.find(c => !idsAreEqual(c.id, defaultChannel.id));
        product.customFields.merchantRef = nonDefaultChannel ? (nonDefaultChannel.id as any) : null;
        product.customFields.marketplaceStatus = MARKETPLACE_STATUS_APPROVED;
        product.customFields.listedInMarketplace = true;
        product.customFields.rejectReason = undefined;
        // —— 内置轻量归位：按租户分类名 → 平台分类映射，补挂默认渠道并标记待归类 ——
        try {
            await this.placeIntoTenantCategory(ctx, product);
        } catch (e: any) {
            Logger.warn(`产品 ${String(productId)} 归位失败: ${(e as Error)?.message ?? e}`, 'Marketplace');
            (product.customFields as any).needsCategorization = true;
        }
        await this.connection.getRepository(ctx, Product).save(product);
    }

    /**
     * 内置轻量归位：根据商品在租户侧的分类名（tenantCategoryRef）+ 该租户渠道上的 categoryMapping，
     * 映射到默认商城平台分类；未命中则标记待归类。同时把商品补挂默认渠道
     * （assignProductsToChannel 一并迁移变体/资产/规格组）。
     */
    private async placeIntoTenantCategory(ctx: RequestContext, product: any): Promise<void> {
        await this.entityHydrator.hydrate(ctx, product, { relations: ['channels'] } as any);
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        const tenantChannel = (product.channels ?? []).find((c: any) => !idsAreEqual(c.id, defaultChannel.id));
        const tenantCategoryRef = product.customFields?.tenantCategoryRef;
        let mapping: Array<{ tenantCategory: string; collectionId: string }> = [];
        if (tenantChannel) {
            const channelRepo = this.connection.rawConnection.getRepository(Channel);
            const tenant = await channelRepo.findOne({ where: { id: String((tenantChannel as any).id) } } as any);
            const rawMap = (tenant as any)?.customFields?.categoryMapping;
            if (Array.isArray(rawMap)) mapping = rawMap;
        }
        const hit = tenantCategoryRef ? mapping.find(m => m.tenantCategory === tenantCategoryRef) : undefined;
        const alreadyOnDefault = (product.channels ?? []).some((c: any) => idsAreEqual(c.id, defaultChannel.id));
        if (!alreadyOnDefault) {
            await this.productService.assignProductsToChannel(ctx, {
                channelId: defaultChannel.id,
                productIds: [String(product.id)],
                priceFactor: 1,
            } as any);
        }
        if (hit?.collectionId) {
            product.customFields.needsCategorization = false;
            product.customFields.platformCategoryId = hit.collectionId;
        } else {
            product.customFields.needsCategorization = true;
            product.customFields.platformCategoryId = null;
        }
    }

    /** 平台运营/超管驳回：不展示，记录原因 */
    async rejectMarketplaceProduct(ctx: RequestContext, productId: ID, reason: string): Promise<void> {
        const product = await this.getProductOrThrow(ctx, productId);
        product.customFields.marketplaceStatus = MARKETPLACE_STATUS_REJECTED;
        product.customFields.listedInMarketplace = false;
        product.customFields.rejectReason = reason;
        await this.connection.getRepository(ctx, Product).save(product);
    }

    /** 待审批商品列表 */
    async getPendingProducts(ctx: RequestContext): Promise<Product[]> {
        return this.connection.getRepository(ctx, Product).find({
            where: { customFields: { marketplaceStatus: MARKETPLACE_STATUS_PENDING } as any },
        });
    }

    /** 已过审（approved）商品列表：供运营查看分类归属 / 手动归类 */
    async getApprovedProducts(ctx: RequestContext): Promise<Product[]> {
        return this.connection.getRepository(ctx, Product).find({
            where: { customFields: { marketplaceStatus: MARKETPLACE_STATUS_APPROVED } as any },
        });
    }

    /**
     * 平台（默认租户）分类列表：审批手动归类 / 租户归位映射下拉用。
     * 始终基于 default channel，而不是登录运营/商户所在租户渠道的分类。
     */
    async getPlatformCollections(
        ctx: RequestContext,
    ): Promise<Array<{ id: string; name: string; parentId: string | null }>> {
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        const repo = this.connection.rawConnection.getRepository(Collection);
        const all = await repo.find({ relations: ['translations', 'channels', 'parent'] });
        return all
            .filter((c: any) => (c.channels || []).some((ch: any) => idsAreEqual(ch.id, defaultChannel.id)))
            .map((c: any) => ({
                id: String(c.id),
                name: (c.translations?.find?.((t: any) => t.languageCode === 'zh_Hans')?.name) ||
                    c.translations?.[0]?.name ||
                    String(c.id),
                parentId: c.parent ? String(c.parent.id) : null,
            }));
    }

    /** 运营手动归类已过审商品：collectionId 为空 → 置待归类；否则写入平台分类并清标记 */
    async setProductPlatformCategory(
        ctx: RequestContext,
        productId: ID,
        collectionId: string,
    ): Promise<void> {
        const product = await this.getProductOrThrow(ctx, productId);
        (product.customFields as any).platformCategoryId = collectionId || null;
        (product.customFields as any).needsCategorization = !collectionId;
        await this.connection.getRepository(ctx, Product).save(product);
    }

    /** marketplace 聚合商品过滤条件：已审批且已上架 */
    private marketplaceProductsWhere() {
        return {
            customFields: {
                marketplaceStatus: MARKETPLACE_STATUS_APPROVED,
                listedInMarketplace: true,
            } as any,
        };
    }

    /** 聚合 marketplace 商品总数（与 getMarketplaceProducts 使用同一过滤条件） */
    async countMarketplaceProducts(ctx: RequestContext): Promise<number> {
        return this.connection.getRepository(ctx, Product).count({
            where: this.marketplaceProductsWhere(),
        });
    }

    /**
     * 聚合 marketplace 对外展示的商品（自营 + 各商家）。
     * 仅返回 marketplaceStatus='approved' 且 listedInMarketplace=true 的商品，
     * 并 hydrate 商家渠道（merchantRef）与商品主图（featuredAsset），供前端按商家分组展示。
     * relation custom field 存储于独立 junction 表，故用 EntityHydrator 加载最稳妥。
     */
    async getMarketplaceProducts(
        ctx: RequestContext,
        options?: MarketplaceProductsOptions,
    ): Promise<Product[]> {
        const products = await this.connection.getRepository(ctx, Product).find({
            where: this.marketplaceProductsWhere(),
            // 稳定排序，保证 skip/take 分页切片确定（不传分页参数时输出顺序也固定）
            order: { id: 'ASC' },
            take: options?.take,
            skip: options?.skip,
        });
        for (const product of products) {
            await this.entityHydrator.hydrate(ctx, product, {
                relations: ['customFields.merchantRef.seller', 'featuredAsset'],
            });
        }
        return products;
    }
}