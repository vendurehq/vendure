import { OrderProcess, UserInputError } from '@vendure/core';

/** 已进入履约的配送状态：用户侧不可再自助取消（后台/系统强制路径不受限） */
const IN_FLIGHT_HALL_STATUSES = ['grabbed', 'third_party', 'owned_dispatched', 'merchant_delivering'];
const IN_FLIGHT_THIRD_PARTY_STATES = ['accepted', 'pickup'];

/** 强制取消标记：由受控入口（campusForceCancelOrder）在调用 cancelOrder 前写入同一 ctx，
 * 守卫放行并据此落审计；调用结束即删。用 Symbol 避免序列化/误写。 */
export const FORCE_CANCEL_MARK = Symbol('campus.forceCancel');

export interface ForceCancelMark {
    reason: string;
    actorUserId?: number | string | null;
    at?: Date;
}

/** 已送达判定：hallStatus / deliveryStatus 为 delivered，或已写 deliveredAt。
 * 一旦送达即不应再走取消（A11：生产曾有已送达单被后台取消，污染对账与分账）。 */
export function isDeliveredOrder(order: { customFields?: any } | null | undefined): boolean {
    const cf = (order?.customFields ?? {}) as any;
    return !!cf.deliveredAt || cf.hallStatus === 'delivered' || cf.deliveryStatus === 'delivered';
}

/**
 * 取消守卫：
 * - 已送达：C 端不可取消；后台/系统默认拦截，仅显式强制标记（带理由）可放行并写审计；
 * - 未送达的 C 端：骑手已接单/取货、外部运单在途、商户自配送时禁止自助取消；
 * - 未送达的 admin/系统取消不受影响（商家拒单、T4 无人接、运营异常处置仍需能取消）。
 * 未取货（open/pending_dispatch/pending_merchant/accepted）仍允许用户取消，避免把未履约订单锁死。
 */
export const campusCancelGuardProcess: OrderProcess<any> = {
    async onTransitionStart(_fromState, toState, { ctx, order }) {
        if (toState !== 'Cancelled') return;
        const cf = (order.customFields ?? {}) as any;

        if (isDeliveredOrder(order)) {
            if (ctx.apiType === 'shop') {
                throw new UserInputError('订单已送达，无法取消，请申请售后');
            }
            const mark = (ctx as any)[FORCE_CANCEL_MARK] as ForceCancelMark | undefined;
            if (mark && String(mark.reason ?? '').trim()) return;
            throw new UserInputError('订单已送达，已拦截后台/系统取消；确需取消请走强制取消并填写理由');
        }

        if (ctx.apiType !== 'shop') return;
        const deliveryInFlight = cf.deliveryStatus === 'assigned' || cf.deliveryStatus === 'in_progress';
        // 已取餐（pickedUpAt）即餐在骑手手上：即使 deliveryStatus 被异常清空也必须锁死自助取消
        const pickedUp = !!cf.pickedUpAt;
        const thirdPartyInFlight = IN_FLIGHT_THIRD_PARTY_STATES.includes(String(cf.thirdPartyState ?? ''));
        if (deliveryInFlight || pickedUp || thirdPartyInFlight || IN_FLIGHT_HALL_STATUSES.includes(String(cf.hallStatus ?? ''))) {
            throw new UserInputError('骑手已接单或配送中，无法取消，请联系客服或申请售后');
        }
    },
};
