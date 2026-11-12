"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KOREA_PG_MAX_SKEW_SECONDS = exports.KOREA_PG_TIMESTAMP_HEADER = exports.KOREA_PG_SIGNATURE_HEADER = void 0;
exports.koreaPgSignaturePayload = koreaPgSignaturePayload;
exports.signKoreaPgCallback = signKoreaPgCallback;
exports.verifyKoreaPgCallback = verifyKoreaPgCallback;
exports.isSignatureRequired = isSignatureRequired;
const crypto_1 = require("crypto");
/** 回调验签使用的请求头（真实 PG 接入时在 mapping 层对齐） */
exports.KOREA_PG_SIGNATURE_HEADER = 'x-onebridge-signature';
exports.KOREA_PG_TIMESTAMP_HEADER = 'x-onebridge-timestamp';
/** 允许的时钟偏移（秒），用于防重放 */
exports.KOREA_PG_MAX_SKEW_SECONDS = 300;
/**
 * 回调签名原文（固定顺序，避免依赖 JSON 字段顺序 / 原始 body 解析差异）：
 * `orderCode|transactionId|status|amount|currencyCode|timestamp`
 * 空值统一写成空串。
 */
function koreaPgSignaturePayload(payload, timestamp) {
    var _a, _b, _c, _d;
    const amount = payload.amount == null ? '' : String(payload.amount);
    return [
        (_a = payload.orderCode) !== null && _a !== void 0 ? _a : '',
        (_b = payload.transactionId) !== null && _b !== void 0 ? _b : '',
        (_c = payload.status) !== null && _c !== void 0 ? _c : '',
        amount,
        (_d = payload.currencyCode) !== null && _d !== void 0 ? _d : '',
        timestamp !== null && timestamp !== void 0 ? timestamp : '',
    ].join('|');
}
/** hex(HMAC-SHA256(secret, signaturePayload)) */
function signKoreaPgCallback(secret, payload, timestamp) {
    return (0, crypto_1.createHmac)('sha256', secret).update(koreaPgSignaturePayload(payload, timestamp)).digest('hex');
}
/**
 * 校验回调签名。
 * - 未配置秘钥：由调用方决定是否放行（生产必须拒绝，见 payment.controller.ts）；
 * - 时间戳缺失/超出 ±300s → TIMESTAMP_INVALID（防重放）；
 * - 摘要不等 → SIGNATURE_INVALID（含伪造签名）。
 */
function verifyKoreaPgCallback(secret, payload, signature, timestamp, nowSeconds = Math.floor(Date.now() / 1000)) {
    if (!signature || !timestamp) {
        return { ok: false, code: 'SIGNATURE_MISSING' };
    }
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > exports.KOREA_PG_MAX_SKEW_SECONDS) {
        return { ok: false, code: 'TIMESTAMP_INVALID' };
    }
    const expected = signKoreaPgCallback(secret, payload, timestamp);
    const given = signature.trim().toLowerCase();
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(given, 'utf8');
    if (a.length !== b.length || !(0, crypto_1.timingSafeEqual)(a, b)) {
        return { ok: false, code: 'SIGNATURE_INVALID' };
    }
    return { ok: true };
}
/**
 * 是否强制验签：显式开关优先；否则生产环境默认强制（未配秘钥时回调一律拒绝，
 * 避免「伪造成本为零」的写入路径）。
 */
function isSignatureRequired(env = process.env) {
    if (env.KOREA_PG_REQUIRE_SIGNATURE === '1')
        return true;
    if (env.KOREA_PG_REQUIRE_SIGNATURE === '0')
        return false;
    return env.NODE_ENV === 'production';
}
//# sourceMappingURL=callback-signature.js.map