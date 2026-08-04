import { BadRequestException } from '@nestjs/common';
import * as http from 'http';
import { AddressInfo } from 'net';
import { afterEach, describe, expect, it } from 'vitest';

import { fetchCimdDocument, isAllowedCimdAddress, parseCacheMaxAge } from './cimd-fetch';

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

let servers: http.Server[] = [];

async function startServer(handler: Handler): Promise<URL> {
    const server = http.createServer(handler);
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    return new URL(`http://127.0.0.1:${port}/metadata.json`);
}

afterEach(async () => {
    await Promise.all(servers.map(server => new Promise<void>(resolve => server.close(() => resolve()))));
    servers = [];
});

const baseOptions = { timeoutMs: 2000, maxBytes: 5 * 1024, allowLoopback: true };

describe('fetchCimdDocument', () => {
    it('returns the body and the Cache-Control max-age of a 200 JSON response', async () => {
        const url = await startServer((req, res) => {
            res.setHeader('content-type', 'application/json');
            res.setHeader('cache-control', 'public, max-age=120');
            res.end('{"ok":true}');
        });
        const result = await fetchCimdDocument(url, baseOptions);
        expect(result.body).toBe('{"ok":true}');
        expect(result.cacheMaxAgeSeconds).toBe(120);
    });

    it('accepts application/*+json content types', async () => {
        const url = await startServer((req, res) => {
            res.setHeader('content-type', 'application/oauth-client-metadata+json; charset=utf-8');
            res.end('{}');
        });
        await expect(fetchCimdDocument(url, baseOptions)).resolves.toMatchObject({ body: '{}' });
    });

    it('rejects any non-200 status', async () => {
        const url = await startServer((req, res) => {
            res.statusCode = 404;
            res.end('nope');
        });
        await expect(fetchCimdDocument(url, baseOptions)).rejects.toThrow('HTTP 404');
    });

    it('rejects a redirect instead of following it', async () => {
        const url = await startServer((req, res) => {
            res.statusCode = 302;
            res.setHeader('location', 'http://127.0.0.1:1/other.json');
            res.end();
        });
        await expect(fetchCimdDocument(url, baseOptions)).rejects.toThrow('HTTP 302');
    });

    it('rejects non-JSON content types', async () => {
        const url = await startServer((req, res) => {
            res.setHeader('content-type', 'text/html');
            res.end('<html></html>');
        });
        await expect(fetchCimdDocument(url, baseOptions)).rejects.toThrow('must be JSON');
    });

    it('rejects a body larger than maxBytes', async () => {
        const url = await startServer((req, res) => {
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ pad: 'x'.repeat(10_000) }));
        });
        await expect(fetchCimdDocument(url, baseOptions)).rejects.toThrow('too large');
    });

    it('rejects when the response stalls past the deadline', async () => {
        const url = await startServer((req, res) => {
            res.setHeader('content-type', 'application/json');
            res.write('{"ok":'); // never finishes
        });
        await expect(fetchCimdDocument(url, { ...baseOptions, timeoutMs: 200 })).rejects.toThrow('timed out');
    });

    it('refuses to connect when DNS resolves to a blocked address', async () => {
        const url = await startServer((req, res) => res.end('{}'));
        // Pretend "blocked.example" resolves to a private address. The guard must stop the
        // request before any connection is made.
        const lookup = ((hostname: string, opts: any, cb: any) => {
            cb(null, [{ address: '10.0.0.1', family: 4 }]);
        }) as any;
        const target = new URL(`http://blocked.example:${url.port}/metadata.json`);
        await expect(
            fetchCimdDocument(target, { ...baseOptions, allowLoopback: false, lookup }),
        ).rejects.toThrow(BadRequestException);
    });

    // Every other case here injects a lookup. This one goes through node's real resolver, so the
    // guarded-lookup wiring itself is covered: `localhost` resolves locally, without network
    // access, and must be refused when the loopback exception is off.
    it('refuses a hostname the real resolver maps to a blocked address', async () => {
        const url = await startServer((req, res) => res.end('{}'));
        const target = new URL(`http://localhost:${url.port}/metadata.json`);
        await expect(fetchCimdDocument(target, { ...baseOptions, allowLoopback: false })).rejects.toThrow(
            BadRequestException,
        );
    });

    it('connects via the injected lookup when every resolved address is allowed', async () => {
        const url = await startServer((req, res) => {
            res.setHeader('content-type', 'application/json');
            res.end('{"via":"lookup"}');
        });
        const lookup = ((hostname: string, opts: any, cb: any) => {
            cb(null, [{ address: '127.0.0.1', family: 4 }]);
        }) as any;
        const target = new URL(`http://cimd-host.example:${url.port}/metadata.json`);
        const result = await fetchCimdDocument(target, { ...baseOptions, lookup });
        expect(result.body).toBe('{"via":"lookup"}');
    });
});

describe('isAllowedCimdAddress', () => {
    it('blocks loopback unless allowLoopback is set', () => {
        expect(isAllowedCimdAddress('127.0.0.1', 4, false)).toBe(false);
        expect(isAllowedCimdAddress('127.0.0.1', 4, true)).toBe(true);
        expect(isAllowedCimdAddress('::1', 6, false)).toBe(false);
        expect(isAllowedCimdAddress('::1', 6, true)).toBe(true);
    });

    it('blocks private, link-local, CGNAT and multicast ranges even with allowLoopback', () => {
        const blocked = [
            '10.1.2.3',
            '172.16.5.5',
            '192.168.1.1',
            '169.254.169.254',
            '100.64.0.9',
            '224.0.0.1',
        ];
        for (const address of blocked) {
            expect(isAllowedCimdAddress(address, 4, true)).toBe(false);
        }
    });

    it('blocks special-use IPv6 ranges including IPv4-mapped addresses', () => {
        const blocked = ['fe80::1', 'fc00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '2001:db8::1'];
        for (const address of blocked) {
            expect(isAllowedCimdAddress(address, 6, false)).toBe(false);
        }
    });

    it('allows ordinary public addresses', () => {
        expect(isAllowedCimdAddress('93.184.216.34', 4, false)).toBe(true);
        expect(isAllowedCimdAddress('2606:2800:220:1:248:1893:25c8:1946', 6, false)).toBe(true);
    });
});

describe('parseCacheMaxAge', () => {
    it('reads max-age from a Cache-Control header', () => {
        expect(parseCacheMaxAge('public, max-age=300')).toBe(300);
        expect(parseCacheMaxAge('max-age="600"')).toBe(600);
    });

    it('returns 0 for no-store / no-cache responses', () => {
        expect(parseCacheMaxAge('no-store')).toBe(0);
        expect(parseCacheMaxAge('no-cache, max-age=500')).toBe(0);
    });

    it('returns undefined when absent or unparseable', () => {
        expect(parseCacheMaxAge(undefined)).toBeUndefined();
        expect(parseCacheMaxAge('private')).toBeUndefined();
    });
});
