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
import { callTool, expectRateLimitRefusal, postMcp, rpc } from './utils/mcp-http-client';
import { runAuthorizationCodeFlow, runShopAuthorizationCodeFlow } from './utils/oauth-test-client';

const TOKEN_SECRET = 'mcp-transport-secret-0000000000000000000000';
const ISSUER = `http://localhost:${testConfig().apiOptions.port}`;
const productsCsvPath = path.join(__dirname, 'fixtures/e2e-products.csv');

const AUTH_TOKEN_HEADER = 'vendure-auth-token';
const CHANNEL_TOKEN_HEADER = 'vendure-token';

/** Anonymous session rows are the thing an unmetered public endpoint accumulates, so tests count them. */
const countAnonymousSessions = (server: TestServer) =>
    server.app.get(TransactionalConnection).rawConnection.getRepository(AnonymousSession).count();

describe('MCP transport (auth, session, channel, destructive)', () => {
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

    it('handshake rate limit returns 429 + Retry-After WITH machine-readable error.data', async () => {
        // anonymousIp rpm = 2, so the third sequential anonymous ping trips the limit.
        await postMcp(baseUrl(), 'shop', rpc('ping', {}, 1));
        await postMcp(baseUrl(), 'shop', rpc('ping', {}, 2));
        const tripped = await postMcp(baseUrl(), 'shop', rpc('ping', {}, 3));
        expectRateLimitRefusal(tripped, { scope: 'anonymous IP', id: 3 });
    });

    it('refuses a request once the bucket is spent without creating a session for it', async () => {
        // The anonymous-IP bucket is already spent by the previous test (60s window). The refusal has
        // to come before the context is built, because building it writes an anonymous session row.
        const before = await countAnonymousSessions(server);
        const refused = await postMcp(baseUrl(), 'shop', rpc('ping', {}, 4));
        expect(refused.body.error.code).toBe(-31029);
        expect(await countAnonymousSessions(server)).toBe(before);
    });

    it('addresses the refusal to the first message that carries an id', async () => {
        // The anonymous-IP bucket is still spent, so this batch is refused at the same gate. Its
        // first message is a notification with no id, so the refusal has to skip past it and answer
        // the request behind it — otherwise a batching client cannot match the refusal to what it sent.
        const batch = [{ jsonrpc: '2.0', method: 'notifications/initialized' }, rpc('ping', {}, 7)];
        const refused = await postMcp(baseUrl(), 'shop', batch);
        expectRateLimitRefusal(refused, { scope: 'anonymous IP', id: 7 });
    });
});

describe('MCP transport failed-authentication metering', () => {
    const options: McpPluginOptions = {
        oauth: { tokenSecret: TOKEN_SECRET },
        rateLimits: {
            perSession: { rpm: 0 },
            perClient: { rpm: 0 },
            anonymousIp: false,
            oauthIp: { rpm: 2 },
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

    it('refuses further invalid-token requests with 429 once the failure limit is spent', async () => {
        // oauthIp rpm = 2 also caps failed bearer authentications. The pre-check reads the count
        // BEFORE the token lookup and only refuses once it exceeds the limit, and each 401 then
        // increments it — so requests 1-3 reach authentication and fail with 401, request 4 is
        // refused before the database is touched.
        for (let i = 1; i <= 3; i++) {
            const denied = await postMcp(baseUrl(), 'admin', rpc('ping', {}, i), { token: 'garbage' });
            expect(denied.status).toBe(401);
        }
        const tripped = await postMcp(baseUrl(), 'admin', rpc('ping', {}, 4), { token: 'garbage' });
        expectRateLimitRefusal(tripped, { scope: 'authentication failures', id: 4 });
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

        const responses = [];
        for (let i = 0; i < 6; i++) {
            responses.push(await postMcp(baseUrl(), 'shop', notification));
        }

        expect((await countAnonymousSessions(server)) - before).toBeLessThanOrEqual(3);
        const refused = responses.filter(response => response.status === 429);
        expect(refused.length).toBeGreaterThan(0);
        // Nothing in the request carries an id, so the refusal has to fall back to a null one.
        expectRateLimitRefusal(refused[0], { scope: 'anonymous IP', id: null });
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

    it('keys per-tool buckets by IP for anonymous callers — dropping the session token does not reset the limit', async () => {
        // shop_echo rpm = 1. The first anonymous call is allowed and issues a session token.
        const first = await postMcp(baseUrl(), 'shop', callTool('shop_echo', { text: 'x' }, 1));
        expect(first.body.result.isError).toBeUndefined();
        const sessionToken = first.headers.get(AUTH_TOKEN_HEADER) as string;
        expect(sessionToken).toBeTruthy();

        // A cooperating client that threads the token is refused. Per-tool limits are enforced
        // inside the registry, after the SDK has dispatched the call, and the SDK strips custom
        // error codes there — so the refusal is isError content, not a -31029 JSON-RPC error.
        const second = await postMcp(baseUrl(), 'shop', callTool('shop_echo', { text: 'x' }, 2), {
            headers: { [AUTH_TOKEN_HEADER]: sessionToken },
        });
        expect(second.body.error).toBeUndefined();
        expect(second.body.result.isError).toBe(true);
        expect(second.body.result.content[0].text).toMatch(/Rate limit exceeded/);

        // The regression: a caller that OMITS the session header used to be minted a fresh session
        // — and a fresh bucket — on every request, so only cooperating callers were ever limited.
        // Same IP, no header: still refused. (This describe also runs with anonymousIp: false, the
        // documented configuration under which the old keys left no limit applying at all.)
        const third = await postMcp(baseUrl(), 'shop', callTool('shop_echo', { text: 'x' }, 3));
        expect(third.body.result.isError).toBe(true);
        expect(third.body.result.content[0].text).toMatch(/Rate limit exceeded/);
    });
});

describe('MCP transport content-type casing', () => {
    // anonymousIp is disabled so the only bucket in play is perSession — the one the handshake
    // pre-check itself enforces (keyed by IP for anonymous callers). The single test below owns
    // that bucket entirely, so it can run alone and is unaffected by other tests' traffic. The
    // uppercase-SERVING case lives in the dispatch describe above, which runs with limits off.
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

    it('meters an uppercase-header handshake exactly like lowercase (bypass closed)', async () => {
        // perSession rpm = 2, so the third ping (charge 3) trips the limit — same shape as the
        // -31029 test above, but on the per-session bucket (keyed by IP for anonymous callers)
        // rather than the anonymous-IP edge gate, so an uppercase Content-Type can't dodge the
        // handshake pre-check by skipping the JSON parse.
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
        expectRateLimitRefusal(tripped, { scope: 'session', id: 3 });
    });
});

describe('MCP transport shopAccess: disabled', () => {
    const options: McpPluginOptions = {
        oauth: {
            tokenSecret: TOKEN_SECRET,
            storefrontConsentUrl: 'https://storefront.example.com/mcp/authorize',
        },
        shopAccess: 'disabled',
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

    it('POST /mcp/shop returns 404', async () => {
        const res = await postMcp(baseUrl(), 'shop', rpc('ping', {}, 1));
        expect(res.status).toBe(404);
    });

    it('GET /mcp/shop returns 404, not the 405 it returns when shop access is enabled', async () => {
        const res = await fetch(`${baseUrl()}/mcp/shop`);
        expect(res.status).toBe(404);
    });

    it('the admin endpoint still answers, proving only shop is gone', async () => {
        const res = await postMcp(baseUrl(), 'admin', rpc('ping', {}, 1));
        expect(res.status).toBe(401);
        expect(res.headers.get('www-authenticate') ?? '').toMatch(/^Bearer .*resource_metadata=/);
    });

    it('shop protected-resource metadata 404s while admin metadata still 200s', async () => {
        const shopMeta = await fetch(`${baseUrl()}/.well-known/oauth-protected-resource/mcp/shop`);
        expect(shopMeta.status).toBe(404);

        const adminMeta = await fetch(`${baseUrl()}/.well-known/oauth-protected-resource/mcp/admin`);
        expect(adminMeta.status).toBe(200);
        expect((await adminMeta.json()).resource).toBe(`${ISSUER}/mcp/admin`);
    });

    // resolveResource no longer recognises the shop resource at all when shopAccess is disabled,
    // so an authorize request naming it fails the same way it would for any unrecognised URL.
    it('refuses an authorize request naming the shop resource as an unsupported resource', async () => {
        const authorizeUrl = new URL(`${baseUrl()}/mcp/oauth/authorize`);
        authorizeUrl.searchParams.set('response_type', 'code');
        authorizeUrl.searchParams.set('client_id', 'irrelevant-client-id');
        authorizeUrl.searchParams.set('redirect_uri', 'https://example.com/cb');
        authorizeUrl.searchParams.set('code_challenge', 'x'.repeat(43));
        authorizeUrl.searchParams.set('code_challenge_method', 'S256');
        authorizeUrl.searchParams.set('resource', `${ISSUER}/mcp/shop`);

        const res = await fetch(authorizeUrl, { redirect: 'manual' });
        expect(res.status).toBe(400);
        expect(await res.text()).toMatch(/Unsupported OAuth resource/i);
    });
});

describe('MCP transport shopAccess: authenticated', () => {
    const options: McpPluginOptions = {
        oauth: {
            tokenSecret: TOKEN_SECRET,
            storefrontConsentUrl: 'https://storefront.example.com/mcp/authorize',
        },
        shopAccess: 'authenticated',
    };
    const config = mergeConfig(testConfig(), { plugins: [McpTestToolsPlugin, McpPlugin.init(options)] });
    const { server, adminClient, shopClient } = createTestEnvironment(config);
    const baseUrl = () => `http://localhost:${config.apiOptions.port}`;
    let customerAuthToken: string;

    beforeAll(async () => {
        McpPlugin.init(options);
        await server.init({ initialData, productsCsvPath, customerCount: 1 });
        await adminClient.asSuperAdmin();

        // Log in a real seeded customer on the shop client to obtain a customer session token —
        // the storefront consent step approves the shop grant with this token.
        const { customers } = await adminClient.query(gql`
            query {
                customers(options: { take: 1 }) {
                    items {
                        emailAddress
                    }
                }
            }
        `);
        const customerEmail = customers.items[0]?.emailAddress;
        if (!customerEmail) {
            throw new Error('Expected at least one seeded customer');
        }
        const login = await shopClient.asUserWithCredentials(customerEmail, 'test');
        if (!login || login.errorCode) {
            throw new Error(`Customer login failed: ${JSON.stringify(login)}`);
        }
        customerAuthToken = shopClient.getAuthToken();
        if (!customerAuthToken) {
            throw new Error('Customer login did not yield a session token');
        }
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('a token-less POST /mcp/shop is refused with a challenge pointing at the shop metadata URL', async () => {
        const res = await postMcp(baseUrl(), 'shop', rpc('ping', {}, 1));
        expect(res.status).toBe(401);
        const challenge = res.headers.get('www-authenticate') ?? '';
        expect(challenge).toMatch(/^Bearer .*resource_metadata=/);
        expect(challenge).toContain(`${ISSUER}/.well-known/oauth-protected-resource/mcp/shop`);
    });

    it('a full customer OAuth flow succeeds and a subsequent tools/call with the access token succeeds', async () => {
        const flow = await runShopAuthorizationCodeFlow({
            baseUrl: baseUrl(),
            issuer: ISSUER,
            vendureAuthToken: customerAuthToken,
        });
        expect(flow.access_token).toBeTruthy();

        const result = await postMcp(baseUrl(), 'shop', callTool('shop_ping', {}, 1), {
            token: flow.access_token,
        });
        expect(result.body.result.isError).toBeUndefined();
    });
});
