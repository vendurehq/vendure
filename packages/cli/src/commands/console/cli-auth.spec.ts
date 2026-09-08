import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
    authorizationCodeGrant,
    cliAuthSearchParams,
    createLoginState,
    createPkceChallenge,
    parseConsoleSession,
    startLoopbackCallback,
} from './cli-auth';

describe('createPkceChallenge()', () => {
    it('derives the challenge from the verifier with S256', () => {
        const { verifier, challenge } = createPkceChallenge();
        expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
    });

    it('does not repeat a verifier', () => {
        expect(createPkceChallenge().verifier).not.toBe(createPkceChallenge().verifier);
        expect(createLoginState()).not.toBe(createLoginState());
    });
});

describe('cliAuthSearchParams()', () => {
    // Console reads these five names and refuses a partial set, so the spelling
    // is the contract rather than a detail.
    it('names the five parameters Console reads', () => {
        expect(
            cliAuthSearchParams({
                redirectUri: 'http://127.0.0.1:1234/auth/callback',
                state: 'state-value',
                challenge: 'challenge-value',
            }),
        ).toEqual({
            client: 'cli',
            redirect_uri: 'http://127.0.0.1:1234/auth/callback',
            state: 'state-value',
            code_challenge: 'challenge-value',
            code_challenge_method: 'S256',
        });
    });
});

describe('authorizationCodeGrant()', () => {
    it('uses the field names the existing token route takes', () => {
        expect(
            authorizationCodeGrant({
                code: 'the-code',
                verifier: 'the-verifier',
                redirectUri: 'http://127.0.0.1:1234/auth/callback',
            }),
        ).toEqual({
            grant_type: 'authorization_code',
            code: 'the-code',
            code_verifier: 'the-verifier',
            redirect_uri: 'http://127.0.0.1:1234/auth/callback',
        });
    });
});

describe('startLoopbackCallback()', () => {
    it('binds the dotted quad and the path Console accepts', async () => {
        const callback = await startLoopbackCallback('state-value');
        try {
            const url = new URL(callback.redirectUri);
            expect(url.protocol).toBe('http:');
            expect(url.hostname).toBe('127.0.0.1');
            expect(url.pathname).toBe('/auth/callback');
            // Console refuses a callback without an explicit port.
            expect(Number(url.port)).toBeGreaterThan(0);
        } finally {
            callback.close();
        }
    });

    it('returns the code the browser arrives with', async () => {
        const callback = await startLoopbackCallback('state-value');
        try {
            const response = await fetch(`${callback.redirectUri}?code=the-code&state=state-value`);
            expect(response.status).toBe(200);
            await expect(callback.code()).resolves.toBe('the-code');
        } finally {
            callback.close();
        }
    });

    it('resolves undefined for a refusal, which the poll reports instead', async () => {
        const callback = await startLoopbackCallback('state-value');
        try {
            await fetch(`${callback.redirectUri}?error=access_denied&state=state-value`);
            await expect(callback.code()).resolves.toBeUndefined();
        } finally {
            callback.close();
        }
    });

    it('ignores a callback that does not carry the state this run generated', async () => {
        const callback = await startLoopbackCallback('state-value');
        try {
            const wrong = await fetch(`${callback.redirectUri}?code=injected&state=someone-else`);
            expect(wrong.status).toBe(400);
            const missing = await fetch(`${callback.redirectUri}?code=injected`);
            expect(missing.status).toBe(400);
            // Still waiting for the real one, and it still wins.
            await fetch(`${callback.redirectUri}?code=the-code&state=state-value`);
            await expect(callback.code()).resolves.toBe('the-code');
        } finally {
            callback.close();
        }
    });

    it('answers anything off the callback path with 404', async () => {
        const callback = await startLoopbackCallback('state-value');
        try {
            const response = await fetch(`${new URL(callback.redirectUri).origin}/elsewhere`);
            expect(response.status).toBe(404);
        } finally {
            callback.close();
        }
    });

    it('unblocks a waiter when it is closed, so closing never hangs a caller', async () => {
        const callback = await startLoopbackCallback('state-value');
        const pending = callback.code();
        callback.close();
        await expect(pending).resolves.toBeUndefined();
    });

    it('can be closed twice, because every path that ends a link closes it', async () => {
        const callback = await startLoopbackCallback('state-value');
        callback.close();
        expect(() => callback.close()).not.toThrow();
    });

    it('keeps the first code when a second callback arrives', async () => {
        const callback = await startLoopbackCallback('state-value');
        try {
            await fetch(`${callback.redirectUri}?code=first&state=state-value`);
            await fetch(`${callback.redirectUri}?code=second&state=state-value`);
            await expect(callback.code()).resolves.toBe('first');
        } finally {
            callback.close();
        }
    });

    it('does not let the answer be stored anywhere the code outlives the tab', async () => {
        const callback = await startLoopbackCallback('state-value');
        try {
            const response = await fetch(`${callback.redirectUri}?code=the-code&state=state-value`);
            expect(response.headers.get('cache-control')).toBe('no-store');
        } finally {
            callback.close();
        }
    });
});

describe('parseConsoleSession()', () => {
    const now = 1_000_000;

    it('reads the token response and turns the lifetime into an expiry', () => {
        expect(
            parseConsoleSession(
                {
                    access_token: 'vcli_access',
                    token_type: 'Bearer',
                    expires_in: 3600,
                    refresh_token: 'vclr_refresh',
                },
                now,
            ),
        ).toEqual({
            accessToken: 'vcli_access',
            refreshToken: 'vclr_refresh',
            expiresAt: now + 3_600_000,
        });
    });

    it('accepts a response with no refresh token', () => {
        expect(
            parseConsoleSession({ access_token: 'vcli_access', token_type: 'Bearer', expires_in: 60 }, now)
                .refreshToken,
        ).toBeUndefined();
    });

    it.each([
        ['no access token', { token_type: 'Bearer', expires_in: 60 }, /invalid access token/],
        [
            'an empty access token',
            { access_token: '', token_type: 'Bearer', expires_in: 60 },
            /invalid access token/,
        ],
        [
            'an unsupported token type',
            { access_token: 'a', token_type: 'Basic', expires_in: 60 },
            /token type/,
        ],
        ['no lifetime', { access_token: 'a', token_type: 'Bearer' }, /token lifetime/],
        [
            'a non-numeric lifetime',
            { access_token: 'a', token_type: 'Bearer', expires_in: '60' },
            /token lifetime/,
        ],
        // A lifetime at or before now is a dead token described as a live one.
        ['a zero lifetime', { access_token: 'a', token_type: 'Bearer', expires_in: 0 }, /token lifetime/],
        [
            'a negative lifetime',
            { access_token: 'a', token_type: 'Bearer', expires_in: -3600 },
            /token lifetime/,
        ],
        [
            'an absurd lifetime',
            { access_token: 'a', token_type: 'Bearer', expires_in: 1e15 },
            /token lifetime/,
        ],
        [
            'a fractional lifetime',
            { access_token: 'a', token_type: 'Bearer', expires_in: 1.5 },
            /token lifetime/,
        ],
        ['a response that is not an object', 'nope', /malformed token response/],
    ])('refuses a response with %s', (_label, value, message) => {
        expect(() => parseConsoleSession(value, now)).toThrow(message);
    });
});
