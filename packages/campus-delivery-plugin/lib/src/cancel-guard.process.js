"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.campusCancelGuardProcess = void 0;
const core_1 = require("@vendure/core");
/** 已进入履约的配送状态：用户侧不可再自助取消（后台/系统强制路径不受限） */
const IN_FLIGHT_HALL_STATUSES = ['grabbed', 'third_party', 'owned_dispatched', 'merchant_delivering'];
const IN_FLIGHT_THIRD_PARTY_STATES = ['accepted', 'pickup'];
/**
 * 取消守卫：C 端（apiType=shop）在骑手已接单/取货、外部运单在途、商户自配送或已送达时禁止取消。
 * 后台（admin）强制取消不受影响：商家拒单、T4 无人接、运营异常处置仍需能取消。
 * 未取货（open/pending_dispatch/pending_merchant/accepted）仍允许用户取消，避免把未履约订单锁死。
 */
exports.campusCancelGuardProcess = {
    async onTransitionStart(_fromState, toState, { ctx, order }) {
        var _a, _b, _c;
        if (toState !== 'Cancelled' || ctx.apiType !== 'shop')
            return;
        const cf = ((_a = order.customFields) !== null && _a !== void 0 ? _a : {});
        if (cf.deliveredAt || cf.hallStatus === 'delivered') {
            throw new core_1.UserInputError('订单已送达，无法取消，请申请售后');
        }
        const deliveryInFlight = cf.deliveryStatus === 'assigned' || cf.deliveryStatus === 'in_progress';
        // 已取餐（pickedUpAt）即餐在骑手手上：即使 deliveryStatus 被异常清空也必须锁死自助取消
        const pickedUp = !!cf.pickedUpAt;
        const thirdPartyInFlight = IN_FLIGHT_THIRD_PARTY_STATES.includes(String((_b = cf.thirdPartyState) !== null && _b !== void 0 ? _b : ''));
        if (deliveryInFlight || pickedUp || thirdPartyInFlight || IN_FLIGHT_HALL_STATUSES.includes(String((_c = cf.hallStatus) !== null && _c !== void 0 ? _c : ''))) {
            throw new core_1.UserInputError('骑手已接单或配送中，无法取消，请联系客服或申请售后');
        }
    },
};
//# sourceMappingURL=cancel-guard.process.js.map