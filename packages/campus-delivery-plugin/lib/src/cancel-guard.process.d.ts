import { OrderProcess } from '@vendure/core';
/** 强制取消标记：由受控入口（campusForceCancelOrder）在调用 cancelOrder 前写入同一 ctx，
 * 守卫放行并据此落审计；调用结束即删。用 Symbol 避免序列化/误写。 */
export declare const FORCE_CANCEL_MARK: unique symbol;
export interface ForceCancelMark {
    reason: string;
    actorUserId?: number | string | null;
    at?: Date;
}
/** 已送达判定：hallStatus / deliveryStatus 为 delivered，或已写 deliveredAt。
 * 一旦送达即不应再走取消（A11：生产曾有已送达单被后台取消，污染对账与分账）。 */
export declare function isDeliveredOrder(order: {
    customFields?: any;
} | null | undefined): boolean;
/**
 * 取消守卫：
 * - 已送达：C 端不可取消；后台/系统默认拦截，仅显式强制标记（带理由）可放行并写审计；
 * - 未送达的 C 端：骑手已接单/取货、外部运单在途、商户自配送时禁止自助取消；
 * - 未送达的 admin/系统取消不受影响（商家拒单、T4 无人接、运营异常处置仍需能取消）。
 * 未取货（open/pending_dispatch/pending_merchant/accepted）仍允许用户取消，避免把未履约订单锁死。
 */
export declare const campusCancelGuardProcess: OrderProcess<any>;
