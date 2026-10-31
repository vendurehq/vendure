import { Args, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext } from '@vendure/core';
import { SearchAssistService } from './search-assist.service';
import { WaimaiStoreService } from './waimai-store.service';

@Resolver()
export class WaimaiShopResolver {
    constructor(
        private stores: WaimaiStoreService,
        private assist: SearchAssistService,
    ) {}

    /** 公开只读：C 端首页店铺列表（跨渠道元数据聚合） */
    @Query()
    @Allow(Permission.Public)
    async waimaiStoreList(@Ctx() ctx: RequestContext) {
        return this.stores.listStores(ctx);
    }

    /** 公开只读：当前渠道信任文案（§113）：评价页信任签名卡三行开关 + 自定义文案 */
    @Query()
    @Allow(Permission.Public)
    async campusStoreTrust(@Ctx() ctx: RequestContext) {
        return this.stores.trustCopy(ctx);
    }

    /**
     * 公开只读：菜品每日限量/每人限购（§68）。
     * 未登录时 myToday/myRemaining 为 null；已登录返回本人当日已购与剩余。
     */
    @Query()
    @Allow(Permission.Public)
    async campusProductDailyStock(@Ctx() ctx: RequestContext) {
        return this.stores.dailyStock(ctx);
    }

    /**
     * 公开只读：语音/拍照搜索识别（P2-2）。
     * 按当前渠道配置选择服务商（mock / none），返回可直接用于站内搜索的关键词。
     */
    @Query()
    @Allow(Permission.Public)
    async campusSearchAssist(
        @Ctx() ctx: RequestContext,
        @Args('type') type: string,
        @Args('payload', { nullable: true }) payload?: string,
    ) {
        return this.assist.assist(ctx, type, payload);
    }
}
