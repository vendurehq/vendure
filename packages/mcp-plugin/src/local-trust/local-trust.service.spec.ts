import { Logger } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { hashLocalTrustSecret, LOCAL_TRUST_OFF, LocalTrustActivation } from './local-trust-activation';
import {
    getBearerToken,
    hostnameOfHostHeader,
    LocalTrustRequest,
    LocalTrustService,
} from './local-trust.service';
import { isLoopbackSocketAddress } from './loopback-socket-address';

const SECRET = 'dGhpcy1pcy1hLXRlc3Qtc2VjcmV0LW9mLTMyLWJ5dGVz';

function service(
    options: {
        activation?: LocalTrustActivation;
        isServer?: boolean;
        apiOptions?: { hostname?: string; port: number };
    } = {},
) {
    const activation = options.activation ?? {
        enabled: true,
        secretHash: hashLocalTrustSecret(SECRET),
        stateFile: '/project/.vendure/devserver.json',
    };
    const rateLimiter = { recordBearerAuthFailure: vi.fn(() => Promise.resolve()) };
    const localTrust = new LocalTrustService(
        activation,
        { isServer: options.isServer ?? true } as any,
        { apiOptions: options.apiOptions ?? { hostname: '', port: 3000 } } as any,
        {} as any,
        {} as any,
        {} as any,
        rateLimiter as any,
    );
    return { localTrust, rateLimiter };
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

    it('reads nothing from another scheme or a malformed header', () => {
        expect(getBearerToken(`Basic ${SECRET}`)).toBeUndefined();
        expect(getBearerToken(`Bearer${SECRET}`)).toBeUndefined();
        expect(getBearerToken('Bearer ')).toBeUndefined();
        expect(getBearerToken(undefined)).toBeUndefined();
    });
});

describe('LocalTrustService startup log', () => {
    // The Vendure CLI parses this exact line to fill in the endpoint, so the format is pinned here.
    it('logs the admin endpoint URL on the main server process, and never the secret', () => {
        const info = vi.spyOn(Logger, 'info').mockImplementation(() => undefined);
        const warn = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
        try {
            service().localTrust.onApplicationBootstrap();
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

    it('uses the configured hostname, and logs nothing in a worker', () => {
        const info = vi.spyOn(Logger, 'info').mockImplementation(() => undefined);
        try {
            service({
                apiOptions: { hostname: '127.0.0.1', port: 4000 },
            }).localTrust.onApplicationBootstrap();
            expect(info).toHaveBeenCalledWith(
                'Store MCP admin endpoint: http://127.0.0.1:4000/mcp/admin',
                'McpPlugin',
            );
            info.mockClear();
            service({ isServer: false }).localTrust.onApplicationBootstrap();
            expect(info).not.toHaveBeenCalled();
        } finally {
            info.mockRestore();
        }
    });
});
