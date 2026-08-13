import {
    ID,
    mergeConfig,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import {
    MCP_OAUTH_GRANTS_QUERY,
    MCP_STATS_QUERY,
    MCP_TOOL_CALL_LOGS_QUERY,
    MCP_TOOLS_QUERY,
    REVOKE_MCP_OAUTH_GRANT,
    SET_MCP_TOOL_ENABLED,
} from '../src/dashboard/queries';
import { McpOauthGrant } from '../src/entities/mcp-oauth-grant.entity';
import { McpToolCallLog } from '../src/entities/mcp-tool-call-log.entity';
import { McpPlugin } from '../src/plugin';
import { McpPluginOptions } from '../src/types';

import { McpTestToolsPlugin } from './fixtures/mcp-test-tools';
import { MCP_TOOL_CALL_LOGS_WITH_BODIES_QUERY } from './graphql/admin-definitions';
import { provisionAdmin } from './utils/admin-fixtures';
import { backdateLogCreatedAt } from './utils/log-fixtures';
import { postMcp, rpc } from './utils/mcp-http-client';
import { runAuthorizationCodeFlow } from './utils/oauth-test-client';
import { initTestServer } from './utils/test-server';

const TOKEN_SECRET = 'admin-api-secret-00000000000000000000000';
const ISSUER = `http://localhost:${testConfig().apiOptions.port}`;
const DAY_MS = 86_400_000;

const REMOVE_EXPIRED_LOGS = `
    mutation {
        removeExpiredMcpToolCallLogs
    }
`;

interface GraphQLResponse<T = any> {
    data?: T;
    errors?: Array<{ message: string; extensions?: { code?: string } }>;
}

describe('MCP admin API', () => {
    const pluginOptions: McpPluginOptions = {
        oauth: { tokenSecret: TOKEN_SECRET },
        logging: { ttlDays: 30 },
    };
    const config = mergeConfig(testConfig(), {
        plugins: [McpTestToolsPlugin, McpPlugin.init(pluginOptions)],
    });
    const { server, adminClient } = createTestEnvironment(config);
    const baseUrl = () => `http://localhost:${config.apiOptions.port}`;
    const adminApiUrl = () => `${baseUrl()}/${config.apiOptions.adminApiPath ?? 'admin-api'}`;

    let connection: TransactionalConnection;
    let adminCtx: RequestContext;
    let superAdminToken: string;
    let readOnlyToken: string;
    let updateOnlyToken: string;
    let settingsOnlyToken: string;
    let defaultChannelGqlId: string;

    /** Runs a GraphQL request against the admin API as the given token. */
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

    /**
     * Inserts a tool-call log row, defaulting to the active channel. Pass `channelId` to
     * plant a row on another channel (isolation tests). Optionally backdates createdAt.
     */
    async function insertLog(fields: {
        toolName: string;
        status: 'success' | 'error';
        durationMs: number | null;
        ageMs?: number;
        channelId?: ID;
    }): Promise<void> {
        const repo = connection.getRepository(adminCtx, McpToolCallLog);
        const row = await repo.save(
            repo.create({
                toolName: fields.toolName,
                actorType: 'admin',
                status: fields.status,
                durationMs: fields.durationMs,
                channelId: fields.channelId ?? adminCtx.channelId,
            }),
        );
        if (fields.ageMs) {
            const createdAt = new Date(Date.now() - fields.ageMs);
            await backdateLogCreatedAt(connection, adminCtx, row.id, createdAt);
        }
    }

    beforeAll(async () => {
        McpPlugin.init(pluginOptions);
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

        const adminApi = { adminClient, adminApiUrl: adminApiUrl(), channelId: defaultChannelGqlId };
        readOnlyToken = await provisionAdmin(adminApi, 'mcp-read-only', ['ReadMcpServer']);
        updateOnlyToken = await provisionAdmin(adminApi, 'mcp-update-only', ['UpdateMcpServer']);
        settingsOnlyToken = await provisionAdmin(adminApi, 'mcp-settings-only', [
            'ReadSettings',
            'UpdateSettings',
        ]);
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    describe('tool-call logs & stats', () => {
        beforeAll(async () => {
            // Fixed fixture: 5 recent rows + 1 expired, all on the default channel.
            // Durations 10..50 give p50 = 30 and p95 = 40.
            await connection.getRepository(adminCtx, McpToolCallLog).createQueryBuilder().delete().execute();
            await insertLog({ toolName: 'stats_tool_a', status: 'success', durationMs: 10 });
            await insertLog({ toolName: 'stats_tool_a', status: 'success', durationMs: 20 });
            await insertLog({ toolName: 'stats_tool_a', status: 'success', durationMs: 30 });
            await insertLog({ toolName: 'stats_tool_b', status: 'success', durationMs: 40 });
            await insertLog({ toolName: 'stats_tool_b', status: 'error', durationMs: 50 });
            await insertLog({
                toolName: 'stats_tool_old',
                status: 'success',
                durationMs: 999,
                ageMs: 40 * DAY_MS,
            });
        });

        it('mcpToolCallLogs returns a { items, totalItems } paginated list with null bodies', async () => {
            const result = await adminGraphQL(superAdminToken, MCP_TOOL_CALL_LOGS_WITH_BODIES_QUERY, {
                options: { take: 50, sort: { createdAt: 'DESC' } },
            });
            expect(result.errors).toBeUndefined();
            expect(result.data.mcpToolCallLogs.totalItems).toBe(6);
            expect(Array.isArray(result.data.mcpToolCallLogs.items)).toBe(true);
            expect(result.data.mcpToolCallLogs.items.length).toBe(6);
            // With no capture configured, bodies are stored and returned as null.
            expect(result.data.mcpToolCallLogs.items[0].input).toBeNull();
            expect(result.data.mcpToolCallLogs.items[0].output).toBeNull();
        });

        it('mcpToolCallLogs honours filter options', async () => {
            const result = await adminGraphQL(superAdminToken, MCP_TOOL_CALL_LOGS_QUERY, {
                options: { filter: { status: { eq: 'error' } } },
            });
            expect(result.errors).toBeUndefined();
            expect(result.data.mcpToolCallLogs.totalItems).toBe(1);
            expect(result.data.mcpToolCallLogs.items[0].status).toBe('error');
        });

        it('mcpStats computes counts, rates, top tools and percentiles over the window', async () => {
            const result = await adminGraphQL(superAdminToken, MCP_STATS_QUERY, { timeRange: '24h' });
            expect(result.errors).toBeUndefined();
            const stats = result.data.mcpStats;
            // The expired row is outside the 24h window, so only the 5 recent rows count.
            expect(stats.totalCalls).toBe(5);
            expect(stats.successRate).toBeCloseTo(0.8, 5);
            expect(stats.errorRate).toBeCloseTo(0.2, 5);
            expect(stats.p50LatencyMs).toBe(30);
            expect(stats.p95LatencyMs).toBe(40);
            expect(stats.callsPerHour).toBeCloseTo(5 / 24, 5);
            expect(stats.topTools).toEqual([
                { toolName: 'stats_tool_a', count: 3 },
                { toolName: 'stats_tool_b', count: 2 },
            ]);
        });

        it('mcpStats serves a cached result within the TTL window', async () => {
            const first = await adminGraphQL(superAdminToken, MCP_STATS_QUERY, { timeRange: '7d' });
            const firstTotal = first.data.mcpStats.totalCalls;
            // A new row would change the count if the result weren't cached.
            await insertLog({ toolName: 'stats_tool_a', status: 'success', durationMs: 15 });
            const second = await adminGraphQL(superAdminToken, MCP_STATS_QUERY, { timeRange: '7d' });
            expect(second.data.mcpStats.totalCalls).toBe(firstTotal);
        });

        it('mcpStats rejects an unknown timeRange', async () => {
            const result = await adminGraphQL(superAdminToken, MCP_STATS_QUERY, { timeRange: 'bogus' });
            expect(result.errors).toBeDefined();
            expect(result.errors?.length ?? 0).toBeGreaterThan(0);
            expect(result.data?.mcpStats ?? null).toBeNull();
        });

        it('removeExpiredMcpToolCallLogs deletes only expired rows and returns the count', async () => {
            const result = await adminGraphQL<{ removeExpiredMcpToolCallLogs: number }>(
                superAdminToken,
                REMOVE_EXPIRED_LOGS,
            );
            expect(result.errors).toBeUndefined();
            expect(result.data?.removeExpiredMcpToolCallLogs).toBe(1);

            const remaining = await connection.getRepository(adminCtx, McpToolCallLog).find();
            const names = remaining.map(r => r.toolName);
            expect(names).not.toContain('stats_tool_old');
            expect(names).toContain('stats_tool_a');
        });
    });

    describe('permission matrix', () => {
        it('SuperAdmin can read and mutate', async () => {
            const read = await adminGraphQL(superAdminToken, MCP_TOOLS_QUERY);
            expect(read.errors).toBeUndefined();
            expect(Array.isArray(read.data.mcpTools)).toBe(true);

            const mutate = await adminGraphQL(superAdminToken, SET_MCP_TOOL_ENABLED, {
                toolName: 'admin_list',
                toolset: 'admin',
                enabled: true,
            });
            expect(mutate.errors).toBeUndefined();
            expect(mutate.data.setMcpToolEnabled).toMatchObject({ name: 'admin_list', enabled: true });
        });

        it('ReadMcpServer-only can read but not mutate', async () => {
            const read = await adminGraphQL(readOnlyToken, MCP_TOOLS_QUERY);
            expect(read.errors).toBeUndefined();
            expect(Array.isArray(read.data.mcpTools)).toBe(true);

            const mutate = await adminGraphQL(readOnlyToken, SET_MCP_TOOL_ENABLED, {
                toolName: 'admin_list',
                toolset: 'admin',
                enabled: false,
            });
            expect(mutate.errors).toBeDefined();
            expect(mutate.data?.setMcpToolEnabled ?? null).toBeNull();
        });

        it('UpdateMcpServer-only can mutate but not read', async () => {
            const mutate = await adminGraphQL(updateOnlyToken, SET_MCP_TOOL_ENABLED, {
                toolName: 'admin_list',
                toolset: 'admin',
                enabled: true,
            });
            expect(mutate.errors).toBeUndefined();
            expect(mutate.data.setMcpToolEnabled).toMatchObject({ name: 'admin_list', enabled: true });

            const read = await adminGraphQL(updateOnlyToken, MCP_TOOLS_QUERY);
            expect(read.errors).toBeDefined();
            expect(read.data?.mcpTools ?? null).toBeNull();
        });

        it('a settings-only admin is rejected from the MCP admin API', async () => {
            const read = await adminGraphQL(settingsOnlyToken, MCP_TOOLS_QUERY);
            expect(read.errors).toBeDefined();
            expect(read.data?.mcpTools ?? null).toBeNull();

            const mutate = await adminGraphQL(settingsOnlyToken, SET_MCP_TOOL_ENABLED, {
                toolName: 'admin_list',
                toolset: 'admin',
                enabled: false,
            });
            expect(mutate.errors).toBeDefined();
            expect(mutate.data?.setMcpToolEnabled ?? null).toBeNull();
        });
    });

    describe('tool registry & toggle (TOCTOU)', () => {
        it('mcpTools reports the registry with per-tool enabled state', async () => {
            const result = await adminGraphQL(superAdminToken, MCP_TOOLS_QUERY);
            expect(result.errors).toBeUndefined();
            const adminList = (
                result.data.mcpTools as Array<{ name: string; toolset: string; enabled: boolean }>
            ).find(t => t.name === 'admin_list' && t.toolset === 'admin');
            expect(adminList).toBeDefined();
            expect(typeof adminList?.enabled).toBe('boolean');
        });

        it('disabling a tool in the admin API removes it from the protocol list and rejects calls', async () => {
            const { access_token } = await runAuthorizationCodeFlow({
                baseUrl: baseUrl(),
                issuer: ISSUER,
                superAdminToken,
            });

            const before = await postMcp(baseUrl(), 'admin', rpc('tools/list', {}, 1), {
                token: access_token,
            });
            const namesBefore = (before.body.result.tools as Array<{ name: string }>).map(t => t.name);
            expect(namesBefore).toContain('admin_list');

            const toggled = await adminGraphQL(superAdminToken, SET_MCP_TOOL_ENABLED, {
                toolName: 'admin_list',
                toolset: 'admin',
                enabled: false,
            });
            expect(toggled.errors).toBeUndefined();
            expect(toggled.data.setMcpToolEnabled).toMatchObject({ name: 'admin_list', enabled: false });

            const after = await postMcp(baseUrl(), 'admin', rpc('tools/list', {}, 2), {
                token: access_token,
            });
            const namesAfter = (after.body.result.tools as Array<{ name: string }>).map(t => t.name);
            expect(namesAfter).not.toContain('admin_list');

            // A disabled tool isn't offered, so calling it is rejected by the protocol.
            const denied = await postMcp(
                baseUrl(),
                'admin',
                rpc('tools/call', { name: 'admin_list', arguments: {} }, 3),
                { token: access_token },
            );
            expect(denied.body.error).toBeDefined();
            expect(denied.body.result).toBeUndefined();

            // Re-enable it for later tests.
            await adminGraphQL(superAdminToken, SET_MCP_TOOL_ENABLED, {
                toolName: 'admin_list',
                toolset: 'admin',
                enabled: true,
            });
        });
    });

    describe('oauth grants', () => {
        it('lists live grants, revokes one, hides it, and then rejects the bearer token', async () => {
            const idsBefore = new Set(
                (
                    await adminGraphQL(superAdminToken, MCP_OAUTH_GRANTS_QUERY, { includeInactive: false })
                ).data.mcpOauthGrants.items.map((g: { id: string }) => g.id),
            );

            const { access_token } = await runAuthorizationCodeFlow({
                baseUrl: baseUrl(),
                issuer: ISSUER,
                superAdminToken,
            });

            const listed = await adminGraphQL(superAdminToken, MCP_OAUTH_GRANTS_QUERY, {
                includeInactive: false,
            });
            expect(listed.errors).toBeUndefined();
            const newGrants = (
                listed.data.mcpOauthGrants.items as Array<{ id: string; actorType: string }>
            ).filter(g => !idsBefore.has(g.id));
            expect(newGrants.length).toBe(1);
            const grantId = newGrants[0].id;

            // The new grant works against the transport before we revoke it.
            const okCall = await postMcp(baseUrl(), 'admin', rpc('tools/list', {}, 1), {
                token: access_token,
            });
            expect(okCall.status).toBe(200);

            const revoked = await adminGraphQL(superAdminToken, REVOKE_MCP_OAUTH_GRANT, { id: grantId });
            expect(revoked.errors).toBeUndefined();
            expect(revoked.data.revokeMcpOauthGrant).toBe(true);

            const afterRevoke = await adminGraphQL(superAdminToken, MCP_OAUTH_GRANTS_QUERY, {
                includeInactive: false,
            });
            const afterIds = (afterRevoke.data.mcpOauthGrants.items as Array<{ id: string }>).map(g => g.id);
            expect(afterIds).not.toContain(grantId);

            // After revoking, the token no longer authenticates (401).
            const deniedCall = await postMcp(baseUrl(), 'admin', rpc('tools/list', {}, 2), {
                token: access_token,
            });
            expect(deniedCall.status).toBe(401);
        });

        it('includeInactive surfaces a revoked grant with its revokedAt, while includeInactive: false omits it', async () => {
            const clientName = `inactive-toggle-client-${Math.random().toString(36).slice(2)}`;
            await runAuthorizationCodeFlow({
                baseUrl: baseUrl(),
                issuer: ISSUER,
                superAdminToken,
                clientName,
            });

            const beforeRevoke = await adminGraphQL(superAdminToken, MCP_OAUTH_GRANTS_QUERY, {
                includeInactive: true,
            });
            const created = (
                beforeRevoke.data.mcpOauthGrants.items as Array<{
                    id: string;
                    oauthClientName: string | null;
                    revokedAt: string | null;
                }>
            ).find(g => g.oauthClientName === clientName);
            expect(created).toBeDefined();
            expect(created?.revokedAt).toBeNull();
            const grantId = created?.id;

            const revoked = await adminGraphQL(superAdminToken, REVOKE_MCP_OAUTH_GRANT, { id: grantId });
            expect(revoked.errors).toBeUndefined();
            expect(revoked.data.revokeMcpOauthGrant).toBe(true);

            // Listing with includeInactive: false still hides it.
            const defaultListed = await adminGraphQL(superAdminToken, MCP_OAUTH_GRANTS_QUERY, {
                includeInactive: false,
            });
            const stillVisibleByDefault = (
                defaultListed.data.mcpOauthGrants.items as Array<{ oauthClientName: string | null }>
            ).some(g => g.oauthClientName === clientName);
            expect(stillVisibleByDefault).toBe(false);

            // Asking for inactive grants surfaces it, with a non-null revokedAt.
            const afterRevoke = await adminGraphQL(superAdminToken, MCP_OAUTH_GRANTS_QUERY, {
                includeInactive: true,
            });
            const revokedGrant = (
                afterRevoke.data.mcpOauthGrants.items as Array<{
                    id: string;
                    oauthClientName: string | null;
                    revokedAt: string | null;
                }>
            ).find(g => g.oauthClientName === clientName);
            expect(revokedGrant).toBeDefined();
            expect(revokedGrant?.id).toBe(grantId);
            expect(revokedGrant?.revokedAt).not.toBeNull();
            expect(typeof revokedGrant?.revokedAt).toBe('string');
        });

        it('paginates with skip and take while totalItems counts the full set', async () => {
            // Two fresh grants guarantee at least two rows regardless of what ran before.
            await runAuthorizationCodeFlow({ baseUrl: baseUrl(), issuer: ISSUER, superAdminToken });
            await runAuthorizationCodeFlow({ baseUrl: baseUrl(), issuer: ISSUER, superAdminToken });

            const all = await adminGraphQL(superAdminToken, MCP_OAUTH_GRANTS_QUERY, {
                includeInactive: true,
            });
            expect(all.errors).toBeUndefined();
            const totalItems = all.data.mcpOauthGrants.totalItems as number;
            expect(totalItems).toBeGreaterThanOrEqual(2);

            const firstPage = await adminGraphQL(superAdminToken, MCP_OAUTH_GRANTS_QUERY, {
                includeInactive: true,
                options: { take: 1 },
            });
            expect(firstPage.data.mcpOauthGrants.items).toHaveLength(1);
            expect(firstPage.data.mcpOauthGrants.totalItems).toBe(totalItems);

            const secondPage = await adminGraphQL(superAdminToken, MCP_OAUTH_GRANTS_QUERY, {
                includeInactive: true,
                options: { skip: 1, take: 1 },
            });
            expect(secondPage.data.mcpOauthGrants.items).toHaveLength(1);
            expect(secondPage.data.mcpOauthGrants.items[0].id).not.toBe(
                firstPage.data.mcpOauthGrants.items[0].id,
            );
        });
    });

    // A restricted admin operating on their own channel must not reach another channel's
    // audit log, grants, or prune. McpToolCallLog.channelId / McpOauthGrant.channelId are
    // plain id columns (no FK to Channel), so an unused id models "another channel" here —
    // the scoping is symmetric in channelId, so proving default-vs-foreign proves B-vs-A.
    describe('channel isolation', () => {
        const FOREIGN_CHANNEL_ID = '999999';

        beforeAll(async () => {
            await connection.getRepository(adminCtx, McpToolCallLog).createQueryBuilder().delete().execute();
            // Recent + expired rows on the active channel and on a foreign channel.
            await insertLog({ toolName: 'iso_local', status: 'success', durationMs: 5 });
            await insertLog({
                toolName: 'iso_local_old',
                status: 'success',
                durationMs: 5,
                ageMs: 40 * DAY_MS,
            });
            await insertLog({
                toolName: 'iso_foreign',
                status: 'success',
                durationMs: 5,
                channelId: FOREIGN_CHANNEL_ID,
            });
            await insertLog({
                toolName: 'iso_foreign_old',
                status: 'success',
                durationMs: 5,
                ageMs: 40 * DAY_MS,
                channelId: FOREIGN_CHANNEL_ID,
            });
        });

        it("mcpToolCallLogs hides another channel's rows (F1)", async () => {
            const result = await adminGraphQL(superAdminToken, MCP_TOOL_CALL_LOGS_WITH_BODIES_QUERY, {
                options: { take: 100 },
            });
            expect(result.errors).toBeUndefined();
            const names = (result.data.mcpToolCallLogs.items as Array<{ toolName: string }>).map(
                r => r.toolName,
            );
            expect(names).toContain('iso_local');
            expect(names).not.toContain('iso_foreign');
            const channelIds = (result.data.mcpToolCallLogs.items as Array<{ channelId: string | null }>).map(
                r => r.channelId,
            );
            expect(channelIds).not.toContain(FOREIGN_CHANNEL_ID);
        });

        it('removeExpiredMcpToolCallLogs prunes only the active channel (F4)', async () => {
            const result = await adminGraphQL<{ removeExpiredMcpToolCallLogs: number }>(
                superAdminToken,
                REMOVE_EXPIRED_LOGS,
            );
            expect(result.errors).toBeUndefined();
            // Only the active channel's one expired row is pruned; the foreign one survives.
            expect(result.data?.removeExpiredMcpToolCallLogs).toBe(1);
            const remaining = await connection.getRepository(adminCtx, McpToolCallLog).find();
            const names = remaining.map(r => r.toolName);
            expect(names).not.toContain('iso_local_old');
            expect(names).toContain('iso_foreign_old');
        });

        it("mcpOauthGrants and revoke ignore another channel's grants (F2/F3)", async () => {
            // Identify the grant by a unique client name rather than its id — the API
            // returns encoded ids (`T_3`) that don't match the raw DB id a repo update needs.
            const clientName = `iso-foreign-client-${Math.random().toString(36).slice(2)}`;
            await runAuthorizationCodeFlow({
                baseUrl: baseUrl(),
                issuer: ISSUER,
                superAdminToken,
                clientName,
            });

            // A fresh admin grant is channel-less (global), so it starts out visible.
            const listed = await adminGraphQL(superAdminToken, MCP_OAUTH_GRANTS_QUERY, {
                includeInactive: false,
            });
            const created = (
                listed.data.mcpOauthGrants.items as Array<{ id: string; oauthClientName: string | null }>
            ).find(g => g.oauthClientName === clientName);
            expect(created).toBeDefined();
            const grantId = created?.id;

            // Move it to a foreign channel via the raw row (matched by client name).
            const raw = await connection
                .getRepository(adminCtx, McpOauthGrant)
                .createQueryBuilder('grant')
                .innerJoin('grant.oauthClient', 'client')
                .where('client.clientName = :clientName', { clientName })
                .getOne();
            expect(raw).not.toBeNull();
            await connection
                .getRepository(adminCtx, McpOauthGrant)
                .update({ id: raw?.id }, { channelId: FOREIGN_CHANNEL_ID });

            // The active-channel admin no longer sees it (F2), and revoking it reports
            // not-found rather than succeeding (F3).
            const afterMove = await adminGraphQL(superAdminToken, MCP_OAUTH_GRANTS_QUERY, {
                includeInactive: false,
            });
            const stillVisible = (
                afterMove.data.mcpOauthGrants.items as Array<{ oauthClientName: string | null }>
            ).some(g => g.oauthClientName === clientName);
            expect(stillVisible).toBe(false);

            const revoke = await adminGraphQL(superAdminToken, REVOKE_MCP_OAUTH_GRANT, { id: grantId });
            expect(revoke.errors).toBeUndefined();
            expect(revoke.data.revokeMcpOauthGrant).toBe(false);
        });
    });
});
