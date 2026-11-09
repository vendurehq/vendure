import { LanguageCode, PaymentMethodHandler } from '@vendure/core';
import { getCodRefundPolicyPort } from './cod-refund-port';

export const codPaymentHandler = new PaymentMethodHandler({
    code: 'cash-on-delivery',
    description: [
        { languageCode: LanguageCode.zh_Hans, value: '货到付款' },
        { languageCode: LanguageCode.zh_Hant, value: '貨到付款' },
        { languageCode: LanguageCode.ja, value: '代金引換' },
        { languageCode: LanguageCode.ko, value: '착불 결제' },
        { languageCode: LanguageCode.en, value: 'Cash on Delivery' },
    ],
    args: {},
    createPayment: async (ctx, order, amount, args, metadata) => {
        return {
            amount,
            state: 'Authorized' as const,
            transactionId: `COD-${order.code}`,
            metadata: { method: 'cash-on-delivery' },
        };
    },
    settlePayment: async (ctx, order, payment, args) => {
        return { success: true };
    },
    createRefund: async (ctx, input, amount, order, payment) => {
        // fail-closed 兜底：既无收款记录、也无闸门端口时，拒绝创建退款单（核心在 handler 之后才落行）
        const policy = getCodRefundPolicyPort();
        if (!policy) {
            throw new Error('COD 退款闸门未注册：无收款记录，拒绝创建退款单');
        }
        const auth = await policy.authorize(ctx, { order, payment, amount });
        return {
            state: 'Settled' as const,
            transactionId: auth.transactionId,
            metadata: { ...auth.metadata, codReceiptId: auth.receiptId },
        };
    },
});
