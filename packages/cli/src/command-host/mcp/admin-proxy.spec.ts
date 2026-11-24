import { fail } from '@vendure/common/lib/command';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { DevServerState, getDevServerStateFilePath } from '../../commands/dev/state-file.js';
import { localAdminApiErrors, LocalAdminTarget } from '../../shared/local-admin-api.js';

import {
    AdminProxy,
    behaviorOf,
    parseStoreBody,
    SendToStore,
    sendToStore,
    StoreResponse,
    withDeveloperMcpCall,
} from './admin-proxy.js';

const MCP_URL = 'http://localhost:3000/mcp/admin';

function state(overrides: Partial<DevServerState> = {}): DevServerState {
    return {
        status: 'ready',
        urls: { admin: 'http://localhost:3000/admin-api', mcp: MCP_URL },
        startedAt: '2026-11-24T08:00:00.000Z',
        restarts: 0,
        lastError: null,
        pid: 4242,
        secret: 'secret-1',
        ...overrides,
    };
}

const STORE_TOOLS = [
    {
        name: 'list_channels',
        description: 'List channels',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true, destructiveHint: false },
        _meta: { 'vendure.io/keywords': ['stores'] },
    },
    {
        name: 'create_zone',
        description: 'Create a zone',
        inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
        annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
        name: 'delete_zone',
        description: 'Delete a zone',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
        annotations: { readOnlyHint: false, destructiveHint: true },
    },
];

interface SentRequest {
    target: LocalAdminTarget;
    message: any;
    headers: Record<string, string>;
}

/** A Store MCP that answers tools/list with STORE_TOOLS and tools/call with `respond`. */
function fakeStore(respond: (message: any) => StoreResponse = () => rpcResult({ content: [] })) {
    const sent: SentRequest[] = [];
    const send: SendToStore = async (target, message, headers) => {
        sent.push({ target, message, headers });
        if ((message as any).method === 'tools/list') {
            return rpcResult({ tools: STORE_TOOLS });
        }
        return respond(message);
    };
    return { sent, send };
}

function rpcResult(result: unknown): StoreResponse {
    return { status: 200, body: { jsonrpc: '2.0', id: 1, result } };
}

const signal = () => new AbortController().signal;

function proxyWith(
    send: SendToStore,
    readState: () => DevServerState | undefined = () => state(),
    isAlive: (s: DevServerState) => boolean = () => true,
) {
    return new AdminProxy({ projectDir: '/project', send, readState, isAlive });
}

describe('AdminProxy', () => {
    it('lists the Store MCP tools as admin_* with their behavior and keywords', async () => {
        const store = fakeStore();
        const tools = await proxyWith(store.send).tools();
        expect(tools.map(t => [t.name, t.storeName, t.behavior])).toEqual([
            ['admin_list_channels', 'list_channels', 'readonly'],
            ['admin_create_zone', 'create_zone', 'mutating'],
            ['admin_delete_zone', 'delete_zone', 'destructive'],
        ]);
        expect(tools[0].keywords).toEqual(['stores']);
        expect(store.sent[0].message).toMatchObject({ method: 'tools/list' });
    });

    it('reads the tool list once while the dev server run stays the same', async () => {
        const store = fakeStore();
        const proxy = proxyWith(store.send);
        await proxy.tools();
        await proxy.tools();
        expect(store.sent.filter(r => r.message.method === 'tools/list')).toHaveLength(1);
    });

    it('follows the cursor of a paged tool list', async () => {
        const send: SendToStore = async (_s, message: any) =>
            message.params.cursor
                ? rpcResult({ tools: [STORE_TOOLS[1]] })
                : rpcResult({ tools: [STORE_TOOLS[0]], nextCursor: 'page-2' });
        const tools = await proxyWith(send).tools();
        expect(tools.map(t => t.name)).toEqual(['admin_list_channels', 'admin_create_zone']);
    });

    it('reads the tool list again after the dev server restarts', async () => {
        const store = fakeStore();
        let current = state();
        const proxy = proxyWith(store.send, () => current);
        await proxy.tools();
        current = state({ restarts: 1 });
        await proxy.tools();
        current = state({ secret: 'secret-2', startedAt: '2026-11-24T09:00:00.000Z' });
        await proxy.tools();
        expect(store.sent.filter(r => r.message.method === 'tools/list')).toHaveLength(3);
        expect(store.sent[0].target).toEqual({ url: MCP_URL, secret: 'secret-1' });
    });

    it('calls the Store MCP tool by its own name', async () => {
        const store = fakeStore();
        await proxyWith(store.send).call('admin_list_channels', { take: 5 }, signal());
        expect(store.sent[0].message).toMatchObject({
            method: 'tools/call',
            params: { name: 'list_channels', arguments: { take: 5 } },
        });
    });

    it('passes a result through unchanged, including an incomplete result', async () => {
        const incomplete = {
            content: [{ type: 'text', text: '{}' }],
            structuredContent: {
                status: 'incomplete',
                preview: 'Delete zone Europe (id 2).',
                needs: [{ kind: 'consent', consent: 'confirm', description: 'Delete', digest: 'abc' }],
            },
        };
        const store = fakeStore(() => rpcResult(incomplete));
        const result = await proxyWith(store.send).call('admin_delete_zone', { id: '2' }, signal());
        expect(result).toEqual(incomplete);
    });

    it('sends the channel that set_active_channel returned as the vendure-token header', async () => {
        const store = fakeStore(message =>
            message.params.name === 'set_active_channel'
                ? rpcResult({ structuredContent: { channel: { code: 'eu' }, channelToken: 'eu-token' } })
                : rpcResult({ content: [] }),
        );
        const proxy = proxyWith(store.send);
        await proxy.call('admin_list_channels', {}, signal());
        await proxy.call('admin_set_active_channel', { channelToken: 'eu-token', confirm: 'd' }, signal());
        await proxy.call('admin_list_channels', {}, signal());
        const calls = store.sent.filter(r => r.message.method === 'tools/call');
        expect(calls.map(r => r.headers['vendure-token'])).toEqual([undefined, undefined, 'eu-token']);
        expect(proxy.activeChannelToken).toBe('eu-token');
    });

    it('keeps the channel when set_active_channel only asks for consent', async () => {
        const store = fakeStore(() =>
            rpcResult({ structuredContent: { status: 'incomplete', needs: [{ kind: 'consent' }] } }),
        );
        const proxy = proxyWith(store.send);
        await proxy.call('admin_set_active_channel', { channelToken: 'eu-token' }, signal());
        expect(proxy.activeChannelToken).toBeUndefined();
    });

    it('clears a channel token the server refuses', async () => {
        let refuse = false;
        const store = fakeStore(message => {
            if (message.params.name === 'set_active_channel') {
                return rpcResult({ structuredContent: { channelToken: 'gone' } });
            }
            return refuse
                ? {
                      status: 400,
                      body: {
                          statusCode: 400,
                          message:
                              'The vendure-token query parameter or header does not name a sales channel of this server.',
                          error: 'Bad Request',
                      },
                  }
                : rpcResult({ content: [] });
        });
        const proxy = proxyWith(store.send);
        await proxy.call('admin_set_active_channel', { channelToken: 'gone' }, signal());
        refuse = true;
        const result: any = await proxy.call('admin_list_channels', {}, signal());
        expect(result.isError).toBe(true);
        expect(result.structuredContent.error.code).toBe('mcp.admin-tools.channel-refused');
        expect(proxy.activeChannelToken).toBeUndefined();
    });

    it('reports a stopped dev server with a fix that starts it', async () => {
        const store = fakeStore();
        const proxy = proxyWith(store.send, () => undefined);
        expect(await proxy.tools()).toEqual([]);
        const result: any = await proxy.call('admin_list_channels', {}, signal());
        expect(result.isError).toBe(true);
        expect(result.structuredContent.error.code).toBe('devserver.not-running');
        expect(result.structuredContent.error.fixes).toEqual([
            { path: ['devserver', 'start'], input: {}, description: expect.any(String) },
        ]);
        expect(store.sent).toEqual([]);
    });

    it('treats a state file whose run is gone as stopped', async () => {
        const proxy = proxyWith(
            fakeStore().send,
            () => state(),
            () => false,
        );
        expect(proxy.unavailable()?.error?.code).toBe('devserver.not-running');
    });

    it('reports a starting dev server with a fix that waits for it', () => {
        const proxy = proxyWith(fakeStore().send, () => state({ status: 'starting' }));
        const error = proxy.unavailable()?.error;
        expect(error?.code).toBe('devserver.not-ready');
        expect(error?.fixes?.[0].path).toEqual(['devserver', 'wait']);
    });

    it('reports a failed dev server with a fix that shows why it failed', () => {
        const proxy = proxyWith(fakeStore().send, () =>
            state({ status: 'failed', lastError: { process: 'server', message: 'Port 3000 is in use' } }),
        );
        const error = proxy.unavailable()?.error;
        expect(error?.code).toBe('devserver.not-ready');
        expect(error?.fixes?.[0].path).toEqual(['devserver', 'status']);
    });

    it('reports a dev server without the Store MCP as a missing plugin', async () => {
        const proxy = proxyWith(fakeStore().send, () =>
            state({ urls: { admin: 'http://localhost:3000/admin-api' } }),
        );
        expect(await proxy.tools()).toEqual([]);
        const error = proxy.unavailable()?.error;
        expect(error?.code).toBe('mcp.admin-tools.store-mcp-missing');
        expect(error?.message).toContain('McpPlugin.init()');
        expect(error?.message).not.toContain('oauth');
    });

    it('refuses a Store MCP endpoint that is not on a loopback address', async () => {
        const store = fakeStore();
        const proxy = proxyWith(store.send, () =>
            state({ urls: { mcp: 'http://shop.example.com:3000/mcp/admin' } }),
        );
        expect(await proxy.tools()).toEqual([]);
        expect(proxy.unavailable()?.error?.code).toBe('devserver.endpoint-not-local');
        expect(store.sent).toEqual([]);
    });

    it('sends a call to the target it resolved from the state', async () => {
        const store = fakeStore();
        const proxy = proxyWith(store.send);
        await proxy.call('admin_list_channels', {}, signal());
        expect(store.sent.map(r => r.target)).toEqual([{ url: MCP_URL, secret: 'secret-1' }]);
    });

    it('reports the tools as unavailable outside a project', () => {
        const proxy = new AdminProxy({ projectDir: undefined, send: fakeStore().send });
        expect(proxy.unavailable()?.error?.code).toBe('mcp.admin-tools.no-project');
    });

    it('reports a dev server it cannot reach with a fix, and the list as unavailable', async () => {
        const send: SendToStore = async () =>
            fail(localAdminApiErrors.unreachable, {
                url: 'http://localhost:3000/mcp/admin',
                message: 'ECONNREFUSED',
            });
        const proxy = proxyWith(send);
        expect(await proxy.tools()).toEqual([]);
        const error = proxy.unavailable()?.error;
        expect(error?.code).toBe('devserver.unreachable');
        expect(error?.message).toContain('ECONNREFUSED');
        expect(error?.fixes?.[0].path).toEqual(['devserver', 'status']);
    });

    it('reports a refused secret', async () => {
        const proxy = proxyWith(async () => ({ status: 401, body: { message: 'Unauthorized' } }));
        const result: any = await proxy.call('admin_list_channels', {}, signal());
        expect(result.structuredContent.error.message).toContain('refused the local-trust secret');
    });

    it('tells listeners when a failed call shows that the dev server is gone', async () => {
        let alive = true;
        const send: SendToStore = async (_dir, message) => {
            if ((message as any).method === 'tools/list') {
                return rpcResult({ tools: STORE_TOOLS });
            }
            alive = false;
            return fail(localAdminApiErrors.notRunning, {});
        };
        const proxy = proxyWith(
            send,
            () => state(),
            () => alive,
        );
        let changes = 0;
        proxy.onListChanged(() => changes++);
        await proxy.tools();
        await proxy.call('admin_list_channels', {}, signal());
        expect(changes).toBe(1);
        expect(proxy.unavailable()?.error?.code).toBe('devserver.not-running');
    });

    it('does not report a change for a failed call while the run is unchanged', async () => {
        const proxy = proxyWith(async () => {
            throw new Error('socket hang up');
        });
        let changes = 0;
        proxy.onListChanged(() => changes++);
        proxy.checkForChange();
        changes = 0;
        const result: any = await proxy.call('admin_list_channels', {}, signal());
        expect(changes).toBe(0);
        expect(result.structuredContent.error.code).toBe('mcp.admin-tools.store-unreachable');
    });

    it('says that a call that timed out may still have run', async () => {
        const proxy = proxyWith(async () => {
            const error = new Error('The operation was aborted due to timeout');
            error.name = 'TimeoutError';
            throw error;
        });
        const result: any = await proxy.call('admin_create_zone', {}, signal());
        expect(result.structuredContent.error.code).toBe('mcp.admin-tools.store-timed-out');
        expect(result.structuredContent.error.message).toContain('may still have run');
    });

    it('warns that a write may have run when the connection dropped', async () => {
        const proxy = proxyWith(async () =>
            fail(localAdminApiErrors.unreachable, {
                url: 'http://localhost:3000/mcp/admin',
                message: 'ECONNRESET',
            }),
        );
        const write: any = await proxy.call('admin_create_zone', {}, signal());
        expect(write.structuredContent.notices[0].message).toContain('may still have run');
        const read: any = await proxy.call('admin_list_channels', {}, signal(), { readonly: true });
        expect(read.structuredContent.notices).toEqual([]);
    });

    it('does not warn when the dev server refused the connection', async () => {
        const proxy = proxyWith(async () =>
            fail(localAdminApiErrors.unreachable, {
                url: 'http://localhost:3000/mcp/admin',
                message: 'ECONNREFUSED',
            }),
        );
        const write: any = await proxy.call('admin_create_zone', {}, signal());
        expect(write.structuredContent.notices).toEqual([]);
    });

    it('reads the tool list with a short timeout, and calls tools with a long one', async () => {
        const timeouts: Array<[string, number | undefined]> = [];
        const store = fakeStore();
        const proxy = proxyWith(async (dir, message: any, headers, sig, timeoutMs) => {
            timeouts.push([message.method, timeoutMs]);
            return store.send(dir, message, headers, sig);
        });
        await proxy.tools();
        await proxy.call('admin_list_channels', {}, signal());
        expect(timeouts).toEqual([
            ['tools/list', 5000],
            ['tools/call', 60000],
        ]);
    });

    it('tells listeners when the tool list can be read after it failed', async () => {
        let failing = true;
        const send: SendToStore = async (dir, message) =>
            failing
                ? fail(localAdminApiErrors.unreachable, {
                      url: 'http://localhost:3000/mcp/admin',
                      message: 'x',
                  })
                : fakeStore().send(dir, message, {}, signal());
        const proxy = proxyWith(send);
        let changes = 0;
        proxy.onListChanged(() => changes++);
        proxy.checkForChange();
        changes = 0;
        expect(await proxy.tools()).toEqual([]);
        expect(changes).toBe(0);
        failing = false;
        expect(await proxy.tools()).toHaveLength(3);
        expect(changes).toBe(1);
        expect(proxy.unavailable()).toBeUndefined();
    });

    it('sends the channel in the header the server names', async () => {
        const store = fakeStore(message =>
            message.params.name === 'set_active_channel'
                ? rpcResult({
                      structuredContent: { channelToken: 'eu', channelTokenHeader: 'x-shop-channel' },
                  })
                : rpcResult({ content: [] }),
        );
        const proxy = proxyWith(store.send);
        await proxy.call('admin_set_active_channel', { channelToken: 'eu' }, signal());
        await proxy.call('admin_list_channels', {}, signal());
        expect(store.sent.at(-1)?.headers).toEqual({ 'x-shop-channel': 'eu' });
    });

    it('keeps the channel when a 400 is not about the channel token', async () => {
        let bad = false;
        const store = fakeStore(message => {
            if (message.params.name === 'set_active_channel') {
                return rpcResult({ structuredContent: { channelToken: 'eu' } });
            }
            return bad
                ? { status: 400, body: { statusCode: 400, message: 'Unexpected token in JSON' } }
                : rpcResult({ content: [] });
        });
        const proxy = proxyWith(store.send);
        await proxy.call('admin_set_active_channel', { channelToken: 'eu' }, signal());
        bad = true;
        const result: any = await proxy.call('admin_list_channels', {}, signal());
        expect(result.structuredContent.error.code).toBe('mcp.admin-tools.store-refused');
        expect(proxy.activeChannelToken).toBe('eu');
    });

    describe('watching the state file', () => {
        let projectDir: string | undefined;

        afterEach(() => {
            if (projectDir) {
                fs.rmSync(projectDir, { recursive: true, force: true });
            }
        });

        it('tells listeners when the state file appears and disappears', async () => {
            projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-admin-proxy-'));
            const proxy = new AdminProxy({
                projectDir,
                send: fakeStore().send,
                isAlive: () => true,
                watchIntervalMs: 10,
            });
            let changes = 0;
            proxy.onListChanged(() => changes++);
            proxy.watch();
            try {
                const stateFile = getDevServerStateFilePath(projectDir);
                fs.mkdirSync(path.dirname(stateFile), { recursive: true });
                fs.writeFileSync(stateFile, JSON.stringify(state()), { mode: 0o600 });
                await waitFor(() => changes === 1);
                expect(proxy.unavailable()).toBeUndefined();

                fs.rmSync(stateFile);
                await waitFor(() => changes === 2);
                expect(proxy.unavailable()?.error?.code).toBe('devserver.not-running');
            } finally {
                proxy.close();
            }
        });
    });
});

describe('behaviorOf', () => {
    it('reads the behavior from the annotations', () => {
        expect(behaviorOf({ readOnlyHint: true })).toBe('readonly');
        expect(behaviorOf({ readOnlyHint: false, destructiveHint: false })).toBe('mutating');
        expect(behaviorOf({ destructiveHint: true })).toBe('destructive');
        // MCP treats a tool without destructiveHint as destructive.
        expect(behaviorOf({})).toBe('destructive');
    });
});

describe('parseStoreBody', () => {
    it('reads a JSON body', () => {
        expect(parseStoreBody('{"jsonrpc":"2.0","id":1,"result":{}}', 'application/json')).toEqual({
            jsonrpc: '2.0',
            id: 1,
            result: {},
        });
    });

    it('reads the response frame of an event stream that also holds notifications', () => {
        const body =
            'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/message","params":{}}\n\n' +
            'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n\n';
        expect(parseStoreBody(body, 'text/event-stream')).toEqual({
            jsonrpc: '2.0',
            id: 1,
            result: { ok: true },
        });
    });

    it('returns undefined for an empty or broken body', () => {
        expect(parseStoreBody('', 'application/json')).toBeUndefined();
        expect(parseStoreBody('<html>', 'text/html')).toBeUndefined();
    });
});

async function waitFor(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
    const until = Date.now() + timeoutMs;
    while (!condition()) {
        if (Date.now() > until) {
            throw new Error('Timed out waiting for the condition');
        }
        await new Promise(resolve => setTimeout(resolve, 10));
    }
}

describe('withDeveloperMcpCall', () => {
    const incomplete = {
        content: [{ type: 'text', text: 'Call "delete_zone" again with "confirm".' }],
        structuredContent: {
            status: 'incomplete',
            needs: [{ kind: 'consent', consent: 'confirm', description: 'Delete', digest: 'abc' }],
        },
    };

    it('names the direct call of the admin tool, and keeps the result', () => {
        const result: any = withDeveloperMcpCall(incomplete, 'admin_delete_zone', undefined);
        expect(result.structuredContent).toBe(incomplete.structuredContent);
        expect(result.content[0]).toEqual(incomplete.content[0]);
        expect(result.content[1].text).toContain(
            'call admin_delete_zone again with the same arguments plus "confirm"',
        );
    });

    it('names the executor in discovery mode', () => {
        const result: any = withDeveloperMcpCall(incomplete, 'admin_delete_zone', 'execute_destructive');
        expect(result.content[1].text).toContain(
            'call execute_destructive with "tool": "admin_delete_zone" and "input": the same input plus "confirm"',
        );
    });

    it('leaves other results alone', () => {
        const ok = { content: [], structuredContent: { result: 'DELETED' } };
        expect(withDeveloperMcpCall(ok, 'admin_delete_zone', undefined)).toBe(ok);
    });
});

describe('sendToStore', () => {
    it('posts to the target with its secret, the channel header and the protocol version', async () => {
        const received: Array<{ url?: string; headers: http.IncomingHttpHeaders; body: string }> = [];
        const server = http.createServer((req, res) => {
            let body = '';
            req.on('data', chunk => (body += String(chunk)));
            req.on('end', () => {
                received.push({ url: req.url, headers: req.headers, body });
                res.setHeader('content-type', 'application/json');
                res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [] } }));
            });
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const { port } = server.address() as AddressInfo;
        try {
            const message = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
            const response = await sendToStore(
                { url: `http://127.0.0.1:${port}/mcp/admin`, secret: 'run-secret' },
                message,
                { 'vendure-token': 'eu' },
                signal(),
            );
            expect(response).toEqual({ status: 200, body: { jsonrpc: '2.0', id: 1, result: { tools: [] } } });
            expect(received).toHaveLength(1);
            expect(received[0].url).toBe('/mcp/admin');
            expect(received[0].headers.authorization).toBe('Bearer run-secret');
            expect(received[0].headers['vendure-token']).toBe('eu');
            expect(received[0].headers['mcp-protocol-version']).toBeDefined();
            expect(JSON.parse(received[0].body)).toEqual(message);
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
    });
});
