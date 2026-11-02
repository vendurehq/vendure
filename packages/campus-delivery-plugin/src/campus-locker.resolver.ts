import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, Permission, RequestContext } from '@vendure/core';
import { CampusPermissions } from './permissions';
import { CampusLockerService, type LockerStationInput, type UnmannedChannelInput } from './campus-locker.service';

/**
 * P2-4 智能取餐柜 / 无人配送（admin-api）。
 * - 商家（CampusMerchant）：看本站点柜机、看无人配送通道状态
 * - 平台（CampusConfig）：站点增删改、无人配送通道配置
 *
 * 注意：admin/shop 两套 schema 字段不同，resolver 必须拆两个类注册，
 * 否则任一侧缺字段都会在启动时报 "defined in resolvers, but not in schema"。
 */
@Resolver()
export class CampusLockerAdminResolver {
    constructor(private lockers: CampusLockerService) {}

    @Query()
    @Allow(CampusPermissions.CampusMerchant as any, CampusPermissions.CampusConfig as any)
    async campusLockerStations(@Ctx() ctx: RequestContext) {
        return this.lockers.adminList(ctx);
    }

    @Mutation()
    @Allow(CampusPermissions.CampusConfig as any)
    async campusCreateLockerStation(@Ctx() ctx: RequestContext, @Args('input') input: LockerStationInput) {
        return this.lockers.create(ctx, input);
    }

    @Mutation()
    @Allow(CampusPermissions.CampusConfig as any)
    async campusUpdateLockerStation(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
        @Args('input') input: LockerStationInput,
    ) {
        return this.lockers.update(ctx, id, input);
    }

    @Mutation()
    @Allow(CampusPermissions.CampusConfig as any)
    async campusDeleteLockerStation(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.lockers.remove(ctx, id);
    }

    @Query()
    @Allow(CampusPermissions.CampusMerchant as any, CampusPermissions.CampusConfig as any)
    async campusUnmannedChannel(@Ctx() ctx: RequestContext) {
        return this.lockers.channel(ctx);
    }

    @Mutation()
    @Allow(CampusPermissions.CampusConfig as any)
    async campusUpdateUnmannedChannel(@Ctx() ctx: RequestContext, @Args('input') input: UnmannedChannelInput) {
        return this.lockers.updateChannel(ctx, input);
    }

    /** 调用占位：真实厂商 SDK 未接，当前只做配置校验 + 模拟受理（返回单号） */
    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any, CampusPermissions.CampusConfig as any)
    async campusRequestUnmannedDelivery(@Ctx() ctx: RequestContext, @Args('orderId') orderId: ID) {
        return this.lockers.requestDelivery(ctx, orderId);
    }
}

/** P2-4 智能取餐柜（shop-api）：C 端公开只读启用站点 + 无人配送是否开通 */
@Resolver()
export class CampusLockerShopResolver {
    constructor(private lockers: CampusLockerService) {}

    @Query()
    @Allow(Permission.Public)
    async campusLockerStations(@Ctx() ctx: RequestContext) {
        return this.lockers.shopList(ctx);
    }

    @Query()
    @Allow(Permission.Public)
    async campusUnmannedDeliveryChannel(@Ctx() ctx: RequestContext) {
        const ch = await this.lockers.channel(ctx);
        return { enabled: ch.enabled, provider: ch.provider, providerName: ch.providerName, integrated: ch.integrated };
    }
}
