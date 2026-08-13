import {
    EventBus,
    mergeConfig,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import { firstValueFrom } from 'rxjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { McpToolCallLog } from '../src/entities/mcp-tool-call-log.entity';
import { McpToolCallEvent } from '../src/events/mcp-tool-call.event';
import { McpPlugin } from '../src/plugin';
import { McpPluginOptions } from '../src/types';

import { McpTestToolsPlugin } from './fixtures/mcp-test-tools';
import { MCP_TOOL_CALL_LOGS_WITH_BODIES_QUERY } from './graphql/admin-definitions';
import { provisionAdmin } from './utils/admin-fixtures';
import { callTool, postMcp } from './utils/mcp-http-client';
import { runAuthorizationCodeFlow } from './utils/oauth-test-client';
import { initTestServer } from './utils/test-server';

const TOKEN_SECRET = 'logging-secret-000000000000000000000000000';
const ISSUER = `http://localhost:${testConfig().apiOptions.port}`;

describe('MCP tool-call logging', () => {
    const options: McpPluginOptions = { oauth: { tokenSecret: TOKEN_SECRET } };
    const config = mergeConfig(testConfig(), {
        plugins: [McpTestToolsPlugin, McpPlugin.init(options)],
    });
    const { server, adminClient } = createTestEnvironment(config);
    const baseUrl = () => `http://localhost:${config.apiOptions.port}`;

    let connection: TransactionalConnection;
    let adminCtx: RequestContext;
    let eventBus: EventBus;

    beforeAll(async () => {
        McpPlugin.init(options);
        await initTestServer(server);
        await adminClient.asSuperAdmin();
        connection = server.app.get(TransactionalConnection);
        eventBus = server.app.get(EventBus);
        adminCtx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    async function logRow(toolName: string): Promise<McpToolCallLog> {
        return connection
            .getRepository(adminCtx, McpToolCallLog)
            .findOneOrFail({ where: { toolName }, order: { createdAt: 'DESC', id: 'DESC' } });
    }

    async function adminAccessToken(): Promise<string> {
        const flow = await runAuthorizationCodeFlow({
            baseUrl: baseUrl(),
            issuer: ISSUER,
            superAdminToken: adminClient.getAuthToken(),
        });
        return flow.access_token;
    }

    it('persists a metadata-only success row and publishes McpToolCallEvent for an anonymous shop call', async () => {
        // Subscribe before triggering the call to avoid racing the publish.
        const eventPromise = firstValueFrom(eventBus.ofType(McpToolCallEvent));
        const response = await postMcp(baseUrl(), 'shop', callTool('shop_ping', { text: 'hello' }, 1));
        expect(response.body.result.isError).toBeUndefined();

        const event = await eventPromise;
        expect(event).toBeInstanceOf(McpToolCallEvent);
        expect(event.entry.id).toBeDefined();
        expect(event.entry.toolName).toBe('shop_ping');
        expect(event.entry.status).toBe('success');

        const row = await logRow('shop_ping');
        expect(row.status).toBe('success');
        // Anonymous shop call → no OAuth grant, actor type derived from the shop apiType.
        expect(row.actorType).toBe('anonymous');
        expect(row.grantId).toBeNull();
        expect(row.oauthClientId).toBeNull();
        expect(row.actor).toBeNull();
        // channelId must be set — the per-channel stats depend on it.
        expect(row.channelId).not.toBeNull();
        expect(typeof row.pluginSource).toBe('string');
        expect(typeof row.durationMs).toBe('number');
        // Default 'metadata' capture: request/response bodies are not persisted, so no call PII is stored.
        expect(row.input).toBeNull();
        expect(row.output).toBeNull();
        // captureClientIp defaults to off, so the caller's IP is not stored either.
        expect(row.clientIp).toBeNull();
    });

    it('persists an error row and publishes the event when a tool throws', async () => {
        const eventPromise = firstValueFrom(eventBus.ofType(McpToolCallEvent));
        const response = await postMcp(baseUrl(), 'shop', callTool('shop_boom', {}, 2));
        expect(response.body.result.isError).toBe(true);
        // shop_boom throws a plain Error, which is internal — the caller gets the generic
        // message, not the real one ("boom").
        expect(response.body.result.content[0].text).not.toMatch(/boom/);
        expect(response.body.result.content[0].text).toMatch(/failed unexpectedly/);

        const event = await eventPromise;
        expect(event.entry.toolName).toBe('shop_boom');
        expect(event.entry.status).toBe('error');

        const row = await logRow('shop_boom');
        expect(row.status).toBe('error');
    });

    it('sources actor/client fields from the OAuth grant for an authenticated admin call', async () => {
        const token = await adminAccessToken();
        const response = await postMcp(baseUrl(), 'admin', callTool('admin_list', {}, 3), { token });
        expect(response.body.result.isError).toBeUndefined();

        const row = await logRow('admin_list');
        expect(row.status).toBe('success');
        expect(row.actorType).toBe('admin');
        expect(row.grantId).not.toBeNull();
        expect(row.oauthClientId).not.toBeNull();
        expect(row.actor).not.toBeNull(); // stringified user id
        // An admin approval stores no channel on the grant, so its calls are logged
        // channel-less — the row is global, like the grant itself.
        expect(row.channelId).toBeNull();
    });

    it('shows channel-less admin-grant activity in the log and stats of every channel', async () => {
        const token = await adminAccessToken();
        const response = await postMcp(baseUrl(), 'admin', callTool('admin_list', {}, 4), { token });
        expect(response.body.result.isError).toBeUndefined();

        // A second channel, so we can read the dashboard queries from a non-default channel.
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
        const created = await adminClient.query(
            gql`
                mutation CreateLoggingChannel($input: CreateChannelInput!) {
                    createChannel(input: $input) {
                        __typename
                        ... on Channel {
                            token
                        }
                    }
                }
            `,
            {
                input: {
                    code: 'logging-second-channel',
                    token: 'logging-second-channel-token',
                    defaultLanguageCode: active.activeChannel.defaultLanguageCode,
                    defaultCurrencyCode: active.activeChannel.defaultCurrencyCode,
                    pricesIncludeTax: false,
                    defaultShippingZoneId: zones.items[0].id,
                    defaultTaxZoneId: zones.items[0].id,
                },
            },
        );
        expect(created.createChannel.token).toBeDefined();

        // Query the log list and the stats as the superadmin, but on the second channel.
        const result = await fetch(`${baseUrl()}/${config.apiOptions.adminApiPath ?? 'admin-api'}`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                Authorization: `Bearer ${adminClient.getAuthToken()}`,
                'vendure-token': created.createChannel.token,
            },
            body: JSON.stringify({
                query: `query {
                    mcpToolCallLogs { items { toolName } totalItems }
                    mcpStats { totalCalls }
                }`,
            }),
        });
        const body = (await result.json()) as {
            data?: {
                mcpToolCallLogs: { items: Array<{ toolName: string }>; totalItems: number };
                mcpStats: { totalCalls: number };
            };
            errors?: Array<{ message: string }>;
        };
        expect(body.errors).toBeUndefined();
        if (!body.data) {
            throw new Error(`Query returned no data: ${JSON.stringify(body.errors)}`);
        }
        const toolNames = body.data.mcpToolCallLogs.items.map(item => item.toolName);
        // The channel-less admin-grant call is visible from the second channel...
        expect(toolNames).toContain('admin_list');
        expect(body.data.mcpStats.totalCalls).toBeGreaterThanOrEqual(1);
        // ...while rows logged under the default channel stay scoped to it.
        expect(toolNames).not.toContain('shop_ping');
    });
});

interface GraphQLResponse<T = any> {
    data?: T;
    errors?: Array<{ message: string }>;
}

// A caller needs ReadMcpServer to reach mcpToolCallLogs at all, but with full capture on
// the stored bodies can hold customer personal data — so reading input/output also needs
// ReadCustomer, gated at the field level rather than the query level.
describe('MCP tool-call log input/output permission gating (full capture)', () => {
    const options: McpPluginOptions = {
        oauth: { tokenSecret: TOKEN_SECRET },
        logging: { capture: 'full', captureClientIp: true },
    };
    const config = mergeConfig(testConfig(), {
        plugins: [McpTestToolsPlugin, McpPlugin.init(options)],
    });
    const { server, adminClient } = createTestEnvironment(config);
    const baseUrl = () => `http://localhost:${config.apiOptions.port}`;
    const adminApiUrl = () => `${baseUrl()}/${config.apiOptions.adminApiPath ?? 'admin-api'}`;

    let connection: TransactionalConnection;
    let adminCtx: RequestContext;
    let superAdminToken: string;
    let defaultChannelGqlId: string;

    beforeAll(async () => {
        McpPlugin.init(options);
        await initTestServer(server);
        await adminClient.asSuperAdmin();
        superAdminToken = adminClient.getAuthToken();
        connection = server.app.get(TransactionalConnection);
        adminCtx = await server.app.get(RequestContextService).create({ apiType: 'admin' });

        const { activeChannel } = await adminClient.query(gql`
            query {
                activeChannel {
                    id
                }
            }
        `);
        defaultChannelGqlId = activeChannel.id;

        // Trigger a real tool call so a full-capture row with non-null input/output exists.
        await postMcp(baseUrl(), 'shop', callTool('shop_ping', { text: 'jane.doe@example.com' }, 1));
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    async function logRow(toolName: string): Promise<McpToolCallLog> {
        return connection
            .getRepository(adminCtx, McpToolCallLog)
            .findOneOrFail({ where: { toolName }, order: { createdAt: 'DESC', id: 'DESC' } });
    }

    /** Runs a GraphQL request against the admin API as the given token, without touching the shared adminClient's login state. */
    async function adminGraphQL<T = any>(
        token: string,
        query: string,
        variables: Record<string, unknown> = {},
    ): Promise<GraphQLResponse<T>> {
        const response = await fetch(adminApiUrl(), {
            method: 'POST',
            headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ query, variables }),
        });
        return (await response.json()) as GraphQLResponse<T>;
    }

    it('an admin with only ReadMcpServer sees metadata but gets null input/output/clientIp', async () => {
        const limitedToken = await provisionAdmin(
            { adminClient, adminApiUrl: adminApiUrl(), channelId: defaultChannelGqlId },
            'mcp-read-only-log',
            ['ReadMcpServer'],
        );

        const result = await adminGraphQL(limitedToken, MCP_TOOL_CALL_LOGS_WITH_BODIES_QUERY, {
            options: { filter: { toolName: { eq: 'shop_ping' } }, take: 1 },
        });
        expect(result.errors).toBeUndefined();
        const row = result.data.mcpToolCallLogs.items[0];
        expect(row.toolName).toBe('shop_ping');
        expect(row.status).toBe('success');
        expect(row.input).toBeNull();
        expect(row.output).toBeNull();
        expect(row.clientIp).toBeNull();
    });

    it('the superadmin, who holds ReadCustomer, sees the actual bodies and clientIp', async () => {
        const result = await adminGraphQL(superAdminToken, MCP_TOOL_CALL_LOGS_WITH_BODIES_QUERY, {
            options: { filter: { toolName: { eq: 'shop_ping' } }, take: 1 },
        });
        expect(result.errors).toBeUndefined();
        const row = result.data.mcpToolCallLogs.items[0];
        expect(row.toolName).toBe('shop_ping');
        expect(row.input).not.toBeNull();
        expect(row.output).not.toBeNull();
        expect(row.input).toMatchObject({ text: 'jane.doe@example.com' });
        expect(row.output).toMatchObject({ text: 'jane.doe@example.com' });
        // captureClientIp is on for this describe, so the caller's (loopback) address is stored.
        expect(typeof row.clientIp).toBe('string');
        expect(row.clientIp.length).toBeGreaterThan(0);
    });

    it('an HTTP tool call stores a non-empty clientIp when captureClientIp is enabled', async () => {
        const row = await logRow('shop_ping');
        // Loopback in CI/local test runs, e.g. '::1' or '127.0.0.1' — just assert it's captured.
        expect(typeof row.clientIp).toBe('string');
        expect(row.clientIp?.length).toBeGreaterThan(0);
    });
});
