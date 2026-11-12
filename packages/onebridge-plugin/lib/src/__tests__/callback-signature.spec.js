"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = require("crypto");
const vitest_1 = require("vitest");
const callback_signature_1 = require("../payments/callback-signature");
const SECRET = 'test-callback-secret';
const NOW = 1800000000;
const PAYLOAD = {
    orderCode: 'PP202611120001',
    transactionId: 'KRPG-TX-1',
    status: 'paid',
    amount: 129000,
    currencyCode: 'KRW',
};
(0, vitest_1.describe)('korea-pg 回调验签（B-04）', () => {
    (0, vitest_1.it)('签名原文固定顺序，空值写空串', () => {
        (0, vitest_1.expect)((0, callback_signature_1.koreaPgSignaturePayload)(PAYLOAD, String(NOW))).toBe('PP202611120001|KRPG-TX-1|paid|129000|KRW|1800000000');
        (0, vitest_1.expect)((0, callback_signature_1.koreaPgSignaturePayload)({ orderCode: 'X', transactionId: 'Y', status: 'paid' }, '1')).toBe('X|Y|paid|||1');
    });
    (0, vitest_1.it)('正确签名通过', () => {
        const sig = (0, callback_signature_1.signKoreaPgCallback)(SECRET, PAYLOAD, String(NOW));
        (0, vitest_1.expect)(sig).toBe((0, crypto_1.createHmac)('sha256', SECRET)
            .update((0, callback_signature_1.koreaPgSignaturePayload)(PAYLOAD, String(NOW)))
            .digest('hex'));
        (0, vitest_1.expect)((0, callback_signature_1.verifyKoreaPgCallback)(SECRET, PAYLOAD, sig, String(NOW), NOW)).toEqual({ ok: true });
    });
    (0, vitest_1.it)('伪造签名被拒绝', () => {
        const forged = (0, callback_signature_1.signKoreaPgCallback)('wrong-secret', PAYLOAD, String(NOW));
        (0, vitest_1.expect)((0, callback_signature_1.verifyKoreaPgCallback)(SECRET, PAYLOAD, forged, String(NOW), NOW)).toEqual({
            ok: false,
            code: 'SIGNATURE_INVALID',
        });
    });
    (0, vitest_1.it)('签名缺失 / 时间戳超出窗口（重放）被拒绝', () => {
        (0, vitest_1.expect)((0, callback_signature_1.verifyKoreaPgCallback)(SECRET, PAYLOAD, undefined, String(NOW), NOW)).toEqual({
            ok: false,
            code: 'SIGNATURE_MISSING',
        });
        const sig = (0, callback_signature_1.signKoreaPgCallback)(SECRET, PAYLOAD, String(NOW));
        (0, vitest_1.expect)((0, callback_signature_1.verifyKoreaPgCallback)(SECRET, PAYLOAD, sig, undefined, NOW)).toEqual({
            ok: false,
            code: 'SIGNATURE_MISSING',
        });
        const replayed = (0, callback_signature_1.verifyKoreaPgCallback)(SECRET, PAYLOAD, sig, String(NOW), NOW + callback_signature_1.KOREA_PG_MAX_SKEW_SECONDS + 1);
        (0, vitest_1.expect)(replayed).toEqual({ ok: false, code: 'TIMESTAMP_INVALID' });
    });
    (0, vitest_1.it)('篡改金额后原签名失效', () => {
        const sig = (0, callback_signature_1.signKoreaPgCallback)(SECRET, PAYLOAD, String(NOW));
        const tampered = Object.assign(Object.assign({}, PAYLOAD), { amount: 1 });
        (0, vitest_1.expect)((0, callback_signature_1.verifyKoreaPgCallback)(SECRET, tampered, sig, String(NOW), NOW)).toEqual({
            ok: false,
            code: 'SIGNATURE_INVALID',
        });
    });
    (0, vitest_1.it)('验签强制开关：生产默认强制，显式 0 可关闭', () => {
        (0, vitest_1.expect)((0, callback_signature_1.isSignatureRequired)({ NODE_ENV: 'production' })).toBe(true);
        (0, vitest_1.expect)((0, callback_signature_1.isSignatureRequired)({ NODE_ENV: 'development' })).toBe(false);
        (0, vitest_1.expect)((0, callback_signature_1.isSignatureRequired)({ NODE_ENV: 'production', KOREA_PG_REQUIRE_SIGNATURE: '0' })).toBe(false);
        (0, vitest_1.expect)((0, callback_signature_1.isSignatureRequired)({ NODE_ENV: 'development', KOREA_PG_REQUIRE_SIGNATURE: '1' })).toBe(true);
    });
});
//# sourceMappingURL=callback-signature.spec.js.map