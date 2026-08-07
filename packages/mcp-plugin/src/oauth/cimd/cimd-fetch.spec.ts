import { BadRequestException } from '@nestjs/common';
import * as http from 'http';
import { AddressInfo } from 'net';
import { afterEach, describe, expect, it } from 'vitest';

import { MAX_CONCURRENT_CIMD_FETCHES } from '../../constants';

import { fetchCimdDocument, isAllowedCimdAddress } from './cimd-fetch';

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
    it('returns the body of a 200 JSON response', async () => {
        const url = await startServer((req, res) => {
            res.setHeader('content-type', 'application/json');
            res.end('{"ok":true}');
        });
        const result = await fetchCimdDocument(url, baseOptions);
        expect(result.body).toBe('{"ok":true}');
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

describe('fetchCimdDocument concurrency cap', () => {
    /** Starts a server that holds the connection open until its returned resolver is called. */
    async function startHangingServer(): Promise<{ url: URL; ready: Promise<http.ServerResponse> }> {
        let resolveReady!: (res: http.ServerResponse) => void;
        const ready = new Promise<http.ServerResponse>(resolve => {
            resolveReady = resolve;
        });
        const url = await startServer((req, res) => {
            res.setHeader('content-type', 'application/json');
            resolveReady(res);
        });
        return { url, ready };
    }

    it('rejects immediately at the cap while distinct fetches are pending, then admits a new one once a slot frees', async () => {
        const hanging = await Promise.all(
            Array.from({ length: MAX_CONCURRENT_CIMD_FETCHES }, () => startHangingServer()),
        );
        // Fires MAX_CONCURRENT_CIMD_FETCHES distinct-URL fetches. The slot counter is incremented
        // synchronously inside fetchCimdDocument, so calling it this many times already fills the cap
        // — none of these need to reach their server first.
        const pending = hanging.map(h => fetchCimdDocument(h.url, baseOptions));

        const extraUrl = await startServer((req, res) => res.end('{}'));
        await expect(fetchCimdDocument(extraUrl, baseOptions)).rejects.toThrow(
            'client_id metadata document could not be fetched',
        );

        // Release the first batch and confirm they still complete normally — a thrown/rejected
        // fetch beyond the cap must not have consumed one of their slots.
        const responses = await Promise.all(hanging.map(h => h.ready));
        responses.forEach(res => res.end('{"ok":true}'));
        const results = await Promise.all(pending);
        expect(results).toHaveLength(MAX_CONCURRENT_CIMD_FETCHES);
        results.forEach(result => expect(result.body).toBe('{"ok":true}'));

        // A slot freed up when the batch above settled, so a brand-new fetch is admitted.
        const freedUrl = await startServer((req, res) => {
            res.setHeader('content-type', 'application/json');
            res.end('{"via":"freed-slot"}');
        });
        await expect(fetchCimdDocument(freedUrl, baseOptions)).resolves.toMatchObject({
            body: '{"via":"freed-slot"}',
        });
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
