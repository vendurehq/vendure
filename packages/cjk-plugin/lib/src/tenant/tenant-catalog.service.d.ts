import { ChannelService, Collection, CollectionService, ID, Product, RequestContext, TransactionalConnection, Translated } from '@vendure/core';
import { CreateCollectionInput } from '@vendure/common/lib/generated-types';
export declare class TenantCatalogService {
    private collectionService;
    private channelService;
    private connection;
    constructor(collectionService: CollectionService, channelService: ChannelService, connection: TransactionalConnection);
    /** 是否平台超管（沿用 my-access 的口径：session.user.superAdmin 或任一渠道角色含 SuperAdmin） */
    private isSuperAdmin;
    /** 目标渠道必须属于操作者的 channelPermissions（或超管），防止跨租户操作他人渠道 */
    private assertChannelAccess;
    /** 商品必须属于当前请求渠道，防止 A 店改 B 店商品 */
    private assertProductInChannel;
    /**
     * 分类归属校验：超管放行；否则分类须挂当前渠道（租户自有分类）
     * 或挂默认渠道（平台公共分类，租户归位时允许追加商品）。
     */
    private assertCollectionAccess;
    /** 解析 productIds 参数值：Vendure ConfigArg 中 list 型参数以 JSON 字符串存储（如 '[60]' / '["60"]'），兼容数组。 */
    private parseIdList;
    /**
     * 创建租户分类后，主动从默认渠道摘除，实现「租户分类只挂租户渠道、进默认商城」双轨隔离。
     * 不能走 removeCollectionsFromChannel（会对默认渠道抛错），须直接 channelService.removeFromChannels。
     */
    createTenantCollection(ctx: RequestContext, input: CreateCollectionInput): Promise<Translated<Collection>>;
    /** 把商品 ID 追加进平台分类的 productId 过滤器（只增；非 productId 独过滤器则新建一条 productId 过滤器，不改其它过滤器）。 */
    addProductToCollection(ctx: RequestContext, productId: ID, collectionId: ID): Promise<void>;
    /**
     * 把商品挂到租户渠道并从默认渠道摘除（双轨隔离）。
     * 不能走 removeProductsFromChannel（会被「默认渠道不可摘除」守卫拦），须直接 channelService.removeFromChannels。
     */
    moveProductsToTenantChannel(ctx: RequestContext, productIds: ID[], channelId: ID): Promise<Product[]>;
}
