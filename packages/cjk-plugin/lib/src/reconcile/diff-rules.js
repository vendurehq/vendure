"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.D3_SETTLED_STATES = exports.D1_SHIPPED_STATES = void 0;
exports.diffOrder = diffOrder;
/** D1 判定的「已发货语义」状态：只有这些状态才要求存在发货/配送/核销凭证 */
exports.D1_SHIPPED_STATES = [
    'Shipped', 'PartiallyShipped', 'Delivered', 'PartiallyDelivered',
];
/** D3 判定的「已实收」状态：仅这些状态比较实收金额；PaymentAuthorized 等未实收状态不判 */
exports.D3_SETTLED_STATES = ['PaymentSettled', 'Delivered'];
/**
 * 四流逐单比对：
 * D1 缺履约凭证：仅「已发货语义」订单（Shipped/PartiallyShipped/Delivered/PartiallyDelivered）判定，
 *    凭证为「发货单 ∪ 配送记录 ∪ 自提核销」三者都不存在才算差异；
 *    数据源护栏：delivery_record 全表 0 或近 7 天无写入时整轮跳过 D1（否则会把数据源缺失误判成业务差异）。
 * D2 扣仓不一致：账本 order:out 仓与配送记录 sourceLocationId 必须一致
 * D3 实收不平：仅已实收状态（PaymentSettled/Delivered）判「实收支付 − 已结算退款」是否等于订单应付；
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
        && !input.d1SourceMissing
        && exports.D1_SHIPPED_STATES.includes(order.state)
        && !input.hasShipment
        && !input.pickupCollected
        && openRecords.length === 0) {
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
        // 实收口径：已结算支付 − 已结算退款（COD 未签收/Auth 态不计入，也不判差异）
        const received = Number((_c = input.paidSettled) !== null && _c !== void 0 ? _c : 0) - Number((_d = input.settledRefunds) !== null && _d !== void 0 ? _d : 0);
        if (received !== order.totalWithTax) {
            diffs.push('D3');
        }
    }
    if (mirrorDiff !== 0) {
        diffs.push('D4');
    }
    return diffs;
}
//# sourceMappingURL=diff-rules.js.map