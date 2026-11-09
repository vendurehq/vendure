"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.codPaymentHandler = void 0;
const core_1 = require("@vendure/core");
const cod_refund_port_1 = require("./cod-refund-port");
exports.codPaymentHandler = new core_1.PaymentMethodHandler({
    code: 'cash-on-delivery',
    description: [
        { languageCode: core_1.LanguageCode.zh_Hans, value: '货到付款' },
        { languageCode: core_1.LanguageCode.zh_Hant, value: '貨到付款' },
        { languageCode: core_1.LanguageCode.ja, value: '代金引換' },
        { languageCode: core_1.LanguageCode.ko, value: '착불 결제' },
        { languageCode: core_1.LanguageCode.en, value: 'Cash on Delivery' },
    ],
    args: {},
    createPayment: async (ctx, order, amount, args, metadata) => {
        return {
            amount,
            state: 'Authorized',
            transactionId: `COD-${order.code}`,
            metadata: { method: 'cash-on-delivery' },
        };
    },
    settlePayment: async (ctx, order, payment, args) => {
        return { success: true };
    },
    createRefund: async (ctx, input, amount, order, payment) => {
        // fail-closed 兜底：既无收款记录、也无闸门端口时，拒绝创建退款单（核心在 handler 之后才落行）
        const policy = (0, cod_refund_port_1.getCodRefundPolicyPort)();
        if (!policy) {
            throw new Error('COD 退款闸门未注册：无收款记录，拒绝创建退款单');
        }
        const auth = await policy.authorize(ctx, { order, payment, amount });
        return {
            state: 'Settled',
            transactionId: auth.transactionId,
            metadata: Object.assign(Object.assign({}, auth.metadata), { codReceiptId: auth.receiptId }),
        };
    },
});
//# sourceMappingURL=cod-handler.js.map