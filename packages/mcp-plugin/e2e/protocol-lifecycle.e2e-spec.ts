import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { SERVER_INFO_META_KEY, SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/server';
import { mergeConfig } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { McpPlugin } from '../src/plugin';
import { McpPluginOptions } from '../src/types';

import { McpTestToolsPlugin } from './fixtures/mcp-test-tools';
import {
    expectRateLimitRefusal,
    initializeParams,
    MCP_ACCEPT,
    MODERN_PROTOCOL_VERSION,
    postMcp,
    postModernMcp,
    rpc,
} from './utils/mcp-http-client';
import { runAuthorizationCodeFlow } from './utils/oauth-test-client';
import { testServerInit } from './utils/test-server';

const TOKEN_SECRET = 'protocol-lifecycle-secret-000000000000000000';
const ISSUER = `http://localhost:${testConfig().apiOptions.port}`;
const AUTH_TOKEN_HEADER = 'vendure-auth-token';

describe('MCP protocol conformance (direct mode)', () => {
    // Test isolation, not a behavior change: with default rate limits, this describe's anonymous
    // shop calls would share the IP-keyed per-session bucket with later describes in this file
    // (they all call from the same test-host IP).
    const options: McpPluginOptions = {
        oauth: { tokenSecret: TOKEN_SECRET },
        rateLimits: { perSession: { rpm: 0 }, perClient: { rpm: 0 }, anonymousIp: false },
    };
    const config = mergeConfig(testConfig(), { plugins: [McpTestToolsPlugin, McpPlugin.init(options)] });
    const { server, adminClient } = createTestEnvironment(config);
    const baseUrl = () => `http://localhost:${config.apiOptions.port}`;
    let adminToken: string;

    beforeAll(async () => {
        McpPlugin.init(options);
        await server.init(testServerInit);
        await adminClient.asSuperAdmin();
        const flow = await runAuthorizationCodeFlow({
            baseUrl: baseUrl(),
            issuer: ISSUER,
            superAdminToken: adminClient.getAuthToken(),
        });
        adminToken = flow.access_token;
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('initialize negotiates a supported protocol version and does not advertise listChanged', async () => {
        const res = await postMcp(baseUrl(), 'shop', rpc('initialize', initializeParams()));
        expect(res.status).toBe(200);
        expect(SUPPORTED_PROTOCOL_VERSIONS).toContain(res.body.result.protocolVersion);
        // The transport is stateless and has no GET stream, so tools/list_changed can never fire.
        expect(res.body.result.capabilities.tools.listChanged).toBe(false);
        expect(res.body.result.serverInfo.name).toBe('vendure-mcp-shop');
    });

    it('initialize with an unsupported version falls back to a supported one (no error)', async () => {
        const res = await postMcp(baseUrl(), 'shop', rpc('initialize', initializeParams('1999-01-01')));
        expect(res.status).toBe(200);
        expect(res.body.error).toBeUndefined();
        expect(SUPPORTED_PROTOCOL_VERSIONS).toContain(res.body.result.protocolVersion);
    });

    it('initialized notification returns 202 with an empty body', async () => {
        const res = await postMcp(baseUrl(), 'shop', { jsonrpc: '2.0', method: 'notifications/initialized' });
        expect(res.status).toBe(202);
        expect(res.text).toBe('');
    });

    it('ping returns a 200 empty result', async () => {
        const res = await postMcp(baseUrl(), 'shop', rpc('ping', {}, 2));
        expect(res.status).toBe(200);
        expect(res.body.result).toEqual({});
    });

    it('tools/list returns the shop tools', async () => {
        const res = await postMcp(baseUrl(), 'shop', rpc('tools/list', {}, 3));
        expect(res.status).toBe(200);
        const names = res.body.result.tools.map((t: any) => t.name);
        expect(names).toContain('shop_echo');
        expect(names).toContain('shop_ping');
        expect(names).not.toContain('admin_list');
    });

    it('tools/call runs a real tool end-to-end', async () => {
        const res = await postMcp(
            baseUrl(),
            'shop',
            rpc('tools/call', { name: 'shop_echo', arguments: { text: 'hi' } }, 4),
        );
        expect(res.status).toBe(200);
        expect(res.body.result.isError).toBeUndefined();
        expect(res.body.result.structuredContent).toEqual({ echoed: 'hi' });
    });

    it('rejects a bad MCP-Protocol-Version header on a post-init call → 400', async () => {
        const res = await postMcp(baseUrl(), 'shop', rpc('tools/list', {}, 5), {
            protocolVersion: 'not-a-real-version',
        });
        expect(res.status).toBe(400);
    });

    it('missing/unacceptable Accept → 406', async () => {
        const res = await postMcp(baseUrl(), 'shop', rpc('ping', {}, 6), { accept: 'application/xml' });
        expect(res.status).toBe(406);
    });

    it('a JSON-RPC batch of two pings returns a 200 array', async () => {
        const res = await postMcp(baseUrl(), 'shop', [rpc('ping', {}, 1), rpc('ping', {}, 2)]);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body).toHaveLength(2);
    });

    // Each case asserts the exact validation message: an isError-only check would pass on a
    // refusal for any unrelated reason and could not tell the three cases apart.
    it.each([
        {
            label: 'a property of the wrong type',
            args: { text: 123 },
            id: 15,
            detail: 'data/text must be string',
        },
        {
            label: 'an unknown extra property',
            args: { text: 'hi', bogus: 1 },
            id: 16,
            detail: 'data must NOT have additional properties',
        },
        {
            label: 'a missing required property',
            args: {},
            id: 17,
            detail: "data must have required property 'text'",
        },
    ])('the SDK rejects $label before the handler runs', async ({ args, id, detail }) => {
        const res = await postMcp(
            baseUrl(),
            'shop',
            rpc('tools/call', { name: 'shop_echo', arguments: args }, id),
        );

        expect(res.body.result.isError).toBe(true);
        expect(res.body.result.content[0].text).toBe(
            `Input validation error: Invalid arguments for tool shop_echo: ${detail}`,
        );
    });

    it('an in-tool error flattens to isError', async () => {
        const res = await postMcp(
            baseUrl(),
            'shop',
            rpc('tools/call', { name: 'shop_boom', arguments: {} }, 7),
        );
        expect(res.status).toBe(200);
        expect(res.body.result.isError).toBe(true);
        // shop_boom throws a plain Error("boom"). Unexpected errors count as internal, so the
        // caller gets a generic message, never the real one.
        expect(res.body.result.content[0].text).not.toContain('boom');
        expect(res.body.result.content[0].text).toContain('failed unexpectedly');
    });

    it('a caller-safe error (UserInputError) passes its message through unchanged', async () => {
        const res = await postMcp(
            baseUrl(),
            'shop',
            rpc('tools/call', { name: 'shop_bad_input', arguments: {} }, 18),
        );
        expect(res.status).toBe(200);
        expect(res.body.result.isError).toBe(true);
        expect(res.body.result.content[0].text).toContain('bad-input-from-caller');
    });

    it('an unknown tool is a JSON-RPC dispatch error (-32602), not isError', async () => {
        const res = await postMcp(
            baseUrl(),
            'shop',
            rpc('tools/call', { name: 'does_not_exist', arguments: {} }, 8),
        );
        expect(res.body.error?.code).toBe(-32602);
    });

    it('GET /mcp/shop and /mcp/admin → 405 with Allow: POST', async () => {
        for (const toolset of ['shop', 'admin']) {
            const res = await fetch(`${baseUrl()}/mcp/${toolset}`, { method: 'GET' });
            expect(res.status).toBe(405);
            expect(res.headers.get('allow')).toBe('POST');
        }
    });

    it('a non-JSON Content-Type → 415', async () => {
        const res = await postMcp(baseUrl(), 'shop', rpc('ping', {}, 9), { contentType: 'text/plain' });
        expect(res.status).toBe(415);
    });

    it('admin endpoint unauthenticated → 401 with a WWW-Authenticate challenge', async () => {
        const res = await postMcp(baseUrl(), 'admin', rpc('initialize', initializeParams(), 10));
        expect(res.status).toBe(401);
        expect(res.headers.get('www-authenticate')).toMatch(/^Bearer/);
        // No credentials were sent, so per RFC 6750 §3.1 the challenge must stay bare (no error code).
        expect(res.headers.get('www-authenticate')).not.toMatch(/error=/);
    });

    it('admin endpoint with an invalid bearer → 401 with a WWW-Authenticate challenge', async () => {
        const res = await postMcp(baseUrl(), 'admin', rpc('initialize', initializeParams(), 11), {
            token: 'not-a-real-token',
        });
        expect(res.status).toBe(401);
        // The challenge points the client at the auth server; it must survive on the invalid-token
        // path too, not only the unauthenticated one. Per RFC 6750 §3.1, a rejected token must also
        // carry error="invalid_token".
        expect(res.headers.get('www-authenticate')).toMatch(/^Bearer/);
        expect(res.headers.get('www-authenticate')).toMatch(/error="invalid_token"/);
    });

    it('admin endpoint with a valid bearer completes initialize + tools/list + tools/call', async () => {
        const init = await postMcp(baseUrl(), 'admin', rpc('initialize', initializeParams(), 12), {
            token: adminToken,
        });
        expect(init.status).toBe(200);

        const list = await postMcp(baseUrl(), 'admin', rpc('tools/list', {}, 13), { token: adminToken });
        expect(list.body.result.tools.map((t: any) => t.name)).toContain('admin_list');

        const call = await postMcp(
            baseUrl(),
            'admin',
            rpc('tools/call', { name: 'admin_list', arguments: {} }, 14),
            { token: adminToken },
        );
        expect(call.body.result.structuredContent).toEqual({ items: [] });
    });

    it('tools/call runs a real tool under the modern 2026-07-28 envelope', async () => {
        const res = await postModernMcp(
            baseUrl(),
            'shop',
            'tools/call',
            { name: 'shop_echo', arguments: { text: 'modern' } },
            20,
        );
        expect(res.status).toBe(200);
        expect(res.body.error).toBeUndefined();
        expect(res.body.result.isError).toBeUndefined();
        expect(res.body.result.structuredContent).toEqual({ echoed: 'modern' });
        // `resultType` exists only in the 2026 era, so it also proves this was not served as legacy.
        expect(res.body.result.resultType).toBe('complete');
    });

    it('tools/list is served under the modern 2026-07-28 envelope', async () => {
        const res = await postModernMcp(baseUrl(), 'shop', 'tools/list', {}, 24);
        expect(res.status).toBe(200);
        expect(res.body.error).toBeUndefined();
        expect(res.body.result.tools.map((t: any) => t.name)).toContain('shop_echo');
        // `resultType` exists only in the 2026 era, so it also proves this was not served as legacy.
        expect(res.body.result.resultType).toBe('complete');
    });

    it('an admin bearer token works under the modern 2026-07-28 envelope', async () => {
        const res = await postModernMcp(
            baseUrl(),
            'admin',
            'tools/call',
            { name: 'admin_list', arguments: {} },
            25,
            { token: adminToken },
        );
        expect(res.status).toBe(200);
        expect(res.body.error).toBeUndefined();
        expect(res.body.result.isError).toBeUndefined();
        expect(res.body.result.structuredContent).toEqual({ items: [] });
        expect(res.body.result.resultType).toBe('complete');
    });

    it('server/discover is answered, with serverInfo in the result _meta and not in its body', async () => {
        const res = await postModernMcp(baseUrl(), 'shop', 'server/discover', {}, 21);
        expect(res.status).toBe(200);
        expect(res.body.error).toBeUndefined();
        expect(res.body.result.supportedVersions).toContain(MODERN_PROTOCOL_VERSION);
        // Every 2026-era response identifies the server in its `_meta`; the result body carries no
        // `serverInfo` of its own (unlike the legacy `initialize` result, which does).
        expect(res.body.result._meta[SERVER_INFO_META_KEY].name).toBe('vendure-mcp-shop');
        expect(res.body.result.serverInfo).toBeUndefined();
    });

    it('a request claiming 2026-07-28 without the envelope is rejected, not served as legacy', async () => {
        const res = await postMcp(baseUrl(), 'shop', rpc('tools/list', {}, 22), {
            protocolVersion: MODERN_PROTOCOL_VERSION,
        });
        // Invalid-params (-32602) on HTTP 400: the version claim routed the request to the modern era,
        // which then found no envelope to serve it with. The message text is not asserted — it has
        // changed between SDK versions.
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe(-32602);
        expect(res.body.result).toBeUndefined();
    });

    it('refuses subscriptions/listen rather than opening a stream that can never deliver anything', async () => {
        const res = await postModernMcp(
            baseUrl(),
            'shop',
            'subscriptions/listen',
            { notifications: { toolsListChanged: true } },
            23,
        );
        // Method-not-found (-32601) on HTTP 404 — the same answer the SDK gives for any method the
        // server does not implement. Without this the SDK holds the connection open indefinitely.
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe(-32601);
        expect(res.body.result).toBeUndefined();
    });

    it('the official MCP SDK client connects, lists, and calls a shop tool (interop)', async () => {
        const client = new Client({ name: 'interop-test', version: '1.0.0' });
        const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl()}/mcp/shop`));
        await client.connect(transport);
        try {
            const tools = await client.listTools();
            expect(tools.tools.map(t => t.name)).toContain('shop_echo');
            const result = await client.callTool({ name: 'shop_echo', arguments: { text: 'sdk' } });
            expect((result.structuredContent as any).echoed).toBe('sdk');
        } finally {
            await client.close();
        }
    });
});

describe('MCP discovery mode', () => {
    // Test isolation, not a behavior change: with default rate limits, this describe's anonymous
    // shop calls would share the IP-keyed per-session bucket with later describes in this file
    // (they all call from the same test-host IP).
    const options: McpPluginOptions = {
        toolExposure: 'discovery',
        oauth: { tokenSecret: TOKEN_SECRET },
        rateLimits: { perSession: { rpm: 0 }, perClient: { rpm: 0 }, anonymousIp: false },
    };
    const config = mergeConfig(testConfig(), { plugins: [McpTestToolsPlugin, McpPlugin.init(options)] });
    const { server } = createTestEnvironment(config);
    const baseUrl = () => `http://localhost:${config.apiOptions.port}`;

    beforeAll(async () => {
        McpPlugin.init(options);
        await server.init(testServerInit);
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('tools/list returns exactly the two discovery meta-tools', async () => {
        const res = await postMcp(baseUrl(), 'shop', rpc('tools/list', {}, 1));
        expect(res.body.result.tools.map((t: any) => t.name).sort()).toEqual([
            'execute_tool',
            'search_tools',
        ]);
    });

    it('search_tools returns matching tools with their schemas', async () => {
        const res = await postMcp(
            baseUrl(),
            'shop',
            rpc('tools/call', { name: 'search_tools', arguments: { query: 'echo' } }, 2),
        );
        const tools = res.body.result.structuredContent.tools;
        expect(tools.map((t: any) => t.name)).toContain('shop_echo');
        expect(tools.find((t: any) => t.name === 'shop_echo').inputSchema.properties.text).toBeDefined();
    });

    it('execute_tool runs a tool found via search (two hops)', async () => {
        const res = await postMcp(
            baseUrl(),
            'shop',
            rpc(
                'tools/call',
                { name: 'execute_tool', arguments: { name: 'shop_echo', arguments: { text: 'hop' } } },
                3,
            ),
        );
        expect(res.body.result.structuredContent).toEqual({ echoed: 'hop' });
    });

    it('execute_tool rejects inner arguments that violate the target schema (funnel validation)', async () => {
        const res = await postMcp(
            baseUrl(),
            'shop',
            rpc(
                'tools/call',
                { name: 'execute_tool', arguments: { name: 'shop_echo', arguments: { text: 123 } } },
                4,
            ),
        );
        expect(res.body.result.isError).toBe(true);
        expect(res.body.result.content[0].text).toMatch(/Invalid arguments for tool "shop_echo"/);
    });

    it('execute_tool gates a destructive tool, then runs it with confirm:true (wire schema accepts confirm)', async () => {
        const preview = await postMcp(
            baseUrl(),
            'shop',
            rpc(
                'tools/call',
                { name: 'execute_tool', arguments: { name: 'shop_delete', arguments: { id: 'abc' } } },
                5,
            ),
        );
        expect(preview.body.result.isError).toBeUndefined();
        expect(preview.body.result.structuredContent).toMatchObject({
            status: 'confirmation_required',
            confirmed: false,
        });

        // `confirm` exists only on the wire schema, so execute_tool must validate against that
        // schema (the tool's own schema would reject the unknown `confirm`) and then strip it.
        const confirmed = await postMcp(
            baseUrl(),
            'shop',
            rpc(
                'tools/call',
                {
                    name: 'execute_tool',
                    arguments: { name: 'shop_delete', arguments: { id: 'abc', confirm: true } },
                },
                6,
            ),
        );
        // This mutation does not use the active order, so it creates no anonymous session.
        expect(confirmed.body.result.structuredContent).toEqual({ deleted: 'abc' });
    });
});

describe('MCP modern protocol era rate limiting', () => {
    const options: McpPluginOptions = {
        oauth: { tokenSecret: TOKEN_SECRET },
        // Only the per-session bucket is live, so a refusal here can only have come from the
        // controller's handshake pre-check — not from the anonymous-IP gate that runs ahead of it.
        rateLimits: { perSession: { rpm: 1 }, perClient: { rpm: 0 }, anonymousIp: false },
    };
    const config = mergeConfig(testConfig(), { plugins: [McpTestToolsPlugin, McpPlugin.init(options)] });
    const { server } = createTestEnvironment(config);
    const baseUrl = () => `http://localhost:${config.apiOptions.port}`;

    beforeAll(async () => {
        McpPlugin.init(options);
        await server.init(testServerInit);
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('meters a modern-envelope request and refuses it with -31029 once the bucket is spent', async () => {
        // The pre-check reads the top-level `method`, and the modern envelope does not move it — the
        // envelope lives in `params._meta`. So a modern request is metered exactly like a legacy one.
        const first = await postModernMcp(baseUrl(), 'shop', 'tools/list', {}, 1);
        expect(first.status).toBe(200);
        expect(first.body.result.tools.map((t: any) => t.name)).toContain('shop_echo');
        // Only the modern era puts the server identity in the result's `_meta`, so this is what
        // makes the test evidence about the era rather than about tools/list.
        expect(first.body.result._meta[SERVER_INFO_META_KEY]).toBeDefined();
        // A token-less request creates no session and returns no session-token header — shop tools
        // hand the token back in their result payloads instead.
        expect(first.headers.get(AUTH_TOKEN_HEADER)).toBeNull();

        // The per-session bucket is keyed by IP for anonymous callers, so the second request lands
        // in the same (now spent) bucket.
        const tripped = await postModernMcp(baseUrl(), 'shop', 'tools/list', {}, 2);
        expectRateLimitRefusal(tripped, { scope: 'session', id: 2 });
        // The pre-check names the bucket's subject after the method it read, so seeing `tools/list`
        // here is the proof that it read the method from the top level of a modern request.
        expect(tripped.body.error.message).toContain('tools/list');
    });
});

describe('MCP rate limiting of bodies the SDK will refuse', () => {
    const options: McpPluginOptions = {
        oauth: { tokenSecret: TOKEN_SECRET },
        // Only the per-session bucket is live, so any refusal below can only have come from the
        // controller's pre-check. Three requests fit in the budget, so the fourth is what reveals
        // whether the three unusable bodies before it were charged at all.
        //
        // The requests below carry a bearer token on purpose. Every describe in this file shares one
        // in-memory cache instance (they all merge the same defaultTestConfig), and an anonymous
        // caller's per-session bucket is keyed by client IP, so an anonymous budget here would be
        // partly spent by earlier describes. A grant's bucket is keyed by its own session token.
        rateLimits: {
            perSession: { rpm: 3 },
            perUser: { rpm: 0 },
            perClient: { rpm: 0 },
            anonymousIp: false,
        },
    };
    const config = mergeConfig(testConfig(), { plugins: [McpTestToolsPlugin, McpPlugin.init(options)] });
    const { server, adminClient } = createTestEnvironment(config);
    const baseUrl = () => `http://localhost:${config.apiOptions.port}`;
    let adminToken: string;

    beforeAll(async () => {
        McpPlugin.init(options);
        await server.init(testServerInit);
        await adminClient.asSuperAdmin();
        const flow = await runAuthorizationCodeFlow({
            baseUrl: baseUrl(),
            issuer: ISSUER,
            superAdminToken: adminClient.getAuthToken(),
        });
        adminToken = flow.access_token;
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('charges a bucket for a body with no method, a non-JSON body and a params-less tools/call', async () => {
        // Each of these three costs the server a full token authentication, so each has to be
        // metered even though the SDK then refuses the message.
        const noMethod = await postMcp(baseUrl(), 'admin', {}, { token: adminToken });
        expect(noMethod.status).toBe(400);

        const notJson = await postMcp(baseUrl(), 'admin', rpc('ping', {}, 1), {
            token: adminToken,
            contentType: 'text/plain',
        });
        expect(notJson.status).toBe(415);

        // `tools/call` is normally left to the tool registry to charge, but the SDK rejects a call
        // with no `params` before the registry ever runs, so the pre-check has to charge this one.
        const noParams = await postMcp(baseUrl(), 'admin', rpc('tools/call', undefined, 2), {
            token: adminToken,
        });
        expect(noParams.status).not.toBe(429);

        // Budget spent: a well-formed request is now refused.
        const refused = await postMcp(baseUrl(), 'admin', rpc('ping', {}, 3), { token: adminToken });
        expectRateLimitRefusal(refused, { scope: 'session', id: 3 });
    });
});

describe('MCP DNS-rebinding guard', () => {
    // Both halves of the guard are configured on one server. `allowedOrigins` can share it because
    // a request with no Origin header passes the origin check by design — only browsers send the
    // header, and only browser-originated requests are what it defends against — so the Host tests
    // below, which send no Origin, are unaffected by its presence.
    //
    // Entries in both lists are bare hostnames: no scheme, no port.
    const options: McpPluginOptions = {
        oauth: { tokenSecret: TOKEN_SECRET },
        dnsRebinding: { allowedHosts: ['localhost', '127.0.0.1'], allowedOrigins: ['localhost'] },
    };
    const config = mergeConfig(testConfig(), { plugins: [McpTestToolsPlugin, McpPlugin.init(options)] });
    const { server } = createTestEnvironment(config);
    const baseUrl = () => `http://localhost:${config.apiOptions.port}`;

    beforeAll(async () => {
        McpPlugin.init(options);
        await server.init(testServerInit);
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('rejects a request whose Host header is not allow-listed → 403', async () => {
        // `fetch` (undici) silently drops a custom Host header, so use raw http to forge it.
        const status = await new Promise<number>((resolve, reject) => {
            const url = new URL(`${baseUrl()}/mcp/shop`);
            const body = JSON.stringify(rpc('ping', {}, 1));
            const req = http.request(
                {
                    hostname: url.hostname,
                    port: url.port,
                    path: url.pathname,
                    method: 'POST',
                    headers: {
                        Host: 'evil.example.com',
                        Accept: MCP_ACCEPT,
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(body),
                    },
                },
                res => {
                    res.resume();
                    resolve(res.statusCode ?? 0);
                },
            );
            req.on('error', reject);
            req.write(body);
            req.end();
        });
        expect(status).toBe(403);
    });

    it('allows a request with an allow-listed Host', async () => {
        const res = await postMcp(baseUrl(), 'shop', rpc('ping', {}, 2));
        expect(res.status).toBe(200);
    });

    // Origin needs no raw-http workaround: undici strips a custom Host header but passes Origin
    // through untouched.
    it('rejects a request whose Origin header is not allow-listed → 403', async () => {
        const res = await postMcp(baseUrl(), 'shop', rpc('ping', {}, 3), {
            headers: { Origin: 'https://evil.example.com' },
        });

        expect(res.status).toBe(403);
        expect(res.body.jsonrpc).toBe('2.0');
        expect(res.body.error.message).toBe('Invalid Origin: evil.example.com');
        expect(res.body.result).toBeUndefined();
    });

    it('allows a request with an allow-listed Origin', async () => {
        const res = await postMcp(baseUrl(), 'shop', rpc('ping', {}, 4), {
            // The allow-list holds hostnames, so the port here is deliberately not on it and must
            // still be accepted.
            headers: { Origin: `http://localhost:${config.apiOptions.port}` },
        });

        expect(res.status).toBe(200);
    });
});
