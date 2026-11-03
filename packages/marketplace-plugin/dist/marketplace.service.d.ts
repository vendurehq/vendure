import { ChannelService, EntityHydrator, ID, Product, ProductService, RequestContext, TransactionalConnection } from '@vendure/core';
export interface MarketplaceProductsOptions {
    take?: number;
    skip?: number;
}
export declare class MarketplaceService {
    private connection;
    private entityHydrator;
    private channelService;
    private productService;
    constructor(connection: TransactionalConnection, entityHydrator: EntityHydrator, channelService: ChannelService, productService: ProductService);
    /** 校验条形码在平台内唯一（跨所有 Channel）。返回所属 ProductId 与首个 VariantId；空则无冲突。 */
    findBarcodeOwner(barcode: string): Promise<{
        productId: ID;
        variantId: ID;
    } | null>;
    /** 保存前校验：若 barcode 已被其他商品占用则抛错 */
    assertBarcodeUnique(barcode: string, excludeProductId?: ID): Promise<void>;
    getProductOrThrow(ctx: RequestContext, productId: ID): Promise<Product>;
    /** 校验商品归属指定渠道后可提交上架（供 admin API，防止商户提审他人商品） */
    submitForMarketplaceOwnedByChannel(ctx: RequestContext, productId: ID, channelId: ID): Promise<void>;
    /** 商家提交商品上架 marketplace（置审批中，不对外展示） */
    submitForMarketplace(ctx: RequestContext, productId: ID): Promise<void>;
    /** 平台运营/超管审批通过：对外展示 */
    approveMarketplaceProduct(ctx: RequestContext, productId: ID): Promise<void>;
    /**
     * 内置轻量归位：根据商品在租户侧的分类名（tenantCategoryRef）+ 该租户渠道上的 categoryMapping，
     * 映射到默认商城平台分类；未命中则标记待归类。同时把商品补挂默认渠道
     * （assignProductsToChannel 一并迁移变体/资产/规格组）。
     */
    private placeIntoTenantCategory;
    /** 平台运营/超管驳回：不展示，记录原因 */
    rejectMarketplaceProduct(ctx: RequestContext, productId: ID, reason: string): Promise<void>;
    /** 待审批商品列表 */
    getPendingProducts(ctx: RequestContext): Promise<Product[]>;
    /** 已过审（approved）商品列表：供运营查看分类归属 / 手动归类 */
    getApprovedProducts(ctx: RequestContext): Promise<Product[]>;
    /**
     * 平台（默认租户）分类列表：审批手动归类 / 租户归位映射下拉用。
     * 始终基于 default channel，而不是登录运营/商户所在租户渠道的分类。
     */
    getPlatformCollections(ctx: RequestContext): Promise<Array<{
        id: string;
        name: string;
        parentId: string | null;
    }>>;
    /** 运营手动归类已过审商品：collectionId 为空 → 置待归类；否则写入平台分类并清标记 */
    setProductPlatformCategory(ctx: RequestContext, productId: ID, collectionId: string): Promise<void>;
    /** marketplace 聚合商品过滤条件：已审批且已上架 */
    private marketplaceProductsWhere;
    /** 聚合 marketplace 商品总数（与 getMarketplaceProducts 使用同一过滤条件） */
    countMarketplaceProducts(ctx: RequestContext): Promise<number>;
    /**
     * 聚合 marketplace 对外展示的商品（自营 + 各商家）。
     * 仅返回 marketplaceStatus='approved' 且 listedInMarketplace=true 的商品，
     * 并 hydrate 商家渠道（merchantRef）与商品主图（featuredAsset），供前端按商家分组展示。
     * relation custom field 存储于独立 junction 表，故用 EntityHydrator 加载最稳妥。
     */
    getMarketplaceProducts(ctx: RequestContext, options?: MarketplaceProductsOptions): Promise<Product[]>;
}
