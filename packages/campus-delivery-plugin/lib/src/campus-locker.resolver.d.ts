import { ID, RequestContext } from '@vendure/core';
import { CampusLockerService, type LockerStationInput, type UnmannedChannelInput } from './campus-locker.service';
/**
 * P2-4 智能取餐柜 / 无人配送（admin-api）。
 * - 商家（CampusMerchant）：看本站点柜机、看无人配送通道状态
 * - 平台（CampusConfig）：站点增删改、无人配送通道配置
 *
 * 注意：admin/shop 两套 schema 字段不同，resolver 必须拆两个类注册，
 * 否则任一侧缺字段都会在启动时报 "defined in resolvers, but not in schema"。
 */
export declare class CampusLockerAdminResolver {
    private lockers;
    constructor(lockers: CampusLockerService);
    campusLockerStations(ctx: RequestContext): Promise<{
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
    campusCreateLockerStation(ctx: RequestContext, input: LockerStationInput): Promise<{
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
    campusUpdateLockerStation(ctx: RequestContext, id: ID, input: LockerStationInput): Promise<{
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
    campusDeleteLockerStation(ctx: RequestContext, id: ID): Promise<boolean>;
    campusUnmannedChannel(ctx: RequestContext): Promise<{
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
    campusUpdateUnmannedChannel(ctx: RequestContext, input: UnmannedChannelInput): Promise<{
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
    /** 调用占位：真实厂商 SDK 未接，当前只做配置校验 + 模拟受理（返回单号） */
    campusRequestUnmannedDelivery(ctx: RequestContext, orderId: ID): Promise<import("./unmanned-delivery").UnmannedDeliveryResult>;
}
/** P2-4 智能取餐柜（shop-api）：C 端公开只读启用站点 + 无人配送是否开通 */
export declare class CampusLockerShopResolver {
    private lockers;
    constructor(lockers: CampusLockerService);
    campusLockerStations(ctx: RequestContext): Promise<{
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
    campusUnmannedDeliveryChannel(ctx: RequestContext): Promise<{
        enabled: boolean;
        provider: string;
        providerName: string;
        integrated: boolean;
    }>;
}
