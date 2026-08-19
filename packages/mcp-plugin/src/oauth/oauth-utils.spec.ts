import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { addSeconds, appendOAuthParams, randomToken, verifyPkceChallenge } from './oauth-utils';

describe('oauth-utils', () => {
    it('randomToken returns distinct base64url strings of the requested byte length', () => {
        const a = randomToken(16);
        const b = randomToken(16);
        expect(a).not.toEqual(b);
        expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
        // 16 bytes → ~22 base64url chars (no padding)
        expect(a.length).toBeGreaterThanOrEqual(21);
    });

    it('addSeconds adds whole seconds to a date', () => {
        const base = new Date('2026-01-01T00:00:00.000Z');
        expect(addSeconds(base, 90).toISOString()).toBe('2026-01-01T00:01:30.000Z');
    });

    it('verifyPkceChallenge accepts a correct S256 verifier and rejects a wrong one', () => {
        const verifier = randomToken(32);
        const challenge = createHash('sha256').update(verifier).digest('base64url');
        expect(verifyPkceChallenge(verifier, challenge)).toBe(true);
        expect(verifyPkceChallenge(verifier, 'not-the-challenge')).toBe(false);
    });

    it('appendOAuthParams preserves existing query params and skips undefined values', () => {
        const result = appendOAuthParams('https://app.example.com/callback?existing=1', {
            code: 'abc',
            state: undefined,
        });
        const url = new URL(result);
        expect(url.searchParams.get('existing')).toBe('1');
        expect(url.searchParams.get('code')).toBe('abc');
        expect(url.searchParams.has('state')).toBe(false);
    });
});
