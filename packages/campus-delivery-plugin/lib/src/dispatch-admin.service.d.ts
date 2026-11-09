import { ModuleRef } from '@nestjs/core';
import { ID, Order, RequestContext, TransactionalConnection } from '@vendure/core';
import { CapacityService } from './capacity.service';
import { CampusNotifyService } from './campus-notify.service';
import { HallGrabService } from './hall-grab.service';
import { HallService } from './hall.service';
export type ExceptionAction = 'reassign' | 'handled' | 'refund_diff' | 'coupon' | 'refund_all';
export interface DispatchAlert {
    orderId: string;
    orderCode: string;
    type: 'stale_open' | 'sla_breach' | 'slot_full' | 'exception' | 'urged';
    detail: string;
    exceptionNote?: string | null;
    exceptionPhotos?: string[] | null;
}
export interface DispatchRider {
    customerId: string;
    realName: string;
    credit: number;
}
export interface HandedException {
    orderId: string;
    orderCode: string;
    exceptionType: string | null;
    action: string;
    compensation: number | null;
    couponTemplateId: string | null;
    note: string | null;
    handledAt: string | null;
    handledBy: string;
}
/**
 * T3 调度看板 + 手动派单/改派（admin）。
 * board：按渠道拉取 hallStatus 非空订单，分类为大厅/进行中，产出四类告警
 * （stale_open / sla_breach / slot_full / exception）与在线骑手列表；
 * exception_final（已处置完结）不进墙，单独输出 handledOrders 留痕（plan 3.4）。
 * assign：手动强派（复用 grabByRider 事务+悲观锁原语，订单已不在大厅则抛错）。
 * backToHall：改派前置——先回大厅（清骑手指派字段），再由 admin 重新派单。
 * handleException（plan 3.4）：异常单三选一处置——重派回大厅 / 退差价 / 发补偿券 / 全额退单，
 * 全部动作写 exceptionAction* 记录字段留痕。
 */
export declare class DispatchAdminService {
    private connection;
    private grab;
    private hall;
    private capacity;
    private moduleRef;
    private notify;
    private orderSvc?;
    private couponSvc?;
    private feishuSvc?;
    constructor(connection: TransactionalConnection, grab: HallGrabService, hall: HallService, capacity: CapacityService, moduleRef: ModuleRef, notify: CampusNotifyService);
    /** vendure Injector 需由 ModuleRef 构造（Nest 不直接提供 Injector 作为可注入项） */
    private get injector();
    /** 飞书通知（可选依赖，测试/未启用时返回 null） */
    private getFeishu;
    board(ctx: RequestContext): Promise<{
        paused: boolean;
        alerts: DispatchAlert[];
        hallOrders: Order[];
        activeOrders: Order[];
        ridersOnline: DispatchRider[];
        handledOrders: HandedException[];
    }>;
    /** 手动派单/改派：目标骑手须在职（approved）且信用分达标，避免把单派给封禁/低分骑手。
     * 跨店守卫：只能操作本渠道订单（与 address-change 同源校验）。
     * grabByRider 返回 false 表示订单已不在大厅（已被抢/已退款）。 */
    assign(ctx: RequestContext, orderId: ID, riderCustomerId: ID): Promise<{
        assigned: boolean;
    }>;
    /** 回大厅（改派前置）：清骑手指派字段，hallStatus 复位 open。
     * 条件写：已取消/已终态单不可回厅，返回失败让前端明确提示（不能假装成功）。
     * 骑手已取货（in_progress）时强制回厅等于让其白跑，必须带交接说明并留痕（transferNote/transferAt）。 */
    backToHall(ctx: RequestContext, orderId: ID, note?: string): Promise<{
        backToHall: boolean;
    }>;
    /** 异常处置（plan 3.4）：仅 deliveryStatus='exception' 的订单可处置。
     * reassign：回大厅（可再抢/强派）；refund_diff：部分退款完结；coupon：发补偿券完结；
     * refund_all：全额退款+取消订单完结。完结单 hallStatus='exception_final' 退出调度墙，
     * 全部动作写 exceptionAction* 记录留痕。 */
    handleException(ctx: RequestContext, orderId: ID, action: ExceptionAction, amount?: number, couponTemplateId?: ID, note?: string): Promise<{
        ok: boolean;
        action: ExceptionAction;
    }>;
    /**
     * A11 受控出口：强制取消（含已送达单）。必须显式填写理由，取消前先落审计，取消后回填结果。
     * 审计写入失败则不执行取消——不允许「无审计的强制取消」。
     */
    forceCancel(ctx: RequestContext, orderId: ID, reason: string): Promise<boolean>;
    /** 强制取消审计落库（谁/何时/理由），返回行 id；写库失败直接抛错，阻止取消 */
    private insertForceCancelAudit;
    /** 回填强制取消结果（取消已执行，回填失败只告警） */
    private markForceCancelAudit;
    /** 异常处置原子认领：仅首次调用返回 true（并发/重复点击只有一路能消费掉异常态） */
    private claimException;
    /** 跨店守卫：订单必须属于当前渠道（调度写操作统一入口校验） */
    private assertOrderInChannel;
    /** 部分退款（fork 无 core RefundService，走 OrderService.refundOrder/settleRefund，与 T4 同源）。
     * refund 表 shipping/adjustment 列 NOT NULL 必须显式传 0；
     * 幂等保护：累计已退 + 本次 ≤ payment.amount，超额抛错。 */
    private refundAmount;
    /** 全额退单：退剩余未退部分 + cancelOrder（行取消+状态转换，同 T4）
     * 已送达单不走这条：送达后不应再取消（A11），在入口直接跳过，避免「退完款才被守卫拦下」。 */
    private refundAllAndCancel;
    /**
     * 退款/退单处置失败兜底：不能只回滚认领——退款单可能已创建但客户未到账。
     * 与 T4 一致置 refund_failed 退出自动重试并推飞书，人工对账后仍可再次处置
     * （deliveryStatus 保持 exception，重新处置会重新认领）。条件写防覆盖已取消单。
     */
    private markExceptionRefundFailed;
    private getOrderService;
    /** 补偿券服务：coupon-plugin 为可选依赖，动态 require + Injector 解析（同 dispatch-job），
     * 未安装/未启用/解析失败返回 null。 */
    private getCouponService;
}
