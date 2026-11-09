import { Allow, Ctx, Permission, RequestContext } from '@vendure/core';
import { Query, Resolver, Args } from '@nestjs/graphql';
import { DomainResolverService, DomainResolveResult, ChannelResolveResult, ShopChannelEntry } from './domain-resolver.service';

@Resolver()
export class DomainShopResolver {
    constructor(private domainResolverService: DomainResolverService) {}

    @Query()
    @Allow(Permission.Public)
    async resolveChannelByDomain(
        @Ctx() ctx: RequestContext,
        @Args('host') host: string,
    ): Promise<DomainResolveResult | null> {
        return this.domainResolverService.resolveByDomain(ctx, host);
    }

    @Query()
    @Allow(Permission.Public)
    async resolveChannelByCode(
        @Ctx() ctx: RequestContext,
        @Args('code') code: string,
    ): Promise<ChannelResolveResult | null> {
        return this.domainResolverService.resolveByCode(ctx, code);
    }

    /** 全部「可用店铺」列表（已停用渠道不返回）：多租户路由判定 + 店铺切换器的公开数据源。
     *  token 仅当前渠道有值，其余为 null（避免公开批量下发全部渠道 token）。 */
    @Query()
    @Allow(Permission.Public)
    async shopChannels(@Ctx() ctx: RequestContext): Promise<ShopChannelEntry[]> {
        return this.domainResolverService.listShopChannels(ctx);
    }
}
