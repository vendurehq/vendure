import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveMcpPluginOptions } from '../resolve-options';
import { McpPluginOptions } from '../types';

import { McpRateLimiterService, McpRateLimitExceededError } from './mcp-rate-limiter.service';

/**
 * In-memory CacheService stand-in that honours the TTL passed on write, which is what a shared
 * cache such as Redis does. `cacheClock` is the clock the cache itself judges expiry by: it
 * defaults to the test's (fake) system clock, and the clock-skew tests below pass a separate one
 * so the cache's idea of time can differ from the server's.
 */
function makeCache(cacheClock: () => number = () => Date.now()) {
    const store = new Map<string, { value: unknown; expiresAt: number }>();
    return {
        get: (key: string) => {
            const entry = store.get(key);
            if (!entry || entry.expiresAt <= cacheClock()) {
                return Promise.resolve(undefined);
            }
            return Promise.resolve(entry.value);
        },
        set: (key: string, value: unknown, options?: { ttl?: number }) => {
            store.set(key, { value, expiresAt: cacheClock() + (options?.ttl ?? 0) });
            return Promise.resolve();
        },
    };
}

function build(options: McpPluginOptions, cacheClock?: () => number) {
    const cache = makeCache(cacheClock);
    const service = new McpRateLimiterService(cache as any, resolveMcpPluginOptions(options));
    return { service };
}

/** An execution context with a distinct Vendure session token (per-subject keying). */
function sessionCtx(token: string) {
    return { ctx: { session: { token } }, clientIp: undefined } as any;
}

/** An anonymous shop execution context keyed by client IP (no session, no grant). */
function anonCtx(ip: string) {
    return { ctx: { session: undefined }, clientIp: ip } as any;
}

/** An anonymous HTTP shop context: a minted session token plus a client IP (no OAuth grant). */
function anonHttpCtx(token: string, ip: string) {
    return { ctx: { session: { token } }, clientIp: ip } as any;
}

/** A signed-in caller: one conversation's session token plus the id of the user it belongs to. */
function userCtx(token: string, userId: string) {
    return { ctx: { session: { token }, activeUserId: userId } } as any;
}

/** An OAuth caller: the grant's own session, the user who consented, and the client record used. */
function oauthCtx(token: string, userId: string, oauthClientId: string) {
    return {
        ctx: { session: { token }, activeUserId: userId },
        grant: { id: `${oauthClientId}:${token}`, oauthClientId },
    } as any;
}

describe('McpRateLimiterService rate limiting', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('consumes a bucket up to the limit, then reports exceeded with retry metadata', async () => {
        const { service } = build({
            rateLimits: { perSession: { rpm: 2 }, perClient: { rpm: 0 }, anonymousIp: false },
        });
        const ctx = sessionCtx('subject-a');
        await service.enforceRateLimit({ executionContext: ctx, endpoint: 'admin', subject: 'ping' });
        await service.enforceRateLimit({ executionContext: ctx, endpoint: 'admin', subject: 'ping' });

        const exceeded = await service.checkRateLimit({
            executionContext: ctx,
            endpoint: 'admin',
            subject: 'ping',
        });
        expect(exceeded).toBeDefined();
        expect(exceeded?.scope).toBe('session');
        expect(exceeded?.retryAfterSeconds).toBeGreaterThan(0);
        expect(exceeded?.retryAfterSeconds).toBeLessThanOrEqual(60);
        expect(exceeded?.message).toMatch(/Retry after \d+ seconds\./);
    });

    it('enforceRateLimit throws McpRateLimitExceededError once over the limit', async () => {
        const { service } = build({
            rateLimits: { perSession: { rpm: 1 }, perClient: { rpm: 0 }, anonymousIp: false },
        });
        const ctx = sessionCtx('subject-a');
        await service.enforceRateLimit({ executionContext: ctx, endpoint: 'admin', subject: 'ping' });
        await expect(
            service.enforceRateLimit({ executionContext: ctx, endpoint: 'admin', subject: 'ping' }),
        ).rejects.toBeInstanceOf(McpRateLimitExceededError);
    });

    it('resets the bucket after the 60s window elapses', async () => {
        const { service } = build({
            rateLimits: { perSession: { rpm: 1 }, perClient: { rpm: 0 }, anonymousIp: false },
        });
        const ctx = sessionCtx('subject-a');
        await service.enforceRateLimit({ executionContext: ctx, endpoint: 'admin', subject: 'ping' });
        expect(
            await service.checkRateLimit({ executionContext: ctx, endpoint: 'admin', subject: 'ping' }),
        ).toBeDefined();

        vi.setSystemTime(new Date('2026-01-01T00:01:01Z')); // +61s
        expect(
            await service.checkRateLimit({ executionContext: ctx, endpoint: 'admin', subject: 'ping' }),
        ).toBeUndefined();
    });

    it('keys per subject — exhausting subject A does not limit subject B', async () => {
        const { service } = build({
            rateLimits: { perSession: { rpm: 1 }, perClient: { rpm: 0 }, anonymousIp: false },
        });
        const a = sessionCtx('subject-a');
        const b = sessionCtx('subject-b');
        await service.enforceRateLimit({ executionContext: a, endpoint: 'admin', subject: 'ping' });
        expect(
            await service.checkRateLimit({ executionContext: a, endpoint: 'admin', subject: 'ping' }),
        ).toBeDefined();
        expect(
            await service.checkRateLimit({ executionContext: b, endpoint: 'admin', subject: 'ping' }),
        ).toBeUndefined();
    });

    it('applies the anonymous-IP limit on shop and reports the anonymous IP scope', async () => {
        const { service } = build({
            rateLimits: { perSession: { rpm: 0 }, perClient: { rpm: 0 }, anonymousIp: { rpm: 2 } },
        });
        await service.checkAnonymousIpRateLimit('shop', '1.2.3.4');
        await service.checkAnonymousIpRateLimit('shop', '1.2.3.4');
        await expect(service.checkAnonymousIpRateLimit('shop', '1.2.3.4')).resolves.toMatchObject({
            scope: 'anonymous IP',
        });
    });

    it('charges the anonymous-IP bucket at the edge only, never again in the shared pass', async () => {
        const { service } = build({
            rateLimits: { perSession: { rpm: 0 }, perClient: { rpm: 0 }, anonymousIp: { rpm: 2 } },
        });
        const ctx = anonCtx('1.2.3.4');
        // The transport charges this bucket once per request, before the context exists. If the shared
        // pass charged it again, an anonymous caller would get half the configured allowance.
        await service.checkAnonymousIpRateLimit('shop', '1.2.3.4');
        await service.checkRateLimit({ executionContext: ctx, endpoint: 'shop', subject: 'tools/call' });
        await service.checkAnonymousIpRateLimit('shop', '1.2.3.4');
        await expect(service.checkAnonymousIpRateLimit('shop', '1.2.3.4')).resolves.toMatchObject({
            scope: 'anonymous IP',
        });
    });

    it('does not apply the anonymous-IP limit when disabled (anonymousIp: false)', async () => {
        const { service } = build({
            rateLimits: { perSession: { rpm: 0 }, perClient: { rpm: 0 }, anonymousIp: false },
        });
        for (let i = 0; i < 5; i++) {
            await expect(service.checkAnonymousIpRateLimit('shop', '1.2.3.4')).resolves.toBeUndefined();
        }
    });

    it('does not apply the anonymous-IP limit on the admin endpoint', async () => {
        const { service } = build({
            rateLimits: { perSession: { rpm: 0 }, perClient: { rpm: 0 }, anonymousIp: { rpm: 1 } },
        });
        for (let i = 0; i < 3; i++) {
            await expect(service.checkAnonymousIpRateLimit('admin', '1.2.3.4')).resolves.toBeUndefined();
        }
    });

    it('counts correctly under concurrency — 20 simultaneous requests cannot exceed the limit', async () => {
        const { service } = build({
            rateLimits: { perSession: { rpm: 5 }, perClient: { rpm: 0 }, anonymousIp: false },
        });
        const ctx = sessionCtx('subject-a');
        // Before the read and write were combined into one queued step, every overlapping request
        // read the same count and wrote count + 1, so all 20 were allowed. Increments now queue
        // per bucket key.
        const results = await Promise.all(
            Array.from({ length: 20 }, () =>
                service.checkRateLimit({ executionContext: ctx, endpoint: 'admin', subject: 'ping' }),
            ),
        );
        const allowed = results.filter(result => result === undefined).length;
        expect(allowed).toBe(5);
    });

    it('limits an anonymous HTTP caller across fresh session tokens (per-session bucket keys on IP)', async () => {
        const { service } = build({
            rateLimits: { perSession: { rpm: 2 }, perClient: { rpm: 0 }, anonymousIp: false },
        });
        // A caller that omits the session header gets a fresh session token on every request. The
        // bucket must survive the token change, so these callers are keyed by IP instead.
        await service.enforceRateLimit({
            executionContext: anonHttpCtx('fresh-1', '1.2.3.4'),
            endpoint: 'shop',
            subject: 'ping',
        });
        await service.enforceRateLimit({
            executionContext: anonHttpCtx('fresh-2', '1.2.3.4'),
            endpoint: 'shop',
            subject: 'ping',
        });
        await expect(
            service.enforceRateLimit({
                executionContext: anonHttpCtx('fresh-3', '1.2.3.4'),
                endpoint: 'shop',
                subject: 'ping',
            }),
        ).rejects.toBeInstanceOf(McpRateLimitExceededError);
    });

    it('limits an anonymous HTTP caller per tool across fresh session tokens', async () => {
        const { service } = build({
            rateLimits: {
                perSession: { rpm: 0 },
                perClient: { rpm: 0 },
                anonymousIp: false,
                perTool: { apply_coupon_code: { rpm: 1 } },
            },
        });
        await service.enforceRateLimit({
            executionContext: anonHttpCtx('fresh-1', '1.2.3.4'),
            endpoint: 'shop',
            subject: 'apply_coupon_code',
        });
        await expect(
            service.enforceRateLimit({
                executionContext: anonHttpCtx('fresh-2', '1.2.3.4'),
                endpoint: 'shop',
                subject: 'apply_coupon_code',
            }),
        ).rejects.toMatchObject({ details: { scope: 'tool:apply_coupon_code' } });
    });

    it('applies the OAuth-IP limit and reports the OAuth IP scope', async () => {
        const { service } = build({
            rateLimits: {
                perSession: { rpm: 0 },
                perClient: { rpm: 0 },
                anonymousIp: false,
                oauthIp: { rpm: 2 },
            },
        });
        await service.enforceOauthIpRateLimit('1.2.3.4');
        await service.enforceOauthIpRateLimit('1.2.3.4');
        await expect(service.enforceOauthIpRateLimit('1.2.3.4')).rejects.toMatchObject({
            details: { scope: 'OAuth IP' },
        });
    });

    it('keys the OAuth-IP bucket per IP — exhausting one IP does not limit another', async () => {
        const { service } = build({
            rateLimits: {
                perSession: { rpm: 0 },
                perClient: { rpm: 0 },
                anonymousIp: false,
                oauthIp: { rpm: 1 },
            },
        });
        await service.enforceOauthIpRateLimit('1.2.3.4');
        await expect(service.enforceOauthIpRateLimit('1.2.3.4')).rejects.toBeInstanceOf(
            McpRateLimitExceededError,
        );
        await expect(service.enforceOauthIpRateLimit('5.6.7.8')).resolves.toBeUndefined();
    });

    it('does not apply the OAuth-IP limit when disabled (oauthIp: false)', async () => {
        const { service } = build({
            rateLimits: { perSession: { rpm: 0 }, perClient: { rpm: 0 }, anonymousIp: false, oauthIp: false },
        });
        for (let i = 0; i < 5; i++) {
            await expect(service.enforceOauthIpRateLimit('1.2.3.4')).resolves.toBeUndefined();
        }
    });

    it('does not apply the OAuth-IP limit when rpm is 0', async () => {
        const { service } = build({
            rateLimits: {
                perSession: { rpm: 0 },
                perClient: { rpm: 0 },
                anonymousIp: false,
                oauthIp: { rpm: 0 },
            },
        });
        for (let i = 0; i < 5; i++) {
            await expect(service.enforceOauthIpRateLimit('1.2.3.4')).resolves.toBeUndefined();
        }
    });

    it('populates retryAfterSeconds when the OAuth-IP bucket is exceeded', async () => {
        const { service } = build({
            rateLimits: {
                perSession: { rpm: 0 },
                perClient: { rpm: 0 },
                anonymousIp: false,
                oauthIp: { rpm: 1 },
            },
        });
        await service.enforceOauthIpRateLimit('1.2.3.4');
        try {
            await service.enforceOauthIpRateLimit('1.2.3.4');
            expect.unreachable('expected enforceOauthIpRateLimit to throw');
        } catch (e) {
            expect(e).toBeInstanceOf(McpRateLimitExceededError);
            const exceeded = e as McpRateLimitExceededError;
            expect(exceeded.details.retryAfterSeconds).toBeGreaterThan(0);
            expect(exceeded.details.retryAfterSeconds).toBeLessThanOrEqual(60);
        }
    });

    it('keeps in-process callers (no grant, no client IP) on separate per-session buckets', async () => {
        const { service } = build({
            rateLimits: { perSession: { rpm: 1 }, perClient: { rpm: 0 }, anonymousIp: false },
        });
        // McpToolExecutionService passes { ctx } with no clientIp. Two merchant-assistant users
        // must not share a bucket; that would make perSession a store-wide limit.
        await service.enforceRateLimit({
            executionContext: sessionCtx('assistant-user-a'),
            endpoint: 'shop',
            subject: 'tools/call',
        });
        await expect(
            service.enforceRateLimit({
                executionContext: sessionCtx('assistant-user-b'),
                endpoint: 'shop',
                subject: 'tools/call',
            }),
        ).resolves.toBeUndefined();
    });

    it('counts one user across their separate sessions and reports the user scope', async () => {
        const { service } = build({
            rateLimits: {
                perSession: { rpm: 0 },
                perUser: { rpm: 2 },
                perClient: { rpm: 0 },
                anonymousIp: false,
            },
        });
        // These are two conversations for one person: each has its own session bucket, and they
        // share the user bucket.
        await service.enforceRateLimit({
            executionContext: userCtx('chat-1', 'user-7'),
            endpoint: 'shop',
            subject: 'ping',
        });
        await service.enforceRateLimit({
            executionContext: userCtx('chat-2', 'user-7'),
            endpoint: 'shop',
            subject: 'ping',
        });
        await expect(
            service.enforceRateLimit({
                executionContext: userCtx('chat-3', 'user-7'),
                endpoint: 'shop',
                subject: 'ping',
            }),
        ).rejects.toMatchObject({ details: { scope: 'user' } });
    });

    it('keeps two users on separate per-user buckets', async () => {
        const { service } = build({
            rateLimits: {
                perSession: { rpm: 0 },
                perUser: { rpm: 1 },
                perClient: { rpm: 0 },
                anonymousIp: false,
            },
        });
        await service.enforceRateLimit({
            executionContext: userCtx('chat-1', 'user-7'),
            endpoint: 'shop',
            subject: 'ping',
        });
        await expect(
            service.enforceRateLimit({
                executionContext: userCtx('chat-1', 'user-8'),
                endpoint: 'shop',
                subject: 'ping',
            }),
        ).resolves.toBeUndefined();
    });

    it('keeps counting a user after they re-authorize into a new grant and client record', async () => {
        const { service } = build({
            rateLimits: {
                perSession: { rpm: 0 },
                perUser: { rpm: 1 },
                perClient: { rpm: 0 },
                anonymousIp: false,
            },
        });
        // Authorizing again gives this person a new grant with a new session, and registering again
        // gives them a new client record, so the session and client buckets both start fresh. The
        // user bucket has to keep counting, or anyone who can run the authorization flow could reset
        // their own limits at will.
        await service.enforceRateLimit({
            executionContext: oauthCtx('grant-1', 'user-7', 'client-1'),
            endpoint: 'shop',
            subject: 'ping',
        });
        await expect(
            service.enforceRateLimit({
                executionContext: oauthCtx('grant-2', 'user-7', 'client-2'),
                endpoint: 'shop',
                subject: 'ping',
            }),
        ).rejects.toMatchObject({ details: { scope: 'user' } });
    });

    it('shares one client bucket across the grants of a single OAuth client', async () => {
        const { service } = build({
            rateLimits: {
                perSession: { rpm: 0 },
                perUser: { rpm: 0 },
                perClient: { rpm: 2 },
                anonymousIp: false,
            },
        });
        // Every shopper using one client shares its bucket, which is why the default is high.
        await service.enforceRateLimit({
            executionContext: oauthCtx('grant-1', 'user-7', 'client-1'),
            endpoint: 'shop',
            subject: 'ping',
        });
        await service.enforceRateLimit({
            executionContext: oauthCtx('grant-2', 'user-8', 'client-1'),
            endpoint: 'shop',
            subject: 'ping',
        });
        await expect(
            service.enforceRateLimit({
                executionContext: oauthCtx('grant-3', 'user-9', 'client-1'),
                endpoint: 'shop',
                subject: 'ping',
            }),
        ).rejects.toMatchObject({ details: { scope: 'OAuth client' } });
        await expect(
            service.enforceRateLimit({
                executionContext: oauthCtx('grant-4', 'user-7', 'client-2'),
                endpoint: 'shop',
                subject: 'ping',
            }),
        ).resolves.toBeUndefined();
    });

    it('gives an anonymous shop caller no per-user bucket', async () => {
        const { service } = build({
            rateLimits: {
                perSession: { rpm: 0 },
                perUser: { rpm: 1 },
                perClient: { rpm: 0 },
                anonymousIp: false,
            },
        });
        // Nobody is signed in, so there is no user to key on; anonymousIp covers these callers.
        await service.enforceRateLimit({
            executionContext: anonHttpCtx('fresh-1', '1.2.3.4'),
            endpoint: 'shop',
            subject: 'ping',
        });
        await expect(
            service.enforceRateLimit({
                executionContext: anonHttpCtx('fresh-2', '1.2.3.4'),
                endpoint: 'shop',
                subject: 'ping',
            }),
        ).resolves.toBeUndefined();
    });
});

describe('McpRateLimiterService shared buckets across instances with skewed clocks', () => {
    const START = new Date('2026-01-01T00:00:00Z').getTime();

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(START));
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    const soloSession: McpPluginOptions = {
        rateLimits: { perSession: { rpm: 1 }, perClient: { rpm: 0 }, anonymousIp: false },
    };

    it('keeps counting a bucket that a fast-running instance would think had already reset', async () => {
        // The cache keeps its own clock (as Redis does), and the server's clock runs 90s ahead of it.
        const { service } = build(soloSession, () => START);
        const ctx = sessionCtx('skew-a');
        await service.enforceRateLimit({ executionContext: ctx, endpoint: 'admin', subject: 'ping' });

        vi.setSystemTime(new Date(START + 90_000));
        // The cache entry is still alive, so the limit must still apply even though the stored
        // resetAt is in this instance's past.
        expect(
            await service.checkRateLimit({ executionContext: ctx, endpoint: 'admin', subject: 'ping' }),
        ).toBeDefined();
    });

    it('never advertises a Retry-After longer than the window, even from a slow-running instance', async () => {
        // The bucket was written by an instance whose clock was 90s ahead, so the stored resetAt is
        // 150s in the future as far as this instance is concerned.
        const { service } = build(soloSession);
        const ctx = sessionCtx('skew-b');
        vi.setSystemTime(new Date(START + 90_000));
        await service.enforceRateLimit({ executionContext: ctx, endpoint: 'admin', subject: 'ping' });

        vi.setSystemTime(new Date(START));
        const exceeded = await service.checkRateLimit({
            executionContext: ctx,
            endpoint: 'admin',
            subject: 'ping',
        });
        expect(exceeded?.retryAfterSeconds).toBe(60);
        expect(exceeded?.message).toContain('Retry after 60 seconds');
    });
});
