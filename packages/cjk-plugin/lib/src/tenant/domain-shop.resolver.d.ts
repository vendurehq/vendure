import { RequestContext } from '@vendure/core';
import { DomainResolverService, DomainResolveResult, ChannelResolveResult, ShopChannelEntry } from './domain-resolver.service';
export declare class DomainShopResolver {
    private domainResolverService;
    constructor(domainResolverService: DomainResolverService);
    resolveChannelByDomain(ctx: RequestContext, host: string): Promise<DomainResolveResult | null>;
    resolveChannelByCode(ctx: RequestContext, code: string): Promise<ChannelResolveResult | null>;
    /** 全部「可用店铺」列表（已停用渠道不返回）：多租户路由判定 + 店铺切换器的公开数据源。
     *  token 仅当前渠道有值，其余为 null（避免公开批量下发全部渠道 token）。 */
    shopChannels(ctx: RequestContext): Promise<ShopChannelEntry[]>;
}
