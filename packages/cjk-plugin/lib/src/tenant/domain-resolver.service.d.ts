import { Channel, ChannelService, RequestContext } from '@vendure/core';
export interface DomainResolveResult {
    token: string;
    code: string;
}
export interface ChannelResolveResult {
    token: string;
    code: string;
    customFields: {
        shopName: string | null;
        shopLogo: string | null;
        billPayStoreImage: string | null;
        shopIntro: string | null;
        servicePhone: string | null;
        shopContent: string | null;
        displayTemplate: string | null;
        themeId: string | null;
    };
}
/** 公开的「可用店铺」条目：供 C 端列出全部渠道（nshop / vshop 共用），
 *  是多租户路由运行时判定与店铺切换器的唯一数据源。
 *  token 仅对「当前已解析渠道」返回（其余为 null），避免一次公开请求批量泄露全部渠道 token。 */
export interface ShopChannelEntry {
    code: string;
    token: string | null;
    name: string | null;
    tenantNo: number | null;
    isOfficial: boolean;
    isDefault: boolean;
}
/**
 * 按请求 Host 解析渠道（多租户路由/回调共用）。
 *
 * 使用 emptyCtx 跨 channel 查询，避免公共请求 ctx 的潜在 channel 过滤
 * （与 group-buy-plugin / distribution-plugin 的既定模式一致）。
 * 返回完整 Channel 实体，调用方可直接用于构造 RequestContext。
 */
export declare function findChannelByDomain(channelService: ChannelService, host: string): Promise<Channel | undefined>;
export declare function resolveChannelByDomain(channelService: ChannelService, host: string): Promise<DomainResolveResult | null>;
export declare class DomainResolverService {
    private channelService;
    constructor(channelService: ChannelService);
    resolveByDomain(ctx: RequestContext, host: string): Promise<DomainResolveResult | null>;
    /** Channel -> ChannelResolveResult 的统一映射（渠道 token 与装修 customFields） */
    private toResult;
    resolveByCode(ctx: RequestContext, code: string): Promise<ChannelResolveResult | null>;
    /** 列出全部「可用店铺」（公开信息：code / 店铺名 / 序号 / 官方 / 是否默认渠道）。
     *
     *  这是多租户「永久可达」的数据源：前端据此判定 URL 首段的真伪、渲染店铺切换器，
     *  无需把渠道清单烘焙进构建产物，新增/启用渠道后最长一个缓存周期（前端 SWR）即生效。
     *
     *  - 排除 customFields.enabled === false 的渠道（如临时验证渠道 t24）；
     *  - 包含默认渠道并标记 isDefault，供前端提供「返回平台店」入口；
     *  - 排序：默认渠道优先，其余按 code 升序（与历史 tenant-channels.json 口径一致）；
     *  - **token 只回填「当前已解析渠道」**：调用方自己的 token 本就在请求头里，
     *    其他渠道的 token 不应再由这个公开查询批量下发。 */
    listShopChannels(ctx: RequestContext): Promise<ShopChannelEntry[]>;
}
/**
 * Channel -> 公开店铺条目的纯函数映射（便于单测）。
 *
 * token 仅当 channel.id === 当前 ctx 渠道时返回，其余为 null；
 * 这样公开查询不再具备「一次拉全站渠道 token」的能力，但当前店铺自身仍可用。
 */
export declare function toShopChannelEntries(channels: Array<{
    id: unknown;
    code: string;
    token: string;
    customFields?: unknown;
}>, currentChannelId: unknown): ShopChannelEntry[];
