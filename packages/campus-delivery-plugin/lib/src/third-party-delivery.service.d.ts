import { OnApplicationBootstrap } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ID, RequestContext, TransactionalConnection } from '@vendure/core';
import { CampusNotifyService } from './campus-notify.service';
import { HallService } from './hall.service';
import { ExternalProviderCode } from './route-matrix';
/** 第一段完成后的本地状态（纯函数，便于单测）：只有「直送」才算完成，其余都进大厅接力 */
export declare function nextHallStateAfterHandover(handover: string): {
    hallStatus: string;
    deliveryStatus: string | null;
};
export declare class ThirdPartyDeliveryService implements OnApplicationBootstrap {
    private connection;
    private hall;
    private notify;
    private moduleRef;
    constructor(connection: TransactionalConnection, hall: HallService, notify: CampusNotifyService, moduleRef: ModuleRef);
    onApplicationBootstrap(): void;
    /** 懒解析网关（字符串 token，避免 campus → gateway 编译依赖） */
    private get gateway();
    private get cfgRepo();
    private orderRepo;
    private ctxForChannel;
    /**
     * 推送外部快递（运营中心在派单时选择提供方）。
     * - R2：外部快递从商户取货 → 校园交接点（R2 交接点）
     * - R3：当前策略为 external 时，外部快递整段直送学生
     */
    dispatchExternal(ctx: RequestContext, orderId: number, provider: ExternalProviderCode): Promise<{
        ok: boolean;
        already: boolean;
        thirdPartyNo: any;
        provider?: undefined;
    } | {
        ok: boolean;
        thirdPartyNo: any;
        provider: ExternalProviderCode;
        already?: undefined;
    }>;
    /** 推送主体（须由 dispatchExternal 持订单级锁调用）：幂等判断与下单在同一锁内 */
    private doDispatchExternal;
    /** 取消外部快递配送（商家关单 / 推送失败回落前调用），幂等。
     * 与 dispatchExternal 共用订单级咨询锁：否则「推送中」被取消可能产生孤儿运单或取消不存在的单。 */
    cancel(ctx: RequestContext, orderId: number, reason?: string): Promise<{
        ok: boolean;
        skipped: boolean;
        reason?: undefined;
    } | {
        ok: boolean;
        reason: string | undefined;
        skipped?: undefined;
    }>;
    private doCancel;
    /** 轮询对账：主动向平台查询运单状态（防外部回调丢失），幂等交给网关状态机。
     * 已到终态/未推送的订单直接跳过；Provider 未实现 queryStatus 时网关返回 null（静默）。 */
    syncStatus(ctx: RequestContext, orderId: number): Promise<{
        ok: boolean;
        skipped: string;
        state?: undefined;
    } | {
        ok: boolean;
        state: string | null;
        skipped?: undefined;
    }>;
    /** 第三方字段条件写（P3）：guardState 非空时要求 thirdPartyState 仍为读取时的值（防并发回退），
     * 且始终要求订单未取消——已退款取消单不得被迟到回调写回履约态。 */
    private writeThirdPartyPatch;
    /** 网关回调（由 DeliveryStatusSink 调用） */
    onDeliveryStatus(ctx: RequestContext, update: {
        orderId: ID;
        thirdPartyNo: string;
        status: 'pending' | 'accepted' | 'pickup' | 'delivered' | 'cancelled' | 'exception';
        courierName?: string;
        courierPhone?: string;
        reason?: string;
    }): Promise<void>;
    /** 自营快递接单（R1 商户超时转自营 / R3 自营快递池） */
    acceptOwned(ctx: RequestContext, orderId: number): Promise<{
        ok: boolean;
    }>;
    /** 自营快递确认取餐：assigned → in_progress + 写 pickedUpAt。
     * 条件写保证重复点击/并发取消时不会把已脱厅单改成在途；pickedUpAt 是在途时钟唯一锚点。 */
    pickupOwned(_ctx: RequestContext, orderId: number): Promise<{
        ok: boolean;
    }>;
    /** 第一段（商户 / 自营快递）送达校园交接点：R1/R2 进大厅接力，R3 直接完成 */
    completeFirstLeg(ctx: RequestContext, orderId: number, cause: string): Promise<{
        ok: boolean;
        done: boolean;
    }>;
}
