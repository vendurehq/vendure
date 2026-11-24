import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/server';
import { LOCAL_TRUST_SECRET_ENV_VAR } from '@vendure/common/lib/local-trust';
import {
    AuthenticatedSession,
    ConfigService,
    ID,
    mergeConfig,
    TransactionalConnection,
    User,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { McpToolCallLog } from '../src/entities/mcp-tool-call-log.entity';
import { LOCAL_TRUST_SESSION_STRATEGY } from '../src/local-trust/local-trust.service';
import { McpPlugin } from '../src/plugin';
import { McpPluginOptions } from '../src/types';

import { MCP_TOOL_CALL_LOGS_WITH_BODIES_QUERY } from './graphql/mcp-documents';
import {
    createLocalTrustProject,
    postAdminApi,
    postRaw,
    startAsDevServer,
} from './utils/local-trust-fixtures';
import { callTool, consentDigestOf, MCP_ACCEPT, postMcp, rpc, withConsent } from './utils/mcp-http-client';
import { runAuthorizationCodeFlow } from './utils/oauth-test-client';
import { getIdStrategy, testServerInit } from './utils/test-server';

const TOKEN_SECRET = 'local-trust-secret-000000000000000000000000';
// The CLI's format: 32 random bytes as base64url.
const SECRET = randomBytes(32).toString('base64url');
const ME_QUERY = '{ me { identifier } }';

/**
 * A server started the way `vendure dev` starts one: the secret in its environment and the state
 * file in its project directory. It runs in discovery mode with OAuth on, so the same server shows
 * that a local-trust caller sees every tool while an OAuth caller sees only the meta-tools.
 */
describe('Local trust on a dev server the CLI started', () => {
    const options: McpPluginOptions = {
        oauth: { tokenSecret: TOKEN_SECRET },
        toolExposure: 'discovery',
        logging: { capture: 'full' },
        rateLimits: { oauthIp: false },
    };
    const config = mergeConfig(testConfig(), { plugins: [McpPlugin.init(options)] });
    const { server, adminClient } = createTestEnvironment(config);
    const port = config.apiOptions.port;
    const baseUrl = `http://localhost:${port}`;
    const adminApiUrl = `${baseUrl}/${config.apiOptions.adminApiPath}`;
    const project = createLocalTrustProject({ secret: SECRET });
    const asLocal = { token: SECRET };

    let superAdminToken: string;
    let superadminUserId: ID;

    beforeAll(async () => {
        McpPlugin.init(options);
        await startAsDevServer(() => server.init(testServerInit), {
            projectDir: project.projectDir,
            secret: SECRET,
        });
        await adminClient.asSuperAdmin();
        superAdminToken = adminClient.getAuthToken();
        const { identifier } = server.app.get(ConfigService).authOptions.superadminCredentials;
        const user = await server.app
            .get(TransactionalConnection)
            .rawConnection.getRepository(User)
            .findOneByOrFail({ identifier });
        superadminUserId = user.id;
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
        project.remove();
    });

    async function oauthAccessToken(): Promise<string> {
        const flow = await runAuthorizationCodeFlow({ baseUrl, issuer: baseUrl, superAdminToken });
        return flow.access_token;
    }

    async function createDraftOrder(): Promise<ID> {
        const result = await adminClient.query(gql`
            mutation {
                createDraftOrder {
                    id
                }
            }
        `);
        return getIdStrategy(server.app.get(ConfigService)).decodeId(result.createDraftOrder.id);
    }

    function toolNames(result: { body: any }): string[] {
        return (result.body.result.tools as Array<{ name: string }>).map(tool => tool.name);
    }

    it('removes the secret from the environment once it has read it', () => {
        expect(process.env[LOCAL_TRUST_SECRET_ENV_VAR]).toBeUndefined();
    });

    describe('POST /mcp/admin', () => {
        // The Developer MCP proxies each tool by name, so the meta-tools of discovery mode would not do.
        it('lists every admin tool for the local agent, even in discovery mode', async () => {
            const listed = await postMcp(baseUrl, 'admin', rpc('tools/list'), asLocal);
            expect(listed.status).toBe(200);
            const names = toolNames(listed);
            expect(names).toEqual(expect.arrayContaining(['cancel_order', 'list_channels', 'list_orders']));
            expect(names).not.toContain('search_tools');
            expect(names).not.toContain('execute_tool');
        });

        it('still lists only the meta-tools for an OAuth caller on the same server', async () => {
            const listed = await postMcp(baseUrl, 'admin', rpc('tools/list'), {
                token: await oauthAccessToken(),
            });
            expect(toolNames(listed).sort()).toEqual(['execute_tool', 'search_tools']);
        });

        it('advertises no output schema for a destructive tool', async () => {
            const listed = await postMcp(baseUrl, 'admin', rpc('tools/list'), asLocal);
            const cancelOrder = (listed.body.result.tools as any[]).find(
                tool => tool.name === 'cancel_order',
            );
            expect(cancelOrder.annotations.destructiveHint).toBe(true);
            expect(cancelOrder.outputSchema).toBeUndefined();
        });

        it('calls a tool directly by name', async () => {
            const result = await postMcp(baseUrl, 'admin', callTool('list_channels'), asLocal);
            expect(result.body.result.isError).toBeUndefined();
            expect(result.body.result.structuredContent.items.length).toBeGreaterThan(0);
        });

        // The server listens on every address, so an IPv4 client arrives as ::ffff:127.0.0.1.
        it('accepts the secret from 127.0.0.1 on a dual-stack listener', async () => {
            const result = await postMcp(`http://127.0.0.1:${port}`, 'admin', rpc('tools/list'), asLocal);
            expect(result.status).toBe(200);
        });

        it('accepts the secret from ::1', async context => {
            let result;
            try {
                result = await postMcp(`http://[::1]:${port}`, 'admin', rpc('tools/list'), asLocal);
            } catch {
                // Some CI machines have no IPv6 loopback.
                context.skip();
                return;
            }
            expect(result.status).toBe(200);
        });

        it('refuses the secret on a request that carries an Origin, as a browser page would send', async () => {
            const result = await postMcp(baseUrl, 'admin', rpc('tools/list'), {
                ...asLocal,
                headers: { Origin: baseUrl },
            });
            expect(result.status).toBe(401);
        });

        it('refuses the secret on a request that came through a proxy', async () => {
            const result = await postMcp(baseUrl, 'admin', rpc('tools/list'), {
                ...asLocal,
                headers: { 'X-Forwarded-For': '203.0.113.7' },
            });
            expect(result.status).toBe(401);
        });

        it('refuses the secret on a request naming another host, as after DNS rebinding', async () => {
            const headers = {
                Authorization: `Bearer ${SECRET}`,
                Accept: MCP_ACCEPT,
                'MCP-Protocol-Version': LATEST_PROTOCOL_VERSION,
            };
            const message = rpc('tools/list');
            const local = await postRaw(
                port,
                '/mcp/admin',
                { ...headers, Host: `localhost:${port}` },
                message,
            );
            expect(local.status).toBe(200);
            const rebound = await postRaw(
                port,
                '/mcp/admin',
                { ...headers, Host: `rebound.example.com:${port}` },
                message,
            );
            expect(rebound.status).toBe(401);
        });

        it('refuses a wrong secret', async () => {
            const result = await postMcp(baseUrl, 'admin', rpc('tools/list'), {
                token: randomBytes(32).toString('base64url'),
            });
            expect(result.status).toBe(401);
        });
    });

    // Local trust is admin-only: the shop endpoint never checks the secret.
    it('ignores the secret on /mcp/shop', async () => {
        const result = await postMcp(baseUrl, 'shop', rpc('tools/list'), asLocal);
        expect(result.status).toBe(401);
        expect(result.headers.get('www-authenticate')).toContain('error="invalid_token"');
    });

    describe('the Admin API', () => {
        it('runs a request with the secret as the superadmin', async () => {
            const { identifier } = server.app.get(ConfigService).authOptions.superadminCredentials;
            const result = await postAdminApi(adminApiUrl, ME_QUERY, { Authorization: `Bearer ${SECRET}` });
            expect(result.body.errors).toBeUndefined();
            expect(result.body.data.me.identifier).toBe(identifier);
        });

        it('uses one session for the whole run', async () => {
            await postAdminApi(adminApiUrl, ME_QUERY, { Authorization: `Bearer ${SECRET}` });
            await postAdminApi(adminApiUrl, ME_QUERY, { Authorization: `Bearer ${SECRET}` });
            const sessions = await server.app
                .get(TransactionalConnection)
                .rawConnection.getRepository(AuthenticatedSession)
                .countBy({ authenticationStrategy: LOCAL_TRUST_SESSION_STRATEGY });
            expect(sessions).toBe(1);
        });

        it('treats a wrong secret as an anonymous request', async () => {
            const result = await postAdminApi(adminApiUrl, ME_QUERY, {
                Authorization: `Bearer ${randomBytes(32).toString('base64url')}`,
            });
            expect(result.body.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
        });

        it('treats the secret from a browser page as an anonymous request', async () => {
            const result = await postAdminApi(adminApiUrl, ME_QUERY, {
                Authorization: `Bearer ${SECRET}`,
                Origin: baseUrl,
            });
            expect(result.body.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
        });
    });

    describe('destructive tools', () => {
        it('returns an incomplete result, and runs only with the digest it carries', async () => {
            const orderId = await createDraftOrder();
            const call = (args: Record<string, unknown>, id: number) =>
                postMcp(baseUrl, 'admin', callTool('cancel_order', { id: orderId, ...args }, id), asLocal);

            const preview = await call({}, 1);
            expect(preview.body.result.isError).toBeUndefined();
            expect(preview.body.result.structuredContent).toMatchObject({
                status: 'incomplete',
                preview: expect.stringContaining(`(id ${String(orderId)}, state Draft`),
                needs: [{ kind: 'consent', consent: 'confirm', digest: expect.any(String) }],
            });

            const legacy = await call({ confirm: true }, 2);
            expect(legacy.body.result.isError).toBe(true);
            expect(legacy.body.result.content[0].text).toMatch(/"confirm" must be the consent digest/);

            const stale = await call({ confirm: `${consentDigestOf(preview)}x` }, 3);
            expect(stale.body.result.structuredContent.status).toBe('incomplete');

            const confirmed = await call({ confirm: consentDigestOf(preview) }, 4);
            // The empty draft has no lines to cancel, which proves the tool itself ran.
            expect(confirmed.body.result.structuredContent).toMatchObject({
                errorCode: 'EMPTY_ORDER_LINE_SELECTION_ERROR',
            });
        });

        it('does not accept a digest issued to another caller', async () => {
            const orderId = await createDraftOrder();
            const message = callTool('cancel_order', { id: orderId }, 1);
            const oauth = { token: await oauthAccessToken() };
            // The OAuth caller reaches the tool through execute_tool, since the server is in discovery mode.
            const oauthPreview = await postMcp(
                baseUrl,
                'admin',
                callTool('execute_tool', { name: 'cancel_order', arguments: { id: orderId } }, 1),
                oauth,
            );
            const digest = consentDigestOf(oauthPreview);
            expect(digest).toBeDefined();

            const asLocalWithOauthDigest = await postMcp(
                baseUrl,
                'admin',
                withConsent(message, digest ?? ''),
                asLocal,
            );
            expect(asLocalWithOauthDigest.body.result.structuredContent.status).toBe('incomplete');
        });
    });

    describe('set_active_channel', () => {
        it('returns the channel token for the caller to send, and keeps no state on the server', async () => {
            const channels = await postMcp(baseUrl, 'admin', callTool('list_channels'), asLocal);
            const channel = channels.body.result.structuredContent.items[0];
            const preview = await postMcp(
                baseUrl,
                'admin',
                callTool('set_active_channel', { channelToken: channel.token }, 1),
                asLocal,
            );
            expect(preview.body.result.structuredContent.preview).toContain(
                'for the calls that send its token',
            );

            const switched = await postMcp(
                baseUrl,
                'admin',
                withConsent(
                    callTool('set_active_channel', { channelToken: channel.token }, 2),
                    consentDigestOf(preview) ?? '',
                ),
                asLocal,
            );
            expect(switched.body.result.isError).toBeUndefined();
            expect(switched.body.result.structuredContent).toEqual({
                channel: { id: channel.id, code: channel.code, token: channel.token },
                channelToken: channel.token,
                channelTokenHeader: 'vendure-token',
            });
        });

        it('acts on the channel the channel token header names, for that call only', async () => {
            const created = await adminClient.query(
                gql`
                    mutation CreateChannel($input: CreateChannelInput!) {
                        createChannel(input: $input) {
                            ... on Channel {
                                id
                                token
                            }
                        }
                    }
                `,
                {
                    input: {
                        code: 'local-trust-second',
                        token: 'local-trust-second-token',
                        defaultLanguageCode: 'en',
                        defaultCurrencyCode: 'USD',
                        pricesIncludeTax: false,
                        defaultShippingZoneId: 'T_1',
                        defaultTaxZoneId: 'T_1',
                    },
                },
            );
            const secondChannelId = getIdStrategy(server.app.get(ConfigService)).decodeId(
                created.createChannel.id,
            );
            const repository = server.app
                .get(TransactionalConnection)
                .rawConnection.getRepository(McpToolCallLog);
            const channelOfLastCall = async () =>
                (await repository.find({ order: { id: 'DESC' }, take: 1 }))[0].channelId;

            await postMcp(baseUrl, 'admin', callTool('list_channels', {}, 1), {
                ...asLocal,
                headers: { [config.apiOptions.channelTokenKey]: created.createChannel.token },
            });
            expect(String(await channelOfLastCall())).toBe(String(secondChannelId));

            await postMcp(baseUrl, 'admin', callTool('list_channels', {}, 2), asLocal);
            expect(String(await channelOfLastCall())).not.toBe(String(secondChannelId));
        });

        // The Developer MCP clears its active channel when the server refuses the token with this
        // message (packages/cli/src/command-host/mcp/admin-proxy.ts), so a reword must change both.
        // With one channel, core falls back to it for any token; the test above adds a second.
        it('refuses an unknown channel token with a 400 that names the sales channel', async () => {
            const refused = await postMcp(baseUrl, 'admin', callTool('list_channels'), {
                ...asLocal,
                headers: { 'vendure-token': 'no-such-channel-token' },
            });
            expect(refused.status).toBe(400);
            expect(refused.body.message).toMatch(/sales channel/);
        });
    });

    describe('the tool-call log', () => {
        it('records a local-trust call as the local agent, with no grant and no secret', async () => {
            await postMcp(baseUrl, 'admin', callTool('list_channels', {}, 77), asLocal);
            const rows = await server.app
                .get(TransactionalConnection)
                .rawConnection.getRepository(McpToolCallLog)
                .find({ where: { toolName: 'list_channels', actorType: 'local' } });
            expect(rows.length).toBeGreaterThan(0);
            for (const row of rows) {
                expect(row.grantId).toBeNull();
                expect(row.oauthClientId).toBeNull();
                expect(String(row.actor)).toBe(String(superadminUserId));
                expect(JSON.stringify(row)).not.toContain(SECRET);
            }
        });

        // The Admin API returns actorType as an enum, so an unknown value would fail the whole list.
        it('lists the call in the Admin API as the local agent', async () => {
            const result = await adminClient.query(gql(MCP_TOOL_CALL_LOGS_WITH_BODIES_QUERY), {
                options: { filter: { actorType: { eq: 'local' } } },
            });
            const items = result.mcpToolCallLogs.items as Array<{ actorType: string; actorName: string }>;
            expect(items.length).toBeGreaterThan(0);
            expect(items.every(item => item.actorType === 'local' && item.actorName === 'Local agent')).toBe(
                true,
            );
        });
    });
});
