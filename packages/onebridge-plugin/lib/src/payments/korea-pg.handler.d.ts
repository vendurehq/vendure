import { LanguageCode, PaymentMethodHandler } from '@vendure/core';
/**
 * 韩国 PG 支付桩（CT-05 一期）：
 * - 只打通「下单 → 授权 → 异步回调 → 结算 → paid 节点」的契约，不接真实 PG；
 * - 商户参数走 PaymentMethod.args，真实商户号/密钥等 PRE-02 给值后再填，代码不硬编码；
 * - `mode` 为 stub 时 createPayment 直接返回 Authorized，成交依赖回调端点
 *   POST /onebridge/payments/korea-pg/callback 幂等落账。
 */
export declare const KOREA_PG_HANDLER_CODE = "korea-pg";
/** 回调端点固定路径（与 CSRF 白名单/网关配置对齐，见 04 号文档草案） */
export declare const KOREA_PG_CALLBACK_PATH = "/onebridge/payments/korea-pg/callback";
export declare const koreaPgPaymentHandler: PaymentMethodHandler<{
    merchantId: {
        type: "string";
        label: {
            languageCode: LanguageCode.zh_Hans;
            value: string;
        }[];
        description: {
            languageCode: LanguageCode.zh_Hans;
            value: string;
        }[];
    };
    secretKey: {
        type: "string";
        label: {
            languageCode: LanguageCode.zh_Hans;
            value: string;
        }[];
        public: boolean;
    };
    callbackUrl: {
        type: "string";
        label: {
            languageCode: LanguageCode.zh_Hans;
            value: string;
        }[];
        description: {
            languageCode: LanguageCode.zh_Hans;
            value: string;
        }[];
    };
    mode: {
        type: "string";
        defaultValue: string;
        label: {
            languageCode: LanguageCode.zh_Hans;
            value: string;
        }[];
        description: {
            languageCode: LanguageCode.zh_Hans;
            value: string;
        }[];
    };
}>;
