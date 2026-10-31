import { RequestContext } from '@vendure/core';
import { SearchAssistService } from './search-assist.service';
import { WaimaiStoreService } from './waimai-store.service';
export declare class WaimaiShopResolver {
    private stores;
    private assist;
    constructor(stores: WaimaiStoreService, assist: SearchAssistService);
    /** 公开只读：C 端首页店铺列表（跨渠道元数据聚合） */
    waimaiStoreList(ctx: RequestContext): Promise<import("./waimai-store.service").WaimaiStore[]>;
    /** 公开只读：当前渠道信任文案（§113）：评价页信任签名卡三行开关 + 自定义文案 */
    campusStoreTrust(ctx: RequestContext): Promise<import("./waimai-store.service").CampusStoreTrust>;
    /**
     * 公开只读：菜品每日限量/每人限购（§68）。
     * 未登录时 myToday/myRemaining 为 null；已登录返回本人当日已购与剩余。
     */
    campusProductDailyStock(ctx: RequestContext): Promise<{
        productId: number;
        dailyLimit: number | null;
        perUserLimit: number | null;
        soldToday: number;
        remaining: number | null;
        myToday: number | null;
        myRemaining: number | null;
    }[]>;
    /**
     * 公开只读：语音/拍照搜索识别（P2-2）。
     * 按当前渠道配置选择服务商（mock / none），返回可直接用于站内搜索的关键词。
     */
    campusSearchAssist(ctx: RequestContext, type: string, payload?: string): Promise<import("./search-assist.service").CampusSearchAssistResultShape>;
}
