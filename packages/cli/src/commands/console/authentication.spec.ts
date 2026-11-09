import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConsoleTokenGrantError, loginWithBrowser, refreshSession } from '../../index';

const token = { access_token: 'access', refresh_token: 'rotated', token_type: 'Bearer', expires_in: 60 };
const now = () => 1_000;
const tokenFetch = vi.fn<typeof fetch>();

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    tokenFetch.mockReset();
});

function callbackUrl(authorizationUrl: string, values: Record<string, string>): string {
    const authorization = new URL(authorizationUrl);
    const callback = new URL(authorization.searchParams.get('redirect_uri') ?? '');
    callback.searchParams.set('state', authorization.searchParams.get('state') ?? '');
    for (const [key, value] of Object.entries(values)) callback.searchParams.set(key, value);
    return callback.toString();
}

describe('public Console browser login', () => {
    it.each(['cli', 'create'] as const)('logs in as %s and closes the listener', async client => {
        let authorizationUrl = '';
        tokenFetch.mockResolvedValue(Response.json(token));
        const session = await loginWithBrowser({
            client,
            fetch: tokenFetch,
            now,
            openBrowser: async url => {
                authorizationUrl = url;
                expect(new URL(url).pathname).toBe('/cli-auth');
                expect(new URL(url).searchParams.get('client')).toBe(client);
                const response = await fetch(callbackUrl(url, { code: 'code' }));
                expect(response.headers.get('cache-control')).toBe('no-store');
                return true;
            },
        });
        expect(session).toEqual({ accessToken: 'access', refreshToken: 'rotated', expiresAt: 61_000 });
        const [tokenUrl, init] = tokenFetch.mock.calls[0];
        expect(tokenUrl).toBe('https://api.vendure.io/v1/auth/cli/token');
        expect(init?.redirect).toBe('error');
        const grant = JSON.parse(init?.body as string);
        expect(grant.grant_type).toBe('authorization_code');
        expect(grant.code).toBe('code');
        expect(createHash('sha256').update(grant.code_verifier).digest('base64url')).toBe(
            new URL(authorizationUrl).searchParams.get('code_challenge'),
        );
        await expect(fetch(callbackUrl(authorizationUrl, {}))).rejects.toThrow();
    });

    it('rejects denied login without a token request', async () => {
        await expect(
            loginWithBrowser({
                client: 'cli',
                fetch: tokenFetch,
                openBrowser: async url => {
                    await fetch(callbackUrl(url, { error: 'access_denied', code: 'ignored' }));
                    return true;
                },
            }),
        ).rejects.toThrow(/authoriz|refused/i);
        expect(tokenFetch).not.toHaveBeenCalled();
    });

    it('rejects invalid state and closes the listener', async () => {
        let callback = '';
        await expect(
            loginWithBrowser({
                client: 'cli',
                fetch: tokenFetch,
                openBrowser: async url => {
                    callback = callbackUrl(url, { state: 'wrong', code: 'injected' });
                    expect((await fetch(callback)).status).toBe(400);
                    return true;
                },
            }),
        ).rejects.toThrow(/state/i);
        expect(tokenFetch).not.toHaveBeenCalled();
        await expect(fetch(callback)).rejects.toThrow();
    });

    it.each([false, 'throw'])('reports the URL on browser-open failure %s', async failure => {
        tokenFetch.mockResolvedValue(Response.json(token));
        let sent: Promise<Response> | undefined;
        const reportAuthorizationUrl = vi.fn((url: string) => {
            sent = fetch(callbackUrl(url, { code: 'manual-code' }));
        });
        await expect(
            loginWithBrowser({
                client: 'create',
                fetch: tokenFetch,
                reportAuthorizationUrl,
                openBrowser: () =>
                    failure === false ? Promise.resolve(false) : Promise.reject(new Error('no browser')),
            }),
        ).resolves.toMatchObject({ accessToken: 'access' });
        await sent;
        expect(reportAuthorizationUrl).toHaveBeenCalledOnce();
    });

    it('times out even when the browser opener never settles', async () => {
        let callback = '';
        await expect(
            loginWithBrowser({
                client: 'cli',
                timeoutMs: 20,
                openBrowser: url => {
                    callback = callbackUrl(url, {});
                    return new Promise(() => undefined);
                },
            }),
        ).rejects.toThrow(/timed out/i);
        await expect(fetch(callback)).rejects.toThrow();
    });

    it('cancels pending login and removes its abort listener', async () => {
        const controller = new AbortController();
        const remove = vi.spyOn(controller.signal, 'removeEventListener');
        let callback = '';
        await expect(
            loginWithBrowser({
                client: 'cli',
                signal: controller.signal,
                openBrowser: url => {
                    callback = callbackUrl(url, {});
                    controller.abort();
                    return Promise.resolve(true);
                },
            }),
        ).rejects.toMatchObject({ name: 'AbortError' });
        expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
        await expect(fetch(callback)).rejects.toThrow();
    });

    it('does not open a browser for an already cancelled login', async () => {
        const openBrowser = vi.fn();
        await expect(
            loginWithBrowser({ client: 'cli', signal: AbortSignal.abort('cancelled'), openBrowser }),
        ).rejects.toMatchObject({ name: 'AbortError' });
        expect(openBrowser).not.toHaveBeenCalled();
    });

    it.each([Infinity, NaN, 0, -1, 2_147_483_648])(
        'rejects an invalid callback deadline %s before opening a browser',
        async timeoutMs => {
            const openBrowser = vi.fn(() => Promise.resolve(true));
            await expect(loginWithBrowser({ client: 'cli', timeoutMs, openBrowser })).rejects.toThrow(
                'Invalid login timeout.',
            );
            expect(openBrowser).not.toHaveBeenCalled();
        },
    );

    it('wraps malformed login tokens as transient grant errors', async () => {
        tokenFetch.mockResolvedValue(Response.json({ ...token, token_type: 'Basic' }));
        await expect(
            loginWithBrowser({
                client: 'cli',
                fetch: tokenFetch,
                openBrowser: async url => {
                    await fetch(callbackUrl(url, { code: 'code' }));
                    return true;
                },
            }),
        ).rejects.toMatchObject({ name: 'ConsoleTokenGrantError', refused: false });
    });

    it('prints the URL with the default reporter when opening fails', async () => {
        tokenFetch.mockResolvedValue(Response.json(token));
        let callback: Promise<Response> | undefined;
        const write = vi.spyOn(process.stdout, 'write').mockImplementation(value => {
            callback = fetch(callbackUrl(String(value).trim(), { code: 'code' }));
            return true;
        });
        await loginWithBrowser({
            client: 'cli',
            fetch: tokenFetch,
            openBrowser: () => Promise.resolve(false),
        });
        await callback;
        expect(write).toHaveBeenCalledOnce();
    });

    it.each([
        ['https://console.vendure.io', 'https://staging.api.vendure.io'],
        ['https://untrusted.example', 'https://api.vendure.io'],
        ['https://user:password@console.vendure.io', 'https://api.vendure.io'],
        ['https://console.vendure.io/path', 'https://api.vendure.io'],
        ['https://console.vendure.io?query=x', 'https://api.vendure.io'],
        ['https://console.vendure.io#fragment', 'https://api.vendure.io'],
    ])('rejects untrusted pair %s %s before browser use', async (appOrigin, apiOrigin) => {
        const openBrowser = vi.fn();
        await expect(
            loginWithBrowser({ client: 'cli', appOrigin, apiOrigin, openBrowser }),
        ).rejects.toThrow();
        expect(openBrowser).not.toHaveBeenCalled();
    });

    it.each([
        ['https://staging.console.vendure.io', 'https://staging.api.vendure.io'],
        ['http://localhost:3000', 'http://127.0.0.1:3001'],
    ])('accepts the trusted pair %s %s', async (appOrigin, apiOrigin) => {
        tokenFetch.mockResolvedValue(Response.json(token));
        await loginWithBrowser({
            client: 'cli',
            appOrigin,
            apiOrigin,
            fetch: tokenFetch,
            openBrowser: async url => {
                expect(new URL(url).origin).toBe(appOrigin);
                await fetch(callbackUrl(url, { code: 'code' }));
                return true;
            },
        });
        expect(tokenFetch.mock.calls[0][0]).toBe(`${apiOrigin}/v1/auth/cli/token`);
    });
});

describe('public Console refresh', () => {
    it('uses the refresh grant and returns the rotated token', async () => {
        tokenFetch.mockResolvedValue(Response.json(token));
        await expect(refreshSession('original', { fetch: tokenFetch, now })).resolves.toEqual({
            accessToken: 'access',
            refreshToken: 'rotated',
            expiresAt: 61_000,
        });
        expect(JSON.parse(tokenFetch.mock.calls[0][1]?.body as string)).toEqual({
            grant_type: 'refresh_token',
            refresh_token: 'original',
        });
    });

    it('retains the old refresh token when no replacement is issued', async () => {
        tokenFetch.mockResolvedValue(Response.json({ ...token, refresh_token: undefined }));
        await expect(refreshSession('original', { fetch: tokenFetch })).resolves.toMatchObject({
            refreshToken: 'original',
        });
    });

    it.each([
        [400, { code: 'cli_session.invalid_grant' }, true],
        [403, { code: 'proxy.denied' }, false],
        [503, { code: 'cli_session.invalid_grant' }, false],
        [429, {}, false],
    ])('classifies HTTP %s from the Console code %j', async (status, body, refused) => {
        tokenFetch.mockResolvedValue(Response.json(body, { status }));
        const error = await refreshSession('original', { fetch: tokenFetch }).catch(value => value);
        expect(error).toBeInstanceOf(ConsoleTokenGrantError);
        expect(error.refused).toBe(refused);
    });

    it.each([null, {}, { ...token, expires_in: 0 }, { ...token, refresh_token: '' }])(
        'treats malformed reply %j as transient',
        async body => {
            tokenFetch.mockResolvedValue(Response.json(body));
            await expect(refreshSession('original', { fetch: tokenFetch })).rejects.toMatchObject({
                refused: false,
            });
        },
    );

    it('treats network failure as transient', async () => {
        tokenFetch.mockRejectedValue(new Error('network unavailable'));
        await expect(refreshSession('original', { fetch: tokenFetch })).rejects.toMatchObject({
            refused: false,
        });
    });

    it.each([true, false])('bounds stalled response headers=%s to ten seconds', async headers => {
        vi.useFakeTimers();
        const clear = vi.spyOn(globalThis, 'clearTimeout');
        tokenFetch.mockImplementation(() =>
            headers
                ? Promise.resolve(
                      new Response(
                          new ReadableStream({
                              start() {
                                  /* Keep the body pending. */
                              },
                          }),
                      ),
                  )
                : new Promise(() => undefined),
        );
        const result = expect(refreshSession('original', { fetch: tokenFetch })).rejects.toMatchObject({
            refused: false,
        });
        await vi.advanceTimersByTimeAsync(10_000);
        await result;
        expect(clear).toHaveBeenCalled();
    });

    it('bounds a stalled refusal body and treats it as transient', async () => {
        vi.useFakeTimers();
        tokenFetch.mockResolvedValue(new Response(new ReadableStream(), { status: 400 }));
        const result = expect(refreshSession('original', { fetch: tokenFetch })).rejects.toMatchObject({
            refused: false,
        });
        await vi.advanceTimersByTimeAsync(10_000);
        await result;
    });

    it('treats invalid JSON as transient', async () => {
        tokenFetch.mockResolvedValue(new Response('invalid-json', { status: 400 }));
        await expect(refreshSession('original', { fetch: tokenFetch })).rejects.toMatchObject({
            refused: false,
        });
    });

    it('rejects a token response larger than 64 KiB', async () => {
        tokenFetch.mockResolvedValue(Response.json({ ...token, access_token: 'x'.repeat(64 * 1024) }));
        await expect(refreshSession('original', { fetch: tokenFetch })).rejects.toMatchObject({
            refused: false,
        });
    });

    it('does not send a grant when already cancelled', async () => {
        await expect(
            refreshSession('original', { fetch: tokenFetch, signal: AbortSignal.abort('cancelled') }),
        ).rejects.toMatchObject({ name: 'AbortError' });
        expect(tokenFetch).not.toHaveBeenCalled();
    });

    it('distinguishes cancellation from grant refusal', async () => {
        const controller = new AbortController();
        tokenFetch.mockImplementation(() => {
            controller.abort();
            return new Promise(() => undefined);
        });
        await expect(
            refreshSession('original', { fetch: tokenFetch, signal: controller.signal }),
        ).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('rejects an untrusted API before sending the refresh token', async () => {
        await expect(
            refreshSession('original', { apiOrigin: 'https://evil.example', fetch: tokenFetch }),
        ).rejects.toThrow();
        expect(tokenFetch).not.toHaveBeenCalled();
    });
});
