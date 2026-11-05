import { ID, RequestContext, TransactionalConnection } from '@vendure/core';
import { CampusConfigService } from './campus-config.service';
import { type UnmannedDeliveryResult } from './unmanned-delivery';
export interface LockerStationInput {
    name?: string;
    location?: string;
    provider?: string;
    totalCells?: number;
    availableCells?: number;
    openHours?: string | null;
    pickupGuide?: string | null;
    enabled?: boolean;
    sort?: number;
}
export interface UnmannedChannelInput {
    enabled?: boolean;
    provider?: string;
    endpoint?: string | null;
    key?: string | null;
}
export declare class CampusLockerService {
    private connection;
    private configService;
    constructor(connection: TransactionalConnection, configService: CampusConfigService);
    private repo;
    /** 后台：本渠道全部站点（含停用） */
    adminList(ctx: RequestContext): Promise<{
        providerName: string;
        channelId: ID;
        name: string;
        location: string;
        provider: string;
        totalCells: number;
        availableCells: number;
        openHours: string | null;
        pickupGuide: string | null;
        enabled: boolean;
        sort: number;
        createdBy: string | null;
        id: ID;
        createdAt: Date;
        updatedAt: Date;
    }[]>;
    /** C 端：本渠道启用站点（按 sort / 创建时间） */
    shopList(ctx: RequestContext): Promise<{
        providerName: string;
        channelId: ID;
        name: string;
        location: string;
        provider: string;
        totalCells: number;
        availableCells: number;
        openHours: string | null;
        pickupGuide: string | null;
        enabled: boolean;
        sort: number;
        createdBy: string | null;
        id: ID;
        createdAt: Date;
        updatedAt: Date;
    }[]>;
    create(ctx: RequestContext, input: LockerStationInput): Promise<{
        providerName: string;
        channelId: ID;
        name: string;
        location: string;
        provider: string;
        totalCells: number;
        availableCells: number;
        openHours: string | null;
        pickupGuide: string | null;
        enabled: boolean;
        sort: number;
        createdBy: string | null;
        id: ID;
        createdAt: Date;
        updatedAt: Date;
    }>;
    update(ctx: RequestContext, id: ID, input: LockerStationInput): Promise<{
        providerName: string;
        channelId: ID;
        name: string;
        location: string;
        provider: string;
        totalCells: number;
        availableCells: number;
        openHours: string | null;
        pickupGuide: string | null;
        enabled: boolean;
        sort: number;
        createdBy: string | null;
        id: ID;
        createdAt: Date;
        updatedAt: Date;
    }>;
    remove(ctx: RequestContext, id: ID): Promise<boolean>;
    private findOwn;
    private toView;
    /** 入参归一化 + 校验：create 时必填项缺失直接拒绝；update 只校验传入字段 */
    private normalize;
    /** 后台：通道配置视图（密钥只回是否已配，不回明文） */
    channel(ctx: RequestContext): Promise<{
        enabled: boolean;
        provider: string;
        providerName: string;
        providers: {
            code: string;
            name: string;
            needsEndpoint: boolean;
            needsKey: boolean;
            integrated: boolean;
        }[];
        endpoint: string | null;
        keyConfigured: boolean;
        needsEndpoint: boolean;
        needsKey: boolean;
        integrated: boolean;
    }>;
    /** 后台：保存通道配置（endpoint / key 传空串 = 清空） */
    updateChannel(ctx: RequestContext, input: UnmannedChannelInput): Promise<{
        enabled: boolean;
        provider: string;
        providerName: string;
        providers: {
            code: string;
            name: string;
            needsEndpoint: boolean;
            needsKey: boolean;
            integrated: boolean;
        }[];
        endpoint: string | null;
        keyConfigured: boolean;
        needsEndpoint: boolean;
        needsKey: boolean;
        integrated: boolean;
    }>;
    /**
     * 调用占位：校验通道配置后「受理」一次无人配送请求。
     * 真实厂商接入时替换本方法内的 submit 逻辑，返回结构保持不变。
     */
    requestDelivery(ctx: RequestContext, orderId: ID): Promise<UnmannedDeliveryResult>;
}
