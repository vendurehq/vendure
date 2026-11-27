import { Logger } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { getBearerToken } from '../get-bearer-token';

import { hashLocalTrustSecret, LOCAL_TRUST_OFF, LocalTrustActivation } from './local-trust-activation';
import { hostnameOfHostHeader, LocalTrustRequest, LocalTrustService } from './local-trust.service';
import { isLoopbackSocketAddress } from './loopback-socket-address';

const SECRET = 'dGhpcy1pcy1hLXRlc3Qtc2VjcmV0LW9mLTMyLWJ5dGVz';

function service(
    options: {
        activation?: LocalTrustActivation;
        isServer?: boolean;
        apiOptions?: { hostname?: string; port: number };
        leftoverSessions?: string[];
    } = {},
) {
    const activation = options.activation ?? {
        enabled: true,
        secretHash: hashLocalTrustSecret(SECRET),
        stateFile: '/project/.vendure/devserver.json',
    };
    const rateLimiter = { recordBearerAuthFailure: vi.fn(() => Promise.resolve()) };
    // An in-memory session store, standing in for the session table and its cache.
    const liveSessions = new Set<string>();
    let created = 0;
    const sessionService = {
        createNewAuthenticatedSession: vi.fn(() => {
            const token = `session-${++created}`;
            liveSessions.add(token);
            return Promise.resolve({ token });
        }),
        getSessionFromToken: vi.fn((token: string) =>
            Promise.resolve(liveSessions.has(token) ? { token } : undefined),
        ),
    };
    const sessionCacheStrategy = { delete: vi.fn(() => Promise.resolve()) };
    const deletedSessions: string[] = [];
    const connection = {
        getRepository: () => ({
            findOne: () => Promise.resolve({ id: 1, identifier: 'superadmin', deletedAt: null }),
            find: () => Promise.resolve((options.leftoverSessions ?? []).map(token => ({ token }))),
            delete: ({ token }: { token: string }) => {
                deletedSessions.push(token);
                liveSessions.delete(token);
                return Promise.resolve();
            },
        }),
    };
    const localTrust = new LocalTrustService(
        activation,
        { isServer: options.isServer ?? true } as any,
        {
            apiOptions: options.apiOptions ?? { hostname: '', port: 3000 },
            authOptions: { superadminCredentials: { identifier: 'superadmin' }, sessionCacheStrategy },
        } as any,
        connection as any,
        { create: () => Promise.resolve({}) } as any,
        sessionService as any,
        rateLimiter as any,
    );
    return { localTrust, rateLimiter, sessionService, liveSessions, deletedSessions, sessionCacheStrategy };
}

/** Runs the Admin API middleware on a request, and returns the Authorization header it leaves. */
async function throughAdminApiMiddleware(
    localTrust: LocalTrustService,
    authorization: string,
    headers: Record<string, string> = {},
): Promise<string | undefined> {
    const req = {
        headers: { host: 'localhost:3000', authorization, ...headers },
        socket: { remoteAddress: '127.0.0.1' },
    } as any;
    await new Promise<void>((resolve, reject) =>
        localTrust.adminApiMiddleware()(req, {} as any, (e?: unknown) =>
            e ? reject(e instanceof Error ? e : new Error('middleware failed')) : resolve(),
        ),
    );
    return req.headers.authorization;
}

function request(over: Partial<LocalTrustRequest> & { headers?: LocalTrustRequest['headers'] } = {}) {
    return {
        socketAddress: over.socketAddress ?? '127.0.0.1',
        headers: { host: 'localhost:3000', ...over.headers },
    };
}

describe('LocalTrustService.verify', () => {
    it('accepts the secret from a loopback client naming a local host', () => {
        expect(service().localTrust.verify(request(), SECRET)).toBe(true);
    });

    it.each(['127.0.0.1', '127.8.9.10', '::1', '::ffff:127.0.0.1'])(
        'accepts the loopback socket address %s',
        socketAddress => {
            expect(service().localTrust.verify(request({ socketAddress }), SECRET)).toBe(true);
        },
    );

    it.each([
        ['localhost', 'localhost'],
        ['127.0.0.1:3000', '127.0.0.1 with a port'],
        ['[::1]:3000', 'bracketed ::1 with a port'],
        ['LOCALHOST:3000', 'upper case'],
    ])('accepts a Host of %s (%s)', host => {
        expect(service().localTrust.verify(request({ headers: { host } }), SECRET)).toBe(true);
    });

    it('refuses a wrong secret', () => {
        expect(service().localTrust.verify(request(), `${SECRET}x`)).toBe(false);
        expect(service().localTrust.verify(request(), 'short')).toBe(false);
    });

    it('refuses a missing secret', () => {
        expect(service().localTrust.verify(request(), undefined)).toBe(false);
        expect(service().localTrust.verify(request(), '')).toBe(false);
    });

    it('refuses every secret while local trust is off', () => {
        const { localTrust } = service({ activation: LOCAL_TRUST_OFF });
        expect(localTrust.verify(request(), SECRET)).toBe(false);
        expect(localTrust.isEnabled()).toBe(false);
    });

    it('refuses every secret in a process that is not the main server', () => {
        const { localTrust } = service({ isServer: false });
        expect(localTrust.verify(request(), SECRET)).toBe(false);
        expect(localTrust.isEnabled()).toBe(false);
    });

    it.each(['192.168.1.20', '10.0.0.1', '::ffff:192.168.1.20', 'fe80::1', '::', '0.0.0.0', undefined])(
        'refuses the non-loopback socket address %s',
        socketAddress => {
            const req = { ...request(), socketAddress };
            expect(service().localTrust.verify(req, SECRET)).toBe(false);
        },
    );

    it.each(['x-forwarded-for', 'x-forwarded-host', 'forwarded', 'x-real-ip', 'via'])(
        'refuses a request carrying the forwarded header %s',
        header => {
            const req = request({ headers: { [header]: '127.0.0.1' } });
            expect(service().localTrust.verify(req, SECRET)).toBe(false);
        },
    );

    it.each([
        ['evil.example.com', 'a remote name'],
        ['localhost.evil.example.com', 'a name that starts with localhost'],
        ['127.0.0.1.nip.io', 'a name that resolves to loopback'],
        ['::1', 'an unbracketed IPv6 address'],
        ['localhost:abc', 'a malformed port'],
        ['', 'an empty value'],
    ])('refuses a Host of "%s" (%s)', host => {
        expect(service().localTrust.verify(request({ headers: { host } }), SECRET)).toBe(false);
    });

    it('refuses a request with no Host header', () => {
        const req = { socketAddress: '127.0.0.1', headers: {} };
        expect(service().localTrust.verify(req, SECRET)).toBe(false);
    });

    // The CLI sends no Origin; a browser always does, even for a page on localhost.
    it.each(['http://localhost:3000', 'null', 'https://evil.example.com'])(
        'refuses a request with an Origin of %s',
        origin => {
            expect(service().localTrust.verify(request({ headers: { origin } }), SECRET)).toBe(false);
        },
    );
});

describe('LocalTrustService.recordFailedAttempt', () => {
    it('charges the shared authentication-failure bucket', async () => {
        const { localTrust, rateLimiter } = service();
        await localTrust.recordFailedAttempt('127.0.0.1');
        expect(rateLimiter.recordBearerAuthFailure).toHaveBeenCalledWith('127.0.0.1');
    });
});

describe('isLoopbackSocketAddress', () => {
    it.each(['127.0.0.1', '127.255.255.254', '::1', '::ffff:127.0.0.1', '::FFFF:127.1.2.3'])(
        'accepts %s',
        address => {
            expect(isLoopbackSocketAddress(address)).toBe(true);
        },
    );

    it.each([
        'localhost',
        '128.0.0.1',
        '::2',
        '::ffff:10.0.0.1',
        '::ffff:7f00:1',
        '',
        undefined,
        '127.0.0.1:80',
    ])('refuses %s', address => {
        expect(isLoopbackSocketAddress(address)).toBe(false);
    });
});

describe('hostnameOfHostHeader', () => {
    it.each([
        ['localhost', 'localhost'],
        ['localhost:3000', 'localhost'],
        ['[::1]', '[::1]'],
        ['[::1]:3000', '[::1]'],
        ['Example.COM:80', 'example.com'],
    ])('reads %s as %s', (host, hostname) => {
        expect(hostnameOfHostHeader(host)).toBe(hostname);
    });

    it.each(['[::1', 'localhost:', 'localhost:3000:1', '[::1]x', ':3000'])('refuses %s', host => {
        expect(hostnameOfHostHeader(host)).toBeUndefined();
    });
});

describe('getBearerToken', () => {
    it('reads the token of a bearer header, in any case', () => {
        expect(getBearerToken(`Bearer ${SECRET}`)).toBe(SECRET);
        expect(getBearerToken(`bearer   ${SECRET}  `)).toBe(SECRET);
    });

    it('reads everything after the scheme, as the MCP transport always has', () => {
        expect(getBearerToken('Bearer two words')).toBe('two words');
    });

    it('reads nothing from another scheme or a malformed header', () => {
        expect(getBearerToken(`Basic ${SECRET}`)).toBeUndefined();
        expect(getBearerToken(`Bearer${SECRET}`)).toBeUndefined();
        expect(getBearerToken('Bearer ')).toBeUndefined();
        expect(getBearerToken(undefined)).toBeUndefined();
    });
});

describe('LocalTrustService startup log', () => {
    // The Vendure CLI parses this exact line to fill in the endpoint, so the format is pinned here.
    it('logs the admin endpoint URL on the main server process, and never the secret', async () => {
        const info = vi.spyOn(Logger, 'info').mockImplementation(() => undefined);
        const warn = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
        try {
            await service().localTrust.onApplicationBootstrap();
            expect(info).toHaveBeenCalledWith(
                'Store MCP admin endpoint: http://localhost:3000/mcp/admin',
                'McpPlugin',
            );
            const logged = JSON.stringify([...info.mock.calls, ...warn.mock.calls]);
            expect(logged).not.toContain(SECRET);
        } finally {
            info.mockRestore();
            warn.mockRestore();
        }
    });

    it('uses the configured hostname, and logs nothing in a worker', async () => {
        const info = vi.spyOn(Logger, 'info').mockImplementation(() => undefined);
        try {
            await service({
                apiOptions: { hostname: '127.0.0.1', port: 4000 },
            }).localTrust.onApplicationBootstrap();
            expect(info).toHaveBeenCalledWith(
                'Store MCP admin endpoint: http://127.0.0.1:4000/mcp/admin',
                'McpPlugin',
            );
            info.mockClear();
            await service({ isServer: false }).localTrust.onApplicationBootstrap();
            expect(info).not.toHaveBeenCalled();
        } finally {
            info.mockRestore();
        }
    });
});

describe('LocalTrustService Admin API session', () => {
    it('swaps the secret for one session token, and reuses that session', async () => {
        const { localTrust, sessionService } = service();
        expect(await throughAdminApiMiddleware(localTrust, `Bearer ${SECRET}`)).toBe('Bearer session-1');
        expect(await throughAdminApiMiddleware(localTrust, `Bearer ${SECRET}`)).toBe('Bearer session-1');
        expect(sessionService.createNewAuthenticatedSession).toHaveBeenCalledOnce();
        expect(sessionService.createNewAuthenticatedSession.mock.calls[0]).toEqual([
            {},
            expect.objectContaining({ identifier: 'superadmin' }),
            'local-trust',
            undefined,
            'admin',
        ]);
    });

    // For example after a logout mutation, or after the session expired.
    it('creates a new session when the old one has gone', async () => {
        const { localTrust, liveSessions } = service();
        await throughAdminApiMiddleware(localTrust, `Bearer ${SECRET}`);
        liveSessions.clear();
        expect(await throughAdminApiMiddleware(localTrust, `Bearer ${SECRET}`)).toBe('Bearer session-2');
    });

    it('creates one session for concurrent first requests', async () => {
        const { localTrust, sessionService } = service();
        const tokens = await Promise.all(
            [1, 2, 3].map(() => throughAdminApiMiddleware(localTrust, `Bearer ${SECRET}`)),
        );
        expect(new Set(tokens)).toEqual(new Set(['Bearer session-1']));
        expect(sessionService.createNewAuthenticatedSession).toHaveBeenCalledOnce();
    });

    it('creates one replacement for concurrent requests after the session has gone', async () => {
        const { localTrust, sessionService, liveSessions } = service();
        await throughAdminApiMiddleware(localTrust, `Bearer ${SECRET}`);
        liveSessions.clear();
        const tokens = await Promise.all(
            [1, 2, 3].map(() => throughAdminApiMiddleware(localTrust, `Bearer ${SECRET}`)),
        );
        expect(new Set(tokens)).toEqual(new Set(['Bearer session-2']));
        expect(sessionService.createNewAuthenticatedSession).toHaveBeenCalledTimes(2);
    });

    it('deletes the session, and its cache entry, on shutdown', async () => {
        const { localTrust, deletedSessions, sessionCacheStrategy } = service();
        await throughAdminApiMiddleware(localTrust, `Bearer ${SECRET}`);
        await localTrust.onApplicationShutdown();
        expect(deletedSessions).toEqual(['session-1']);
        expect(sessionCacheStrategy.delete).toHaveBeenCalledWith('session-1');
    });

    it('deletes nothing on shutdown when no session was created', async () => {
        const { localTrust, deletedSessions } = service();
        await localTrust.onApplicationShutdown();
        expect(deletedSessions).toEqual([]);
    });

    it('leaves a wrong secret as it is, and charges it when it has the shape of a secret', async () => {
        const { localTrust, rateLimiter } = service();
        const wrong = 'x'.repeat(43);
        expect(await throughAdminApiMiddleware(localTrust, `Bearer ${wrong}`)).toBe(`Bearer ${wrong}`);
        expect(rateLimiter.recordBearerAuthFailure).toHaveBeenCalledOnce();
    });

    // The Dashboard sends its own session token as a bearer token from the same machine.
    it('leaves an ordinary session token alone, without charging it', async () => {
        const { localTrust, rateLimiter } = service();
        const sessionToken = 'a'.repeat(64);
        expect(await throughAdminApiMiddleware(localTrust, `Bearer ${sessionToken}`)).toBe(
            `Bearer ${sessionToken}`,
        );
        expect(rateLimiter.recordBearerAuthFailure).not.toHaveBeenCalled();
    });

    it('leaves the secret as it is on a request from a browser page', async () => {
        const { localTrust } = service();
        expect(
            await throughAdminApiMiddleware(localTrust, `Bearer ${SECRET}`, {
                origin: 'http://localhost:3000',
            }),
        ).toBe(`Bearer ${SECRET}`);
    });
});

describe('LocalTrustService.adminEndpointUrl', () => {
    it.each([
        ['', 'http://localhost:3000/mcp/admin'],
        ['0.0.0.0', 'http://localhost:3000/mcp/admin'],
        ['::', 'http://localhost:3000/mcp/admin'],
        ['shop.lan', 'http://localhost:3000/mcp/admin'],
        ['localhost', 'http://localhost:3000/mcp/admin'],
        ['127.0.0.1', 'http://127.0.0.1:3000/mcp/admin'],
        ['::1', 'http://[::1]:3000/mcp/admin'],
    ])('names a loopback host for hostname "%s"', (hostname, url) => {
        expect(service({ apiOptions: { hostname, port: 3000 } }).localTrust.adminEndpointUrl()).toBe(url);
    });
});

describe('LocalTrustService sessions of earlier runs', () => {
    it('deletes them at startup, with their cache entries', async () => {
        const { localTrust, deletedSessions, sessionCacheStrategy } = service({
            leftoverSessions: ['crashed-run-1', 'crashed-run-2'],
        });
        const warn = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
        const info = vi.spyOn(Logger, 'info').mockImplementation(() => undefined);
        try {
            await localTrust.onApplicationBootstrap();
        } finally {
            warn.mockRestore();
            info.mockRestore();
        }
        expect(deletedSessions).toEqual(['crashed-run-1', 'crashed-run-2']);
        expect(sessionCacheStrategy.delete).toHaveBeenCalledWith('crashed-run-2');
    });

    it('leaves them alone while local trust is off', async () => {
        const { localTrust, deletedSessions } = service({
            activation: LOCAL_TRUST_OFF,
            leftoverSessions: ['crashed-run-1'],
        });
        const info = vi.spyOn(Logger, 'info').mockImplementation(() => undefined);
        try {
            await localTrust.onApplicationBootstrap();
        } finally {
            info.mockRestore();
        }
        expect(deletedSessions).toEqual([]);
    });
});
