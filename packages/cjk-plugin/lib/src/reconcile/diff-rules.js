"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isD1ProofExempt = exports.D1_HISTORICAL_PROOF_EXEMPT_ORDER_IDS = exports.D3_SETTLED_STATES = exports.D1_SHIPPED_STATES = void 0;
exports.diffOrder = diffOrder;
/** D1 判定的「已发货语义」状态：只有这些状态才要求存在发货/配送/核销凭证 */
exports.D1_SHIPPED_STATES = [
    'Shipped', 'PartiallyShipped', 'Delivered', 'PartiallyDelivered',
];
/** D3 判定的「已实收」状态：仅这些状态比较实收金额；PaymentAuthorized 等未实收状态不判 */
exports.D3_SETTLED_STATES = ['PaymentSettled', 'Delivered'];
/**
 * D1 历史凭证豁免白名单（显式订单 id）。
 * 依据：以下订单在发货单 / 自提核销 / 校园配送送达状态（order.customFields.deliveryStatus）
 * 三项凭证字段启用之前即已完结（state=Delivered），当时三证字段根本不存在，无法补录凭证；
 * 2026-11-08 逐单只读核对确认均为历史单，故按显式 id 豁免 D1，避免与真实缺口混淆。
 * 仅按 id 豁免：不做时间范围/状态等模糊条件；新订单不在本列表，三证皆无仍会正常报 D1。
 */
exports.D1_HISTORICAL_PROOF_EXEMPT_ORDER_IDS = new Set([
    '5', '6', '8', '50', '70', '73', '74', '75', '105', '128', '160', '165', '166', '167',
]);
/** 该单是否属于 D1 历史凭证豁免（字段启用前已完结，三证当时不存在） */
const isD1ProofExempt = (orderId) => exports.D1_HISTORICAL_PROOF_EXEMPT_ORDER_IDS.has(String(orderId));
exports.isD1ProofExempt = isD1ProofExempt;
/**
 * 四流逐单比对：
 * D1 缺履约凭证：仅「已发货语义」订单（Shipped/PartiallyShipped/Delivered/PartiallyDelivered）判定，
 *    凭证为「发货单 ∪ 自提核销 ∪ 校园配送实际送达」三者都不存在才算差异；
 *    不再依赖从未写入的 delivery_record 表，也不因该表为空而整轮跳过 D1；
 *    字段启用前已完结的历史单按显式 id 白名单豁免（见 isD1ProofExempt）。
 * D2 扣仓不一致：账本 order:out 仓与配送记录 sourceLocationId 必须一致
 * D3 实收不平：仅已实收状态（PaymentSettled/Delivered）判两类真差异：
 *    ① 实收（Settled 支付合计）≠ 应付 → 少收/多收；② 已结算退款合计 > 实收 → 多退。
 *    合法部分退款、合法全额退款（退款 ≤ 实收）不再报差异；
 *    PaymentAuthorized 等未实收状态不判；分账台账（MerchantSettlementLedger）不再混入 D3，另立独立规则。
 * D4 镜像不平：虚拟仓 onHand ≠ Σ 绑定物理仓 onHand（由批次扫描传入）
 */
function diffOrder(input) {
    var _a, _b, _c, _d;
    const diffs = [];
    const { order, deliveryRecords, ledgerOuts, mirrorDiff, cancelled } = input;
    // 草稿单（AddingItems）从未下单，不参与对账：加购/浏览阶段不应产生任何待处理差异
    if (order.state === 'AddingItems') {
        return diffs;
    }
    // 取消单不参与 D1/D3：取消的订单没有配送记录是必然结果，不是差异；
    // 取消后也不再产生应收，继续判金额不平只会制造噪音
    const isCancelled = cancelled === true || order.state === 'Cancelled';
    const openRecords = deliveryRecords.filter(r => ['self', 'express', 'pickup'].includes(r.mode) && r.status !== 'Draft');
    if (!isCancelled
        && exports.D1_SHIPPED_STATES.includes(order.state)
        && !(0, exports.isD1ProofExempt)(order.id)
        && !input.hasShipment
        && !input.pickupCollected
        && !input.campusDelivered) {
        diffs.push('D1');
    }
    const firstOut = ledgerOuts[0];
    if (firstOut) {
        const recLoc = (_b = (_a = openRecords.find(r => r.sourceLocationId)) === null || _a === void 0 ? void 0 : _a.sourceLocationId) !== null && _b !== void 0 ? _b : null;
        if (recLoc == null || String(recLoc) !== String(firstOut.sourceLocationId)) {
            diffs.push('D2');
        }
    }
    if (!isCancelled && exports.D3_SETTLED_STATES.includes(order.state)) {
        // 实收口径：已结算支付合计；只判「实收≠应付」与「退款>实收」两类真差异
        // 合法部分退款、合法全额退款（退款 ≤ 实收）均不再报差异
        const paid = Number((_c = input.paidSettled) !== null && _c !== void 0 ? _c : 0);
        const refunded = Number((_d = input.settledRefunds) !== null && _d !== void 0 ? _d : 0);
        if (paid !== order.totalWithTax || refunded > paid) {
            diffs.push('D3');
        }
    }
    if (mirrorDiff !== 0) {
        diffs.push('D4');
    }
    return diffs;
}
//# sourceMappingURL=diff-rules.js.map