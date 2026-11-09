"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.allowedRfqTransitions = allowedRfqTransitions;
exports.canTransitionRfq = canTransitionRfq;
exports.assertRfqTransition = assertRfqTransition;
const errors_1 = require("./errors");
/**
 * RFQ 阶段流转表（CT-02）：
 * submitRfq → quoting / requirement → sample / producing → qc → customs / delivered → done / lost。
 * 这里把三业务线允许的箭头显式化；任何不在表内的跃迁返回 INVALID_STAGE_TRANSITION。
 */
const RFQ_TRANSITIONS = {
    // 提交后的初始态（CT-02：quoting → sample / producing）
    quoting: ['sample', 'producing', 'lost'],
    requirement: ['sourcing', 'producing', 'lost'],
    // 项目制
    sourcing: ['producing', 'risk', 'lost'],
    risk: ['sourcing', 'producing', 'lost'],
    // 专栏 / 项目共用
    sample: ['qc', 'producing', 'lost'],
    producing: ['qc', 'lost'],
    qc: ['customs', 'delivered', 'producing', 'lost'],
    customs: ['delivered', 'lost'],
    delivered: ['done', 'lost'],
    // 小商品订单阶段
    wait_pay: ['shipping', 'lost'],
    shipping: ['done', 'refund', 'lost'],
    refund: ['done', 'lost'],
    // 终态
    done: [],
    lost: [],
};
function allowedRfqTransitions(from) {
    var _a;
    return (_a = RFQ_TRANSITIONS[from]) !== null && _a !== void 0 ? _a : [];
}
function canTransitionRfq(from, to) {
    return allowedRfqTransitions(from).includes(to);
}
/** 非法跃迁抛 INVALID_STAGE_TRANSITION（M2 的 resolver 直接透出错误码） */
function assertRfqTransition(from, to) {
    if (!canTransitionRfq(from, to)) {
        throw errors_1.Errors.invalidTransition(from, to);
    }
}
//# sourceMappingURL=transitions.js.map