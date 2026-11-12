import type { KoreaPgCallbackPayload } from './payment-callback.service';
/** 回调验签使用的请求头（真实 PG 接入时在 mapping 层对齐） */
export declare const KOREA_PG_SIGNATURE_HEADER = "x-onebridge-signature";
export declare const KOREA_PG_TIMESTAMP_HEADER = "x-onebridge-timestamp";
/** 允许的时钟偏移（秒），用于防重放 */
export declare const KOREA_PG_MAX_SKEW_SECONDS = 300;
/**
 * 回调签名原文（固定顺序，避免依赖 JSON 字段顺序 / 原始 body 解析差异）：
 * `orderCode|transactionId|status|amount|currencyCode|timestamp`
 * 空值统一写成空串。
 */
export declare function koreaPgSignaturePayload(payload: Pick<KoreaPgCallbackPayload, 'orderCode' | 'transactionId' | 'status' | 'amount' | 'currencyCode'>, timestamp: string): string;
/** hex(HMAC-SHA256(secret, signaturePayload)) */
export declare function signKoreaPgCallback(secret: string, payload: Pick<KoreaPgCallbackPayload, 'orderCode' | 'transactionId' | 'status' | 'amount' | 'currencyCode'>, timestamp: string): string;
export type SignatureVerdict = {
    ok: true;
} | {
    ok: false;
    code: 'SIGNATURE_MISSING' | 'SIGNATURE_INVALID' | 'TIMESTAMP_INVALID';
};
/**
 * 校验回调签名。
 * - 未配置秘钥：由调用方决定是否放行（生产必须拒绝，见 payment.controller.ts）；
 * - 时间戳缺失/超出 ±300s → TIMESTAMP_INVALID（防重放）；
 * - 摘要不等 → SIGNATURE_INVALID（含伪造签名）。
 */
export declare function verifyKoreaPgCallback(secret: string, payload: Pick<KoreaPgCallbackPayload, 'orderCode' | 'transactionId' | 'status' | 'amount' | 'currencyCode'>, signature: string | undefined, timestamp: string | undefined, nowSeconds?: number): SignatureVerdict;
/**
 * 是否强制验签：显式开关优先；否则生产环境默认强制（未配秘钥时回调一律拒绝，
 * 避免「伪造成本为零」的写入路径）。
 */
export declare function isSignatureRequired(env?: NodeJS.ProcessEnv): boolean;
