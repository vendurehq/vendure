import { ID, RequestContext } from '@vendure/core';
import { CampusAdService } from './campus-ad.service';
/**
 * P2-3 广告位与商家自助投放计费（admin-api）。
 * - 商家（CampusMerchant）：看广告位报价、下单、模拟支付、取消
 * - 平台（CampusConfig）：按渠道查投放单、审核通过/驳回
 *
 * 注意：admin/shop 两套 schema 字段不同，resolver 必须拆开注册，
 * 否则任一侧缺失字段都会在启动时报 "defined in resolvers, but not in schema"。
 */
export declare class CampusAdAdminResolver {
    private ads;
    constructor(ads: CampusAdService);
    campusAdSlots(): Promise<{
        code: string;
        name: string;
        unitPriceFen: number;
    }[]>;
    campusMerchantAds(ctx: RequestContext): Promise<{
        status: string;
        live: boolean;
        channelId: ID;
        slot: string;
        title: string;
        imageUrl: string | null;
        linkUrl: string | null;
        startDate: string;
        endDate: string;
        days: number;
        unitPriceFen: number;
        totalFen: number;
        payRef: string | null;
        paidAt: Date | null;
        reviewNote: string | null;
        reviewedBy: string | null;
        reviewedAt: Date | null;
        createdBy: string | null;
        id: ID;
        createdAt: Date;
        updatedAt: Date;
    }[]>;
    campusMerchantCreateAd(ctx: RequestContext, slot: string, title: string, startDate: string, endDate: string, imageUrl?: string | null, linkUrl?: string | null): Promise<{
        status: string;
        live: boolean;
        channelId: ID;
        slot: string;
        title: string;
        imageUrl: string | null;
        linkUrl: string | null;
        startDate: string;
        endDate: string;
        days: number;
        unitPriceFen: number;
        totalFen: number;
        payRef: string | null;
        paidAt: Date | null;
        reviewNote: string | null;
        reviewedBy: string | null;
        reviewedAt: Date | null;
        createdBy: string | null;
        id: ID;
        createdAt: Date;
        updatedAt: Date;
    }>;
    campusMerchantPayAd(ctx: RequestContext, id: ID): Promise<{
        status: string;
        live: boolean;
        channelId: ID;
        slot: string;
        title: string;
        imageUrl: string | null;
        linkUrl: string | null;
        startDate: string;
        endDate: string;
        days: number;
        unitPriceFen: number;
        totalFen: number;
        payRef: string | null;
        paidAt: Date | null;
        reviewNote: string | null;
        reviewedBy: string | null;
        reviewedAt: Date | null;
        createdBy: string | null;
        id: ID;
        createdAt: Date;
        updatedAt: Date;
    }>;
    campusMerchantCancelAd(ctx: RequestContext, id: ID): Promise<{
        status: string;
        live: boolean;
        channelId: ID;
        slot: string;
        title: string;
        imageUrl: string | null;
        linkUrl: string | null;
        startDate: string;
        endDate: string;
        days: number;
        unitPriceFen: number;
        totalFen: number;
        payRef: string | null;
        paidAt: Date | null;
        reviewNote: string | null;
        reviewedBy: string | null;
        reviewedAt: Date | null;
        createdBy: string | null;
        id: ID;
        createdAt: Date;
        updatedAt: Date;
    }>;
    campusAdCampaigns(ctx: RequestContext, status?: string | null, channelId?: string | null, skip?: number | null, take?: number | null): Promise<{
        total: number;
        items: any[];
    }>;
    campusReviewAd(ctx: RequestContext, id: ID, approve: boolean, note?: string | null): Promise<{
        status: string;
        live: boolean;
        channelId: ID;
        slot: string;
        title: string;
        imageUrl: string | null;
        linkUrl: string | null;
        startDate: string;
        endDate: string;
        days: number;
        unitPriceFen: number;
        totalFen: number;
        payRef: string | null;
        paidAt: Date | null;
        reviewNote: string | null;
        reviewedBy: string | null;
        reviewedAt: Date | null;
        createdBy: string | null;
        id: ID;
        createdAt: Date;
        updatedAt: Date;
    }>;
}
/** P2-3 广告位（shop-api）：C 端公开只读取当前在投广告 */
export declare class CampusAdShopResolver {
    private ads;
    constructor(ads: CampusAdService);
    campusActiveAds(ctx: RequestContext, slot: string): Promise<{
        id: ID;
        slot: string;
        title: string;
        imageUrl: string | null;
        linkUrl: string | null;
        endDate: string;
    }[]>;
}
