import { ID, RequestContext, TransactionalConnection } from '@vendure/core';
export interface AdCampaignInput {
    slot: string;
    title: string;
    imageUrl?: string | null;
    linkUrl?: string | null;
    startDate: string;
    endDate: string;
}
export declare class CampusAdService {
    private connection;
    constructor(connection: TransactionalConnection);
    private repo;
    private today;
    /** 对外视图：status 按日期改写为 finished，并给出 live */
    private toView;
    slotList(): {
        code: string;
        name: string;
        unitPriceFen: number;
    }[];
    /** 商家侧：本渠道投放单（最近 50 条） */
    merchantList(ctx: RequestContext): Promise<{
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
    /** 商家下单：校验广告位与素材，按下单当时的单价固化总价，状态 pendingPay */
    create(ctx: RequestContext, input: AdCampaignInput): Promise<{
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
    /** 商家支付（模拟）：生成支付流水号并转待审核；重复支付幂等返回 */
    pay(ctx: RequestContext, id: ID): Promise<{
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
    /** 商家取消：仅未支付/待审核可取消 */
    cancel(ctx: RequestContext, id: ID): Promise<{
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
    /**
     * 平台侧：按渠道/状态分页查询投放单（§122）。
     * status 是视图态：finished 在库里仍是 running，按结束日反推，
     * 保证「筛选口径 = 列表 pill 口径」；take 默认 20、上限 100。
     */
    adminList(ctx: RequestContext, status?: string | null, channelId?: ID | null, skip?: number, take?: number): Promise<{
        total: number;
        items: any[];
    }>;
    /** 平台审核：通过 → running；驳回 → rejected（须填原因） */
    review(ctx: RequestContext, id: ID, approve: boolean, note?: string | null): Promise<{
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
    /** C 端公开：本渠道某广告位当前在投的广告（最多 3 条） */
    activeAds(ctx: RequestContext, slotCode: string): Promise<{
        id: ID;
        slot: string;
        title: string;
        imageUrl: string | null;
        linkUrl: string | null;
        endDate: string;
    }[]>;
    private findOwn;
}
