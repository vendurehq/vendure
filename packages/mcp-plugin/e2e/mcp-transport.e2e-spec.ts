import { AnonymousSession, mergeConfig, TransactionalConnection } from '@vendure/core';
import { createTestEnvironment, TestServer } from '@vendure/testing';
import { gql } from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { McpPlugin } from '../src/plugin';
import { McpPluginOptions } from '../src/types';

import { McpTestToolsPlugin } from './fixtures/mcp-test-tools';
import { postMcp, rpc } from './utils/mcp-http-client';
import { runAuthorizationCodeFlow } from './utils/oauth-test-client';

const TOKEN_SECRET = 'mcp-transport-secret-0000000000000000000000';
const ISSUER = 'http://localhost:3500';
const productsCsvPath = path.join(__dirname, 'fixtures/e2e-products.csv');

const AUTH_TOKEN_HEADER = 'vendure-auth-token';
const CHANNEL_TOKEN_HEADER = 'vendure-token';

const callTool = (name: string, args: Record<string, unknown> = {}, id = 1) =>
    rpc('tools/call', { name, arguments: args }, id);

/** Anonymous session rows are the thing an unmetered public endpoint accumulates, so tests count them. */
const countAnonymousSessions = (server: TestServer) =>
    server.app.get(TransactionalConnection).rawConnection.getRepository(AnonymousSession).count();

describe('MCP transport (auth, session, channel, destructive)', () => {
    const options: McpPluginOptions = { oauth: { tokenSecret: TOKEN_SECRET } };
    const config = mergeConfig(testConfig(), { plugins: [McpTestToolsPlugin, McpPlugin.init(options)] });
    const { server, adminClient } = createTestEnvironment(config);
    const baseUrl = () => `http://localhost:${config.apiOptions.port}`;
    let adminToken: string;
    let secondChannelToken: string | undefined;

    beforeAll(async () => {
        McpPlugin.init(options);
        await server.init({ initialData, productsCsvPath, customerCount: 1 });
        await adminClient.asSuperAdmin();
        adminToken = (
            await runAuthorizationCodeFlow({
                baseUrl: baseUrl(),
                issuer: ISSUER,
                superAdminToken: adminClient.getAuthToken(),
            })
        ).access_token;

        // Create a second channel so the anonymous channel-selection test has a non-default target.
        const { zones } = await adminClient.query(gql`
            query {
                zones {
                    items {
                        id
                    }
                }
            }
        `);
        const active = await adminClient.query(gql`
            query {
                activeChannel {
                    defaultLanguageCode
                    defaultCurrencyCode
                }
            }
        `);
        const zoneId = zones.items[0].id;
        const created = await adminClient.query(
            gql`
                mutation Create($input: CreateChannelInput!) {
                    createChannel(input: $input) {
                        __typename
                        ... on Channel {
                            id
                            token
                        }
                    }
                }
            `,
            {
                input: {
                    code: 'second-channel',
                    token: 'second-channel-token',
                    defaultLanguageCode: active.activeChannel.defaultLanguageCode,
                    defaultCurrencyCode: active.activeChannel.defaultCurrencyCode,
                    pricesIncludeTax: false,
                    defaultShippingZoneId: zoneId,
                    defaultTaxZoneId: zoneId,
                },
            },
        );
        secondChannelToken = created.createChannel.token;
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('exposes different tool subsets per auth context', async () => {
        const shop = await postMcp(baseUrl(), 'shop', rpc('tools/list', {}, 1));
        const shopNames = shop.body.result.tools.map((t: any) => t.name);
        expect(shopNames).toEqual(expect.arrayContaining(['shop_ping', 'shop_echo']));
        expect(shopNames).not.toContain('admin_list');

        const admin = await postMcp(baseUrl(), 'admin', rpc('tools/list', {}, 2), { token: adminToken });
        const adminNames = admin.body.result.tools.map((t: any) => t.name);
        expect(adminNames).toContain('admin_list');
        expect(adminNames).not.toContain('shop_ping');
    });

    it('threads the anonymous session token so two calls hit the same session', async () => {
        const first = await postMcp(baseUrl(), 'shop', callTool('shop_ping', {}, 1));
        const echoedToken = first.headers.get(AUTH_TOKEN_HEADER);
        expect(echoedToken).toBeTruthy();
        const firstSessionId = first.body.result.structuredContent.sessionId;
        expect(firstSessionId).toBeTruthy();

        const second = await postMcp(baseUrl(), 'shop', callTool('shop_ping', {}, 2), {
            headers: { [AUTH_TOKEN_HEADER]: echoedToken as string },
        });
        expect(second.body.result.structuredContent.sessionId).toBe(firstSessionId);
    });

    it('selects a non-default channel from the channel token header', async () => {
        expect(secondChannelToken).toBeTruthy();
        const defaultCall = await postMcp(baseUrl(), 'shop', callTool('shop_ping', {}, 1));
        const defaultChannelId = defaultCall.body.result.structuredContent.channelId;

        const scoped = await postMcp(baseUrl(), 'shop', callTool('shop_ping', {}, 2), {
            headers: { [CHANNEL_TOKEN_HEADER]: secondChannelToken as string },
        });
        const scopedChannelId = scoped.body.result.structuredContent.channelId;
        expect(scopedChannelId).toBeTruthy();
        expect(scopedChannelId).not.toBe(defaultChannelId);
    });

    it('errors on an invalid channel token (no silent fallback)', async () => {
        const res = await postMcp(baseUrl(), 'shop', callTool('shop_ping', {}, 1), {
            headers: { [CHANNEL_TOKEN_HEADER]: 'not-a-real-channel-token' },
        });
        expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('gates a destructive tool behind confirmation, then runs it with confirm:true', async () => {
        const preview = await postMcp(baseUrl(), 'shop', callTool('shop_delete', { id: 'abc' }, 1));
        expect(preview.body.result.isError).toBeUndefined();
        expect(preview.body.result.structuredContent).toMatchObject({
            status: 'confirmation_required',
            confirmed: false,
        });

        const confirmed = await postMcp(
            baseUrl(),
            'shop',
            callTool('shop_delete', { id: 'abc', confirm: true }, 2),
        );
        expect(confirmed.body.result.structuredContent).toEqual({ deleted: 'abc' });
    });
});

describe('MCP transport rate limiting', () => {
    const options: McpPluginOptions = {
        oauth: { tokenSecret: TOKEN_SECRET },
        rateLimits: { perSession: { rpm: 0 }, perClient: { rpm: 0 }, anonymousIp: { rpm: 2 } },
    };
    const config = mergeConfig(testConfig(), { plugins: [McpTestToolsPlugin, McpPlugin.init(options)] });
    const { server } = createTestEnvironment(config);
    const baseUrl = () => `http://localhost:${config.apiOptions.port}`;

    beforeAll(async () => {
        McpPlugin.init(options);
        await server.init({ initialData, productsCsvPath, customerCount: 1 });
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('handshake rate limit returns -32029 WITH machine-readable error.data', async () => {
        // anonymousIp rpm = 2, so the third sequential anonymous ping trips the limit.
        await postMcp(baseUrl(), 'shop', rpc('ping', {}, 1));
        await postMcp(baseUrl(), 'shop', rpc('ping', {}, 2));
        const tripped = await postMcp(baseUrl(), 'shop', rpc('ping', {}, 3));
        expect(tripped.status).toBe(200);
        expect(tripped.body.error.code).toBe(-32029);
        expect(tripped.body.error.data.retryAfterSeconds).toBeGreaterThan(0);
        expect(tripped.body.error.data.scope).toBe('anonymous IP');
    });

    it('refuses a request once the bucket is spent without creating a session for it', async () => {
        // The anonymous-IP bucket is already spent by the previous test (60s window). The refusal has
        // to come before the context is built, because building it writes an anonymous session row.
        const before = await countAnonymousSessions(server);
        const refused = await postMcp(baseUrl(), 'shop', rpc('ping', {}, 4));
        expect(refused.body.error.code).toBe(-32029);
        expect(await countAnonymousSessions(server)).toBe(before);
    });
});

describe('MCP transport anonymous session metering', () => {
    const options: McpPluginOptions = {
        oauth: { tokenSecret: TOKEN_SECRET },
        rateLimits: { perSession: { rpm: 0 }, perClient: { rpm: 0 }, anonymousIp: { rpm: 3 } },
    };
    const config = mergeConfig(testConfig(), { plugins: [McpTestToolsPlugin, McpPlugin.init(options)] });
    const { server } = createTestEnvironment(config);
    const baseUrl = () => `http://localhost:${config.apiOptions.port}`;

    beforeAll(async () => {
        McpPlugin.init(options);
        await server.init({ initialData, productsCsvPath, customerCount: 1 });
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('meters a notification flood and stops creating anonymous sessions', async () => {
        // A notification carries no id, so it never produces a JSON-RPC response — but it does reach
        // the transport, which creates a session for it. anonymousIp rpm = 3, so at most three of these
        // six posts may be served.
        const notification = { jsonrpc: '2.0', method: 'notifications/initialized' };
        const before = await countAnonymousSessions(server);

        const statuses: number[] = [];
        for (let i = 0; i < 6; i++) {
            statuses.push((await postMcp(baseUrl(), 'shop', notification)).status);
        }

        expect((await countAnonymousSessions(server)) - before).toBeLessThanOrEqual(3);
        expect(statuses.filter(status => status === 429).length).toBeGreaterThan(0);
    });
});

describe('MCP transport per-tool rate limiting', () => {
    const options: McpPluginOptions = {
        oauth: { tokenSecret: TOKEN_SECRET },
        rateLimits: {
            perSession: { rpm: 0 },
            perClient: { rpm: 0 },
            anonymousIp: false,
            perTool: { shop_echo: { rpm: 1 } },
        },
    };
    const config = mergeConfig(testConfig(), { plugins: [McpTestToolsPlugin, McpPlugin.init(options)] });
    const { server } = createTestEnvironment(config);
    const baseUrl = () => `http://localhost:${config.apiOptions.port}`;

    beforeAll(async () => {
        McpPlugin.init(options);
        await server.init({ initialData, productsCsvPath, customerCount: 1 });
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('a tool-path rate limit flattens to isError (no -32029 code)', async () => {
        // Per-tool buckets are keyed by session, so the second call threads the session token the
        // first one issued — as a real client would — to land in the same bucket.
        const first = await postMcp(baseUrl(), 'shop', callTool('shop_echo', { text: 'x' }, 1));
        expect(first.body.result.isError).toBeUndefined();
        const sessionToken = first.headers.get(AUTH_TOKEN_HEADER) as string;
        expect(sessionToken).toBeTruthy();

        // Per-tool limits are enforced inside the registry, after the SDK has dispatched the call, and
        // the SDK strips custom error codes from anything thrown there — so exceeding one surfaces as
        // isError content rather than as a -32029 JSON-RPC error.
        const second = await postMcp(baseUrl(), 'shop', callTool('shop_echo', { text: 'x' }, 2), {
            headers: { [AUTH_TOKEN_HEADER]: sessionToken },
        });
        expect(second.body.error).toBeUndefined();
        expect(second.body.result.isError).toBe(true);
        expect(second.body.result.content[0].text).toMatch(/Rate limit exceeded/);
    });
});

describe('MCP transport content-type casing', () => {
    // anonymousIp is disabled so the only bucket in play is perSession — the one the handshake
    // pre-check itself enforces — isolating it from the unrelated anonymous-IP gate that runs
    // earlier in the request and would refuse regardless of Content-Type casing.
    const options: McpPluginOptions = {
        oauth: { tokenSecret: TOKEN_SECRET },
        rateLimits: { perSession: { rpm: 2 }, perClient: { rpm: 0 }, anonymousIp: false },
    };
    const config = mergeConfig(testConfig(), { plugins: [McpTestToolsPlugin, McpPlugin.init(options)] });
    const { server } = createTestEnvironment(config);
    const baseUrl = () => `http://localhost:${config.apiOptions.port}`;

    beforeAll(async () => {
        McpPlugin.init(options);
        await server.init({ initialData, productsCsvPath, customerCount: 1 });
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('serves a request with an uppercase Content-Type identically to lowercase', async () => {
        const lower = await postMcp(baseUrl(), 'shop', callTool('shop_echo', { text: 'hi' }, 1));
        expect(lower.body.result.isError).toBeUndefined();
        expect(lower.body.result.structuredContent).toEqual({ echoed: 'hi' });

        const upper = await postMcp(baseUrl(), 'shop', callTool('shop_echo', { text: 'hi' }, 2), {
            contentType: 'APPLICATION/JSON',
        });
        expect(upper.body.result.isError).toBeUndefined();
        expect(upper.body.result.structuredContent).toEqual({ echoed: 'hi' });
    });

    it('meters an uppercase-header handshake exactly like lowercase (bypass closed)', async () => {
        // perSession rpm = 2, so the third `ping` on the same threaded session trips the limit — same
        // shape as the -32029 test above, but keyed by session (the handshake pre-check's own bucket)
        // rather than anonymous IP, so an uppercase Content-Type can't dodge it by skipping the check.
        const first = await postMcp(baseUrl(), 'shop', rpc('ping', {}, 1));
        const sessionToken = first.headers.get(AUTH_TOKEN_HEADER) as string;
        expect(sessionToken).toBeTruthy();

        await postMcp(baseUrl(), 'shop', rpc('ping', {}, 2), {
            headers: { [AUTH_TOKEN_HEADER]: sessionToken },
        });
        const tripped = await postMcp(baseUrl(), 'shop', rpc('ping', {}, 3), {
            headers: { [AUTH_TOKEN_HEADER]: sessionToken },
            contentType: 'APPLICATION/JSON',
        });
        expect(tripped.body.error.code).toBe(-32029);
    });
});
