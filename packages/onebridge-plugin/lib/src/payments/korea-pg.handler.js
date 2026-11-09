"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.koreaPgPaymentHandler = exports.KOREA_PG_CALLBACK_PATH = exports.KOREA_PG_HANDLER_CODE = void 0;
const core_1 = require("@vendure/core");
/**
 * 韩国 PG 支付桩（CT-05 一期）：
 * - 只打通「下单 → 授权 → 异步回调 → 结算 → paid 节点」的契约，不接真实 PG；
 * - 商户参数走 PaymentMethod.args，真实商户号/密钥等 PRE-02 给值后再填，代码不硬编码；
 * - `mode` 为 stub 时 createPayment 直接返回 Authorized，成交依赖回调端点
 *   POST /onebridge/payments/korea-pg/callback 幂等落账。
 */
exports.KOREA_PG_HANDLER_CODE = 'korea-pg';
/** 回调端点固定路径（与 CSRF 白名单/网关配置对齐，见 04 号文档草案） */
exports.KOREA_PG_CALLBACK_PATH = '/onebridge/payments/korea-pg/callback';
exports.koreaPgPaymentHandler = new core_1.PaymentMethodHandler({
    code: exports.KOREA_PG_HANDLER_CODE,
    description: [
        { languageCode: core_1.LanguageCode.zh_Hans, value: '韩国 PG（一期桩）' },
        { languageCode: core_1.LanguageCode.en, value: 'Korea PG (stub)' },
    ],
    args: {
        merchantId: {
            type: 'string',
            label: [{ languageCode: core_1.LanguageCode.zh_Hans, value: '商户号 (merchantId)' }],
            description: [{ languageCode: core_1.LanguageCode.zh_Hans, value: 'PRE-02 提供，一期留空' }],
        },
        secretKey: {
            type: 'string',
            label: [{ languageCode: core_1.LanguageCode.zh_Hans, value: '商户密钥 (secretKey)' }],
            public: false,
        },
        callbackUrl: {
            type: 'string',
            label: [{ languageCode: core_1.LanguageCode.zh_Hans, value: '回调地址 (callbackUrl)' }],
            description: [{ languageCode: core_1.LanguageCode.zh_Hans, value: `默认 ${exports.KOREA_PG_CALLBACK_PATH}` }],
        },
        mode: {
            type: 'string',
            defaultValue: 'stub',
            label: [{ languageCode: core_1.LanguageCode.zh_Hans, value: '模式 (stub/live)' }],
            description: [{ languageCode: core_1.LanguageCode.zh_Hans, value: '一期只允许 stub；live 留到接入真实 PG' }],
        },
    },
    async createPayment(ctx, order, amount, args, metadata) {
        var _a;
        if ((args.mode || 'stub') !== 'stub') {
            // 一期明确不调用真实 PG；配置错误直接失败，避免误以为已接通
            throw new Error('korea-pg: live 模式未实现（一期仅支持 stub）');
        }
        return {
            amount,
            state: 'Authorized',
            // 桩交易号：真实接入后替换为 PG 返回的 transactionId
            transactionId: `STUB-KRPG-${order.code}-${Date.now()}`,
            // Payment.metadata resolver 对外只返回 public
            metadata: {
                public: {
                    provider: exports.KOREA_PG_HANDLER_CODE,
                    mode: 'stub',
                    currencyCode: order.currencyCode,
                    requestId: (_a = metadata === null || metadata === void 0 ? void 0 : metadata.idempotencyKey) !== null && _a !== void 0 ? _a : null,
                },
            },
        };
    },
    async settlePayment() {
        // 桩：回调已由 OnebridgePaymentCallbackService 校验并落账，此处置为成功
        return { success: true };
    },
});
//# sourceMappingURL=korea-pg.handler.js.map