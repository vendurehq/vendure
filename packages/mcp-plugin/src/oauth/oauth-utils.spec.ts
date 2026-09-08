import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
    addSeconds,
    appendOAuthParams,
    isRegisteredRedirectUri,
    randomToken,
    verifyPkceChallenge,
} from './oauth-utils';

describe('oauth-utils', () => {
    it('randomToken returns distinct 32-byte base64url strings', () => {
        const a = randomToken();
        const b = randomToken();
        expect(a).not.toEqual(b);
        expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
        // 32 bytes encode to exactly 43 base64url characters (no padding)
        expect(a).toHaveLength(43);
    });

    it('addSeconds adds whole seconds to a date', () => {
        const base = new Date('2026-01-01T00:00:00.000Z');
        expect(addSeconds(base, 90).toISOString()).toBe('2026-01-01T00:01:30.000Z');
    });

    it('verifyPkceChallenge accepts a correct S256 verifier and rejects a wrong one', () => {
        const verifier = randomToken();
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
    describe('isRegisteredRedirectUri', () => {
        const registered = ['http://localhost/callback', 'http://127.0.0.1/callback', 'https://app.example.com/cb'];

        it('accepts an exact match', () => {
            expect(isRegisteredRedirectUri(registered, 'https://app.example.com/cb')).toBe(true);
        });

        it('accepts a loopback redirect on any port when the portless URI is registered', () => {
            expect(isRegisteredRedirectUri(registered, 'http://localhost:3118/callback')).toBe(true);
            expect(isRegisteredRedirectUri(registered, 'http://127.0.0.1:65000/callback')).toBe(true);
        });

        it('rejects a loopback redirect whose path or host differs', () => {
            expect(isRegisteredRedirectUri(registered, 'http://localhost:3118/other')).toBe(false);
            expect(isRegisteredRedirectUri(registered, 'http://[::1]:3118/callback')).toBe(false);
        });

        it('never relaxes the port for non-loopback hosts', () => {
            expect(isRegisteredRedirectUri(['https://app.example.com/cb'], 'https://app.example.com:8443/cb')).toBe(false);
            expect(isRegisteredRedirectUri(['http://localhost/callback'], 'http://evil.example/callback')).toBe(false);
        });

        it('returns false for an unparsable redirect', () => {
            expect(isRegisteredRedirectUri(registered, 'not a url')).toBe(false);
        });
    });
});
