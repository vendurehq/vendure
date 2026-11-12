import { createHmac } from 'crypto';
import { describe, expect, it } from 'vitest';

import {
    isSignatureRequired,
    KOREA_PG_MAX_SKEW_SECONDS,
    koreaPgSignaturePayload,
    signKoreaPgCallback,
    verifyKoreaPgCallback,
} from '../payments/callback-signature';

const SECRET = 'test-callback-secret';
const NOW = 1_800_000_000;
const PAYLOAD = {
    orderCode: 'PP202611120001',
    transactionId: 'KRPG-TX-1',
    status: 'paid' as const,
    amount: 129000,
    currencyCode: 'KRW',
};

describe('korea-pg 回调验签（B-04）', () => {
    it('签名原文固定顺序，空值写空串', () => {
        expect(koreaPgSignaturePayload(PAYLOAD, String(NOW))).toBe(
            'PP202611120001|KRPG-TX-1|paid|129000|KRW|1800000000',
        );
        expect(
            koreaPgSignaturePayload({ orderCode: 'X', transactionId: 'Y', status: 'paid' }, '1'),
        ).toBe('X|Y|paid|||1');
    });

    it('正确签名通过', () => {
        const sig = signKoreaPgCallback(SECRET, PAYLOAD, String(NOW));
        expect(sig).toBe(
            createHmac('sha256', SECRET)
                .update(koreaPgSignaturePayload(PAYLOAD, String(NOW)))
                .digest('hex'),
        );
        expect(verifyKoreaPgCallback(SECRET, PAYLOAD, sig, String(NOW), NOW)).toEqual({ ok: true });
    });

    it('伪造签名被拒绝', () => {
        const forged = signKoreaPgCallback('wrong-secret', PAYLOAD, String(NOW));
        expect(verifyKoreaPgCallback(SECRET, PAYLOAD, forged, String(NOW), NOW)).toEqual({
            ok: false,
            code: 'SIGNATURE_INVALID',
        });
    });

    it('签名缺失 / 时间戳超出窗口（重放）被拒绝', () => {
        expect(verifyKoreaPgCallback(SECRET, PAYLOAD, undefined, String(NOW), NOW)).toEqual({
            ok: false,
            code: 'SIGNATURE_MISSING',
        });
        const sig = signKoreaPgCallback(SECRET, PAYLOAD, String(NOW));
        expect(verifyKoreaPgCallback(SECRET, PAYLOAD, sig, undefined, NOW)).toEqual({
            ok: false,
            code: 'SIGNATURE_MISSING',
        });
        const replayed = verifyKoreaPgCallback(
            SECRET,
            PAYLOAD,
            sig,
            String(NOW),
            NOW + KOREA_PG_MAX_SKEW_SECONDS + 1,
        );
        expect(replayed).toEqual({ ok: false, code: 'TIMESTAMP_INVALID' });
    });

    it('篡改金额后原签名失效', () => {
        const sig = signKoreaPgCallback(SECRET, PAYLOAD, String(NOW));
        const tampered = { ...PAYLOAD, amount: 1 };
        expect(verifyKoreaPgCallback(SECRET, tampered, sig, String(NOW), NOW)).toEqual({
            ok: false,
            code: 'SIGNATURE_INVALID',
        });
    });

    it('验签强制开关：生产默认强制，显式 0 可关闭', () => {
        expect(isSignatureRequired({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(true);
        expect(isSignatureRequired({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe(false);
        expect(
            isSignatureRequired({ NODE_ENV: 'production', KOREA_PG_REQUIRE_SIGNATURE: '0' } as NodeJS.ProcessEnv),
        ).toBe(false);
        expect(
            isSignatureRequired({ NODE_ENV: 'development', KOREA_PG_REQUIRE_SIGNATURE: '1' } as NodeJS.ProcessEnv),
        ).toBe(true);
    });
});
