import { isErrorResult } from '@vendure/common/lib/command';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DevServerState, DevServerStateFile } from '../commands/dev/state-file.js';

import {
    localAdminApiErrors,
    localAdminGraphql,
    readGraphqlResponse,
    resolveLocalAdminTarget,
    sendLocalAdminRequest,
} from './local-admin-api.js';

const SECRET = 'a'.repeat(43);
// The runs in these tests started now, after this test process did, like a real run.
const NOW = new Date().toISOString();

const directories: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
    for (const dir of directories.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
    await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))));
});

function projectWithState(state: Partial<Omit<DevServerState, 'secret'>> | undefined): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'vendure-cli-local-admin-'));
    directories.push(dir);
    if (state) {
        new DevServerStateFile(dir, SECRET).write({
            status: 'ready',
            urls: { admin: 'http://localhost:3000/admin-api', mcp: 'http://localhost:3000/mcp/admin' },
            startedAt: NOW,
            restarts: 0,
            lastError: null,
            pid: process.pid,
            ...state,
        });
    }
    return dir;
}

describe('resolveLocalAdminTarget', () => {
    it('returns the Admin API URL and the secret of a ready run', () => {
        const target = resolveLocalAdminTarget(projectWithState({}), 'admin-api');

        expect(target).toMatchObject({ url: 'http://localhost:3000/admin-api', secret: SECRET });
    });

    it('returns the MCP admin URL for mcp-admin', () => {
        const target = resolveLocalAdminTarget(projectWithState({}), 'mcp-admin');

        expect(target).toMatchObject({ url: 'http://localhost:3000/mcp/admin' });
    });

    it('fails with not-running when there is no state file', () => {
        expect(resolveLocalAdminTarget(projectWithState(undefined), 'admin-api')).toEqual({
            vendureResult: 'error',
            code: localAdminApiErrors.notRunning.code,
            details: {},
        });
    });

    it('fails with not-running when the run that wrote the file is gone', () => {
        const target = resolveLocalAdminTarget(projectWithState({ pid: 2 ** 22 + 1 }), 'admin-api');

        expect(target).toMatchObject({ code: localAdminApiErrors.notRunning.code });
    });

    it('fails with not-ready, and a fix to wait, while the run restarts', () => {
        const target = resolveLocalAdminTarget(projectWithState({ status: 'restarting' }), 'admin-api');

        expect(target).toEqual({
            vendureResult: 'error',
            code: localAdminApiErrors.notReady.code,
            details: { status: 'restarting' },
        });
        expect(localAdminApiErrors.notReady.fix?.({ status: 'restarting' })).toEqual([
            { path: ['devserver', 'wait'], input: { until: 'ready' }, description: expect.any(String) },
        ]);
        expect(localAdminApiErrors.notReady.fix?.({ status: 'failed' })[0].path).toEqual([
            'devserver',
            'status',
        ]);
    });

    it('fails with endpoint-unknown when the run has not reported the URL', () => {
        const target = resolveLocalAdminTarget(
            projectWithState({ urls: { admin: 'http://localhost:3000/admin-api' } }),
            'mcp-admin',
        );

        expect(target).toMatchObject({
            code: localAdminApiErrors.endpointUnknown.code,
            details: { endpoint: 'mcp-admin' },
        });
    });

    it('refuses a URL that is not on a loopback address', () => {
        const target = resolveLocalAdminTarget(
            projectWithState({ urls: { admin: 'http://shop.example.com/admin-api' } }),
            'admin-api',
        );

        expect(target).toMatchObject({ code: localAdminApiErrors.endpointNotLocal.code });
    });

    it('accepts 127.0.0.1 and [::1]', () => {
        for (const admin of ['http://127.0.0.1:3000/admin-api', 'http://[::1]:3000/admin-api']) {
            expect(resolveLocalAdminTarget(projectWithState({ urls: { admin } }), 'admin-api')).toMatchObject(
                {
                    url: admin,
                },
            );
        }
    });
});

describe('sendLocalAdminRequest', () => {
    it('POSTs JSON with the secret as a Bearer token and returns the response', async () => {
        const fetch = vi.fn(() => Promise.resolve(new Response('{"data":{}}')));
        const response = await sendLocalAdminRequest(
            projectWithState({}),
            'admin-api',
            { query: '{ me { id } }' },
            { fetch, headers: { Authorization: 'Bearer other', 'vendure-token': 'channel' } },
        );

        expect(response).toBeInstanceOf(Response);
        const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe('http://localhost:3000/admin-api');
        expect(init.method).toBe('POST');
        expect(init.redirect).toBe('error');
        expect(init.body).toBe('{"query":"{ me { id } }"}');
        const headers = new Headers(init.headers);
        expect(headers.get('authorization')).toBe(`Bearer ${SECRET}`);
        expect(headers.get('content-type')).toBe('application/json');
        expect(headers.get('accept')).toBe('application/json');
        expect(headers.get('vendure-token')).toBe('channel');
    });

    it('accepts an event stream from the MCP endpoint', async () => {
        const fetch = vi.fn(() => Promise.resolve(new Response('{}')));
        await sendLocalAdminRequest(projectWithState({}), 'mcp-admin', { jsonrpc: '2.0' }, { fetch });

        const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe('http://localhost:3000/mcp/admin');
        expect(new Headers(init.headers).get('accept')).toBe('application/json, text/event-stream');
    });

    it('does not call fetch when no ready run serves the project', async () => {
        const fetch = vi.fn();
        const result = await sendLocalAdminRequest(projectWithState(undefined), 'admin-api', {}, { fetch });

        expect(isErrorResult(result)).toBe(true);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('fails with unreachable when the server refuses the connection, without the secret', async () => {
        const server = createServer();
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const port = (server.address() as AddressInfo).port;
        await new Promise(resolve => server.close(resolve));

        const result = await sendLocalAdminRequest(
            projectWithState({ urls: { admin: `http://127.0.0.1:${port}/admin-api` } }),
            'admin-api',
            {},
        );

        expect(result).toMatchObject({
            code: localAdminApiErrors.unreachable.code,
            details: { url: `http://127.0.0.1:${port}/admin-api`, message: 'ECONNREFUSED' },
        });
        expect(JSON.stringify(result)).not.toContain(SECRET);
    });
});

describe('localAdminGraphql', () => {
    it('sends the operation to a real local server and returns data and errors', async () => {
        let seenAuthorization: string | undefined;
        const server = createServer((req, res) => {
            seenAuthorization = req.headers.authorization;
            res.setHeader('content-type', 'application/json');
            res.end(
                JSON.stringify({
                    data: null,
                    errors: [{ message: 'Forbidden', extensions: { code: 'FORBIDDEN', requestId: 'r-1' } }],
                }),
            );
        });
        servers.push(server);
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const port = (server.address() as AddressInfo).port;

        const result = await localAdminGraphql(
            projectWithState({ urls: { admin: `http://127.0.0.1:${port}/admin-api` } }),
            { query: '{ me { id } }' },
        );

        expect(seenAuthorization).toBe(`Bearer ${SECRET}`);
        expect(result).toEqual({
            data: null,
            errors: [{ message: 'Forbidden', extensions: { code: 'FORBIDDEN', requestId: 'r-1' } }],
        });
    });
});

describe('readGraphqlResponse', () => {
    it('turns a body that is not a GraphQL result into one error with the status and request ID', async () => {
        const result = await readGraphqlResponse(
            new Response('<html>Bad gateway</html>', { status: 502, headers: { 'x-request-id': 'r-2' } }),
        );

        expect(result).toEqual({
            errors: [
                {
                    message: 'The server answered HTTP 502 without a GraphQL result.',
                    extensions: { httpStatus: 502, requestId: 'r-2' },
                },
            ],
        });
    });
});
