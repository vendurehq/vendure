import { Args, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, Permission, RequestContext } from '@vendure/core';
import { CampusPermissions } from './permissions';
import { CampusAdService } from './campus-ad.service';

/**
 * P2-3 广告位与商家自助投放计费（admin-api）。
 * - 商家（CampusMerchant）：看广告位报价、下单、模拟支付、取消
 * - 平台（CampusConfig）：按渠道查投放单、审核通过/驳回
 *
 * 注意：admin/shop 两套 schema 字段不同，resolver 必须拆开注册，
 * 否则任一侧缺失字段都会在启动时报 "defined in resolvers, but not in schema"。
 */
@Resolver()
export class CampusAdAdminResolver {
    constructor(private ads: CampusAdService) {}

    @Query()
    @Allow(CampusPermissions.CampusMerchant as any, CampusPermissions.CampusConfig as any)
    async campusAdSlots() {
        return this.ads.slotList();
    }

    @Query()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantAds(@Ctx() ctx: RequestContext) {
        return this.ads.merchantList(ctx);
    }

    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantCreateAd(
        @Ctx() ctx: RequestContext,
        @Args('slot') slot: string,
        @Args('title') title: string,
        @Args('startDate') startDate: string,
        @Args('endDate') endDate: string,
        @Args({ name: 'imageUrl', nullable: true }) imageUrl?: string | null,
        @Args({ name: 'linkUrl', nullable: true }) linkUrl?: string | null,
    ) {
        return this.ads.create(ctx, { slot, title, startDate, endDate, imageUrl, linkUrl });
    }

    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantPayAd(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.ads.pay(ctx, id);
    }

    @Mutation()
    @Allow(CampusPermissions.CampusMerchant as any)
    async campusMerchantCancelAd(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.ads.cancel(ctx, id);
    }

    @Query()
    @Allow(CampusPermissions.CampusConfig as any)
    async campusAdCampaigns(
        @Ctx() ctx: RequestContext,
        @Args({ name: 'status', nullable: true }) status?: string | null,
        @Args({ name: 'channelId', type: () => String, nullable: true }) channelId?: string | null,
        @Args({ name: 'skip', type: () => Int, nullable: true }) skip?: number | null,
        @Args({ name: 'take', type: () => Int, nullable: true }) take?: number | null,
    ) {
        return this.ads.adminList(ctx, status, channelId, skip ?? 0, take ?? 20);
    }

    @Mutation()
    @Allow(CampusPermissions.CampusConfig as any)
    async campusReviewAd(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
        @Args('approve') approve: boolean,
        @Args({ name: 'note', nullable: true }) note?: string | null,
    ) {
        return this.ads.review(ctx, id, approve, note);
    }
}

/** P2-3 广告位（shop-api）：C 端公开只读取当前在投广告 */
@Resolver()
export class CampusAdShopResolver {
    constructor(private ads: CampusAdService) {}

    @Query()
    @Allow(Permission.Public)
    async campusActiveAds(@Ctx() ctx: RequestContext, @Args('slot') slot: string) {
        return this.ads.activeAds(ctx, slot);
    }
}
