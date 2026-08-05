import {
    EventBus,
    mergeConfig,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { firstValueFrom } from 'rxjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { McpToolCallLog } from '../src/entities/mcp-tool-call-log.entity';
import { McpToolCallEvent } from '../src/events/mcp-tool-call.event';
import { McpPlugin } from '../src/plugin';
import { McpPluginOptions } from '../src/types';

import { McpTestToolsPlugin } from './fixtures/mcp-test-tools';
import { postMcp, rpc } from './utils/mcp-http-client';
import { runAuthorizationCodeFlow } from './utils/oauth-test-client';

const TOKEN_SECRET = 'logging-secret-000000000000000000000000000';
const ISSUER = `http://localhost:${testConfig().apiOptions.port}`;
const productsCsvPath = path.join(__dirname, 'fixtures/e2e-products.csv');

const callTool = (name: string, args: Record<string, unknown> = {}, id = 1) =>
    rpc('tools/call', { name, arguments: args }, id);

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
        await server.init({ initialData, productsCsvPath, customerCount: 1 });
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
        // channelId must be set — Phase 7's per-channel stats depend on it.
        expect(row.channelId).not.toBeNull();
        expect(typeof row.pluginSource).toBe('string');
        expect(typeof row.durationMs).toBe('number');
        // Default 'metadata' capture: request/response bodies are not persisted, so no call PII is stored.
        expect(row.input).toBeNull();
        expect(row.output).toBeNull();
    });

    it('persists an error row and publishes the event when a tool throws', async () => {
        const eventPromise = firstValueFrom(eventBus.ofType(McpToolCallEvent));
        const response = await postMcp(baseUrl(), 'shop', callTool('shop_boom', {}, 2));
        expect(response.body.result.isError).toBe(true);
        expect(response.body.result.content[0].text).toMatch(/boom/);

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
        expect(row.channelId).not.toBeNull();
    });
});
