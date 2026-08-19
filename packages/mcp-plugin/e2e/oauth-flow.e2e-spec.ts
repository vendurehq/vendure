import { ModuleRef } from '@nestjs/core';
import {
    AdministratorService,
    ConfigService,
    Injector,
    mergeConfig,
    RequestContext,
    RequestContextService,
    RoleService,
    Session,
    SessionService,
    TransactionalConnection,
    User,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import {
    MCP_GRANT_ACTIVITY_UPDATE_INTERVAL_MS,
    MCP_UNUSED_OAUTH_CLIENT_RETENTION_MS,
    MS_PER_DAY,
} from '../src/constants';
import { McpAuthorizationCode } from '../src/entities/mcp-authorization-code.entity';
import { McpAuthorizationRequest } from '../src/entities/mcp-authorization-request.entity';
import { McpOauthClient } from '../src/entities/mcp-oauth-client.entity';
import { McpOauthGrant } from '../src/entities/mcp-oauth-grant.entity';
import { McpOauthRetentionResult, McpOauthRetentionService } from '../src/oauth/oauth-retention.service';
import { McpOauthService } from '../src/oauth/oauth.service';
import { deriveHashKey, hashLookupToken, hashToken } from '../src/oauth/token-hash';
import { McpPlugin } from '../src/plugin';
import { mcpOauthRetentionTask } from '../src/tasks/mcp-oauth-retention.task';
import { McpPluginOptions } from '../src/types';

import { expectRateLimitRefusal, postMcp, rpc } from './utils/mcp-http-client';
import { runAuthorizationCodeFlow } from './utils/oauth-test-client';
import { withFailingUpdate } from './utils/oauth-test-fixtures';
import { initTestServer } from './utils/test-server';

const TOKEN_SECRET = 'test-secret';
// The issuer the plugin derives when none is configured: localhost on the configured API port.
const ISSUER = `http://localhost:${testConfig().apiOptions.port}`;

describe('McpPlugin OAuth end-to-end flow', () => {
    // A deliberately short log retention: how long dead grants are kept is governed by
    // `oauth.grantRetentionDays`, not by how long tool-call logs are kept.
    const pluginOptions: McpPluginOptions = {
        oauth: { tokenSecret: TOKEN_SECRET },
        logging: { ttlDays: 1 },
    };
    const config = mergeConfig(testConfig(), { plugins: [McpPlugin.init(pluginOptions)] });
    const { server, adminClient } = createTestEnvironment(config);

    const hashKey = deriveHashKey(TOKEN_SECRET);
    const lookupHash = (value: string) => hashLookupToken(value, hashKey);

    let superAdminToken: string;

    beforeAll(async () => {
        // Re-apply this suite's options: McpPlugin.init writes static state, and a later suite in
        // this file calls it with its own.
        McpPlugin.init(pluginOptions);
        await initTestServer(server);
        // Logging in as superadmin yields the Vendure bearer token the admin-consent
        // step needs; it stands in for an authenticated administrator.
        await adminClient.asSuperAdmin();
        superAdminToken = adminClient.getAuthToken();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    const baseUrl = () => `http://localhost:${config.apiOptions.port}`;

    /** The grant row backing an access token the flow issued. */
    const grantFor = async (ctx: RequestContext, accessToken: string): Promise<McpOauthGrant> => {
        const grant = await server.app
            .get(TransactionalConnection)
            .getRepository(ctx, McpOauthGrant)
            .findOne({ where: { accessTokenHash: lookupHash(accessToken) } });
        if (!grant) {
            throw new Error('Expected an McpOauthGrant for the access token');
        }
        return grant;
    };

    /**
     * Creates an `McpOauthClient` row directly, bypassing the register -> authorize -> consent
     * flow, so retention tests can control `createdAt` and `lastUsedAt` precisely. `ageMs`
     * backdates `createdAt` via a follow-up `update`, since `@CreateDateColumn` would otherwise
     * stamp it with the current time on insert.
     */
    const createClient = async (
        ctx: RequestContext,
        options: { lastUsedAt?: Date | null; ageMs?: number } = {},
    ): Promise<McpOauthClient> => {
        const clientRepo = server.app.get(TransactionalConnection).getRepository(ctx, McpOauthClient);
        const uniqueSuffix = Math.random().toString(36).slice(2);
        const client = await clientRepo.save(
            new McpOauthClient({
                clientId: `retention-test-client-${uniqueSuffix}`,
                clientName: `retention-test-client-${uniqueSuffix}`,
                clientUri: null,
                logoUri: null,
                redirectUris: ['https://example.com/cb'],
                grantTypes: ['authorization_code', 'refresh_token'],
                tokenEndpointAuthMethod: 'none',
                cimdDocumentExpiresAt: null,
                lastUsedAt: options.lastUsedAt ?? null,
            }),
        );
        if (options.ageMs !== undefined) {
            await clientRepo.update({ id: client.id }, { createdAt: new Date(Date.now() - options.ageMs) });
        }
        return clientRepo.findOneByOrFail({ id: client.id });
    };

    /** The Vendure session token carried by a context that bearer auth just built. */
    const sessionTokenOf = (authenticatedCtx: RequestContext): string => {
        const token = authenticatedCtx.session?.token;
        if (!token) {
            throw new Error('Expected the authenticated context to carry a Vendure session');
        }
        return token;
    };

    /** Runs the full admin authorization-code flow and returns the resulting tokens. */
    const runFlow = () =>
        runAuthorizationCodeFlow({
            baseUrl: baseUrl(),
            issuer: ISSUER,
            superAdminToken,
        });

    // T7 — the full DCR -> authorize -> consent -> token-exchange flow yields a usable token pair.
    it('issues a non-empty access + refresh token pair through the full flow', async () => {
        const result = await runFlow();
        expect(result.access_token).toBeTruthy();
        expect(result.refresh_token).toBeTruthy();
    });

    it('authenticates the issued access token and binds the granting user', async () => {
        const oauth = server.app.get(McpOauthService);
        const connection = server.app.get(TransactionalConnection);
        const requestContextService = server.app.get(RequestContextService);
        const ctx = await requestContextService.create({ apiType: 'admin' });

        const { access_token } = await runFlow();
        const authenticated = await oauth.authenticateBearerToken(access_token, 'admin');

        // The resolved context and stored token both bind to the superadmin who approved consent.
        const superadmin = await connection
            .getRepository(ctx, User)
            .findOne({ where: { identifier: 'superadmin' } });
        if (!superadmin) {
            throw new Error('Expected a seeded superadmin user');
        }
        expect(authenticated.ctx.activeUserId).toBe(superadmin.id);
        expect(authenticated.grant.actorId).toBe(superadmin.id);
    });

    // The grant's Vendure session is an ordinary Core session: a 32-byte random token
    // (64 hex chars), with no relationship to the OAuth access token that reaches it.
    it('creates an ordinary random Vendure session token for a grant', async () => {
        const connection = server.app.get(TransactionalConnection);
        const ctx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
        const { access_token } = await runFlow();
        const grant = await grantFor(ctx, access_token);
        const session = await connection
            .getRepository(ctx, Session)
            .findOneByOrFail({ id: grant.vendureSessionId });

        expect(session.token).toHaveLength(64);
        expect(session.token).not.toBe(hashToken(access_token, hashKey));
    });

    it('stores the access token hashed, never in plaintext', async () => {
        const connection = server.app.get(TransactionalConnection);
        const requestContextService = server.app.get(RequestContextService);
        const ctx = await requestContextService.create({ apiType: 'admin' });

        const { access_token } = await runFlow();

        // The stored grant row is keyed by the lookup hash, not the plaintext.
        const stored = await connection
            .getRepository(ctx, McpOauthGrant)
            .findOne({ where: { accessTokenHash: lookupHash(access_token) } });
        expect(stored).toBeTruthy();

        // The plaintext token must never appear in the token column.
        const plaintextRow = await connection
            .getRepository(ctx, McpOauthGrant)
            .findOne({ where: { accessTokenHash: access_token } });
        expect(plaintextRow).toBeNull();
    });

    it('rotates the refresh token and rejects a replay of the original', async () => {
        const oauth = server.app.get(McpOauthService);
        const first = await runFlow();

        const rotated = await oauth.exchangeToken({
            grant_type: 'refresh_token',
            refresh_token: first.refresh_token,
            client_id: first.client_id,
            resource: first.resource,
        });
        expect(rotated.access_token).toBeTruthy();
        expect(rotated.access_token).not.toBe(first.access_token);

        // Replaying the now-rotated original refresh token is rejected.
        await expect(
            oauth.exchangeToken({
                grant_type: 'refresh_token',
                refresh_token: first.refresh_token,
                client_id: first.client_id,
                resource: first.resource,
            }),
        ).rejects.toThrow(/invalid or expired/i);
    });

    it('rejects re-exchange of an already-used authorization code', async () => {
        const oauth = server.app.get(McpOauthService);
        // The flow has already exchanged this code once; a sequential replay must fail.
        const { code, client_id, redirect_uri, code_verifier, resource } = await runFlow();

        await expect(
            oauth.exchangeToken({
                grant_type: 'authorization_code',
                code,
                client_id,
                redirect_uri,
                code_verifier,
                resource,
            }),
        ).rejects.toThrow(/invalid or expired/i);
    });

    // T7 regression — when the grant's Vendure session lapses, re-authenticating the same
    // access token must create a fresh session rather than fail.
    it('re-creates the dedicated Vendure session after it lapses', async () => {
        const oauth = server.app.get(McpOauthService);
        const connection = server.app.get(TransactionalConnection);
        const configService = server.app.get(ConfigService);
        const requestContextService = server.app.get(RequestContextService);
        const ctx = await requestContextService.create({ apiType: 'admin' });

        const { access_token } = await runFlow();

        // Find the grant row backing this access token, and note which Vendure
        // session currently backs it.
        const mcpSessionBefore = await connection
            .getRepository(ctx, McpOauthGrant)
            .findOne({ where: { accessTokenHash: lookupHash(access_token) } });
        if (!mcpSessionBefore) {
            throw new Error('Expected an McpOauthGrant for the access token');
        }
        const sessionIdBefore = mcpSessionBefore.vendureSessionId;

        // Simulate the Vendure session lapsing: expire the DB row and clear its cache entry
        // so the next lookup misses (Vendure clears expired sessions lazily, not on read),
        // forcing the re-creation path.
        const vendureSession = await connection
            .getRepository(ctx, Session)
            .findOne({ where: { id: sessionIdBefore } });
        if (!vendureSession) {
            throw new Error('Expected the Vendure session to exist');
        }
        vendureSession.expires = new Date(Date.now() - 60 * 1000);
        await connection.getRepository(ctx, Session).save(vendureSession);
        await configService.authOptions.sessionCacheStrategy.delete(vendureSession.token);

        // Re-authenticating succeeds by creating a new session, and the McpOauthGrant now
        // points at a different Vendure session id.
        const reauthenticated = await oauth.authenticateBearerToken(access_token, 'admin');
        expect(reauthenticated.ctx.activeUserId).toBe(mcpSessionBefore.actorId);

        const mcpSessionAfter = await connection
            .getRepository(ctx, McpOauthGrant)
            .findOne({ where: { accessTokenHash: lookupHash(access_token) } });
        if (!mcpSessionAfter) {
            throw new Error('Expected the McpOauthGrant to persist after re-creation');
        }
        expect(mcpSessionAfter.vendureSessionId).not.toBe(sessionIdBefore);
    });

    // lastActivityAt is throttled: it's only rewritten in the background once the stored
    // value is older than MCP_GRANT_ACTIVITY_UPDATE_INTERVAL_MS, and the write isn't awaited
    // by authenticateBearerToken, so the test polls the row rather than asserting immediately.
    it('refreshes a stale lastActivityAt in the background on the next authenticated call', async () => {
        const oauth = server.app.get(McpOauthService);
        const connection = server.app.get(TransactionalConnection);
        const ctx = await server.app.get(RequestContextService).create({ apiType: 'admin' });

        const { access_token } = await runFlow();
        const grant = await grantFor(ctx, access_token);

        const staleActivityAt = new Date(Date.now() - MCP_GRANT_ACTIVITY_UPDATE_INTERVAL_MS - 1000);
        await connection
            .getRepository(ctx, McpOauthGrant)
            .update({ id: grant.id }, { lastActivityAt: staleActivityAt });

        await oauth.authenticateBearerToken(access_token, 'admin');

        // The update is fired in the background, so poll briefly for it to land rather
        // than assuming it has completed by the time authenticateBearerToken returns.
        let updated: McpOauthGrant | null = null;
        for (let attempt = 0; attempt < 20; attempt++) {
            updated = await connection.getRepository(ctx, McpOauthGrant).findOne({ where: { id: grant.id } });
            if (updated && updated.lastActivityAt.getTime() > staleActivityAt.getTime()) {
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        expect(updated?.lastActivityAt.getTime()).toBeGreaterThan(staleActivityAt.getTime());
    });

    // An access token that has outlived its own accessTokenExpiresAt is refused, even while the
    // grant it belongs to is nowhere near its own expiry — this is the first of the two checks in
    // authenticateBearerToken and the one that runs first.
    it('rejects an MCP call over HTTP once the access token itself has expired', async () => {
        const connection = server.app.get(TransactionalConnection);
        const ctx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
        const grantRepo = connection.getRepository(ctx, McpOauthGrant);

        const { access_token } = await runFlow();
        const grant = await grantFor(ctx, access_token);

        // Sanity check: the token authenticates fine before we touch anything.
        const before = await postMcp(baseUrl(), 'admin', rpc('tools/list', {}, 1), { token: access_token });
        expect(before.status).toBe(200);

        await grantRepo.update({ id: grant.id }, { accessTokenExpiresAt: new Date(Date.now() - MS_PER_DAY) });

        const after = await postMcp(baseUrl(), 'admin', rpc('tools/list', {}, 2), { token: access_token });
        expect(after.status).toBe(401);
        expect(after.body.message).toBe('Invalid or expired access token');
    });

    // The grant's own lifetime (`expiresAt`) can lapse while its current access token is still
    // fresh — the access-token check above runs first and would pass, so this pins the second,
    // later check in authenticateBearerToken instead. Only `expiresAt` is backdated here;
    // `accessTokenExpiresAt` is left at its original (still-future) value on purpose.
    it('rejects an MCP call over HTTP once the grant itself has expired, with the access token still valid', async () => {
        const connection = server.app.get(TransactionalConnection);
        const ctx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
        const grantRepo = connection.getRepository(ctx, McpOauthGrant);

        const { access_token } = await runFlow();
        const grant = await grantFor(ctx, access_token);

        const before = await postMcp(baseUrl(), 'admin', rpc('tools/list', {}, 1), { token: access_token });
        expect(before.status).toBe(200);

        await grantRepo.update({ id: grant.id }, { expiresAt: new Date(Date.now() - MS_PER_DAY) });

        const after = await postMcp(baseUrl(), 'admin', rpc('tools/list', {}, 2), { token: access_token });
        expect(after.status).toBe(401);
        // Distinct from the access-token-expiry message above, confirming this reached the
        // later `grant.expiresAt` check and not the earlier `accessTokenExpiresAt` one.
        expect(after.body.message).toBe('MCP grant is expired');
    });

    // Deleting the granting administrator must end MCP access. Core deletes the admin's
    // sessions on deletion, so the next call takes the re-creation path above — which must
    // refuse the soft-deleted user and revoke the grant, not mint a fresh session carrying
    // the deleted account's roles.
    it('ends MCP access and revokes the grant when the granting administrator is deleted', async () => {
        const oauth = server.app.get(McpOauthService);
        const administratorService = server.app.get(AdministratorService);
        const roleService = server.app.get(RoleService);
        const connection = server.app.get(TransactionalConnection);
        const bareCtx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
        // Creating an administrator checks the acting user may grant the roles,
        // so the context must act as the superadmin, not anonymously.
        const superadminUser = await connection
            .getRepository(bareCtx, User)
            .findOneByOrFail({ identifier: 'superadmin' });
        const ctx = await server.app
            .get(RequestContextService)
            .create({ apiType: 'admin', user: superadminUser });

        // An administrator other than the shared superadmin, so deleting them cannot
        // affect the rest of this suite. Consent needs the UpdateMcpServer permission,
        // which the superadmin role carries.
        const superAdminRole = await roleService.getSuperAdminRole(ctx);
        const doomedAdmin = await administratorService.create(ctx, {
            firstName: 'Doomed',
            lastName: 'Admin',
            emailAddress: 'doomed@test.com',
            password: 'test',
            roleIds: [superAdminRole.id],
        });
        await adminClient.asUserWithCredentials('doomed@test.com', 'test');
        const doomedAdminToken = adminClient.getAuthToken();
        const { access_token, refresh_token, client_id, resource } = await runAuthorizationCodeFlow({
            baseUrl: baseUrl(),
            issuer: ISSUER,
            superAdminToken: doomedAdminToken,
        });
        // Switching the shared client's user invalidated the session behind the suite-wide
        // superadmin token, so capture the replacement for the tests that follow.
        await adminClient.asSuperAdmin();
        superAdminToken = adminClient.getAuthToken();

        const authenticated = await oauth.authenticateBearerToken(access_token, 'admin');
        expect(authenticated.grant.actorId).toBe(doomedAdmin.user.id);

        await administratorService.softDelete(ctx, doomedAdmin.id);

        await expect(oauth.authenticateBearerToken(access_token, 'admin')).rejects.toThrow(
            'Vendure user no longer exists',
        );
        // The refusal also revoked the grant, so the refresh token is dead too.
        const grant = await grantFor(ctx, access_token);
        expect(grant.revokedAt).toBeTruthy();
        await expect(
            oauth.exchangeToken({
                grant_type: 'refresh_token',
                refresh_token,
                client_id,
                resource,
            }),
        ).rejects.toThrow(/invalid or expired/i);
    });

    // Revoking must take the session with it — row and cache entry both. Leaving the cache
    // entry behind would keep the revoked credential working against the ordinary GraphQL
    // APIs until the entry aged out.
    it('deletes and evicts the Vendure session when a grant is revoked', async () => {
        const oauth = server.app.get(McpOauthService);
        const connection = server.app.get(TransactionalConnection);
        const sessionService = server.app.get(SessionService);
        const ctx = await server.app.get(RequestContextService).create({ apiType: 'admin' });

        const { access_token } = await runFlow();
        // Authenticating first puts the session in the cache, so the assertions below
        // cover the cache entry and not just the row.
        const authenticated = await oauth.authenticateBearerToken(access_token, 'admin');
        const sessionToken = sessionTokenOf(authenticated.ctx);

        await oauth.revoke(access_token);

        expect(
            await connection
                .getRepository(ctx, Session)
                .findOne({ where: { id: authenticated.grant.vendureSessionId } }),
        ).toBeNull();
        expect(await sessionService.getSessionFromToken(sessionToken)).toBeUndefined();
    });

    // Revocation writes two rows. A half-applied revocation is the dangerous outcome:
    // the session gone but the grant still live, which the re-creation path would silently
    // paper over on the next request.
    it('leaves the grant and its session untouched when revocation fails midway', async () => {
        const oauth = server.app.get(McpOauthService);
        const connection = server.app.get(TransactionalConnection);
        const ctx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
        const grantRepo = connection.getRepository(ctx, McpOauthGrant);

        const { access_token } = await runFlow();
        const grant = await grantFor(ctx, access_token);

        await withFailingUpdate(connection, McpOauthGrant, 'forced revocation update failure', async () => {
            await expect(oauth.revoke(access_token)).rejects.toThrow('forced revocation update failure');
        });

        const grantAfter = await grantRepo.findOneByOrFail({ id: grant.id });
        expect(grantAfter.revokedAt).toBeNull();
        expect(
            await connection.getRepository(ctx, Session).findOneBy({ id: grant.vendureSessionId }),
        ).toBeTruthy();
        expect((await oauth.authenticateBearerToken(access_token, 'admin')).grant.id).toBe(grant.id);
    });

    it('deletes the Vendure session behind a grant that has passed its expiry', async () => {
        const oauth = server.app.get(McpOauthService);
        const retention = server.app.get(McpOauthRetentionService);
        const connection = server.app.get(TransactionalConnection);
        const sessionService = server.app.get(SessionService);
        const ctx = await server.app.get(RequestContextService).create({ apiType: 'admin' });

        const { access_token } = await runFlow();
        // Authenticating first puts the session in the cache, so the assertions below
        // cover the cache entry and not just the row.
        const authenticated = await oauth.authenticateBearerToken(access_token, 'admin');
        const sessionToken = sessionTokenOf(authenticated.ctx);
        const grantRepo = connection.getRepository(ctx, McpOauthGrant);
        const sessionRepo = connection.getRepository(ctx, Session);
        expect(await sessionRepo.findOneBy({ id: authenticated.grant.vendureSessionId })).toBeTruthy();

        await grantRepo.update(
            { id: authenticated.grant.id },
            { expiresAt: new Date(Date.now() - MS_PER_DAY) },
        );

        await retention.deleteExpiredOauthRecords(ctx);

        expect(await sessionRepo.findOneBy({ id: authenticated.grant.vendureSessionId })).toBeNull();
        expect(await sessionService.getSessionFromToken(sessionToken)).toBeUndefined();
        // Only sessions an expired grant points at are in scope — the administrator's own
        // session is not referenced by any grant and must survive.
        expect(await sessionRepo.findOne({ where: { token: superAdminToken } })).toBeTruthy();
    });

    // Using a request or code deletes the row outright (the atomic claim is a DELETE, not a
    // flag flip), so a completed flow leaves nothing behind for the sweep to find.
    it('leaves no authorization request or code behind after a completed flow', async () => {
        const retention = server.app.get(McpOauthRetentionService);
        const connection = server.app.get(TransactionalConnection);
        const ctx = await server.app.get(RequestContextService).create({ apiType: 'admin' });

        // Drain what the earlier tests' flows left behind, so the counts below are exact.
        await retention.deleteExpiredOauthRecords(ctx);

        const { request_token, code } = await runFlow();
        const requestRepo = connection.getRepository(ctx, McpAuthorizationRequest);
        const codeRepo = connection.getRepository(ctx, McpAuthorizationCode);
        const findRequest = () => requestRepo.findOne({ where: { requestToken: lookupHash(request_token) } });
        const findCode = () => codeRepo.findOne({ where: { code: lookupHash(code) } });

        // Approving the request deleted it, and exchanging the code deleted that too.
        expect(await findRequest()).toBeNull();
        expect(await findCode()).toBeNull();

        const result = await retention.deleteExpiredOauthRecords(ctx);

        // Nothing left for the sweep to find. The grant this flow created is still live, so
        // neither it nor its session is touched.
        expect(result).toEqual({
            deletedSessions: 0,
            deletedRequests: 0,
            deletedCodes: 0,
            deletedGrants: 0,
            deletedClients: 0,
        });
    });

    // A request or code that is created but never used — an abandoned flow — has no claim to
    // delete it, so the sweep is the only thing that ever removes it, once it has expired.
    it('sweeps an authorization request and code that expired without ever being used', async () => {
        const retention = server.app.get(McpOauthRetentionService);
        const connection = server.app.get(TransactionalConnection);
        const ctx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
        const requestRepo = connection.getRepository(ctx, McpAuthorizationRequest);
        const codeRepo = connection.getRepository(ctx, McpAuthorizationCode);

        // Drain what earlier tests left behind, so the counts below are exact.
        await retention.deleteExpiredOauthRecords(ctx);

        const client = await createClient(ctx);
        const superadmin = await connection.getRepository(ctx, User).findOneByOrFail({
            identifier: 'superadmin',
        });
        const uniqueSuffix = Math.random().toString(36).slice(2);

        const request = await requestRepo.save(
            new McpAuthorizationRequest({
                requestToken: `expired-request-${uniqueSuffix}`,
                oauthClient: client,
                oauthClientId: client.id,
                redirectUri: 'https://example.com/cb',
                state: null,
                codeChallenge: 'challenge',
                codeChallengeMethod: 'S256',
                toolset: 'admin',
                resource: `${ISSUER}/mcp/admin`,
                expiresAt: new Date(Date.now() - 60_000),
            }),
        );
        const authCode = await codeRepo.save(
            new McpAuthorizationCode({
                code: `expired-code-${uniqueSuffix}`,
                oauthClient: client,
                oauthClientId: client.id,
                actorId: superadmin.id,
                actorType: 'admin',
                redirectUri: 'https://example.com/cb',
                resource: `${ISSUER}/mcp/admin`,
                codeChallenge: 'challenge',
                codeChallengeMethod: 'S256',
                channelId: null,
                expiresAt: new Date(Date.now() - 60_000),
            }),
        );

        const result = await retention.deleteExpiredOauthRecords(ctx);

        expect(result.deletedRequests).toBe(1);
        expect(result.deletedCodes).toBe(1);
        expect(await requestRepo.findOne({ where: { id: request.id } })).toBeNull();
        expect(await codeRepo.findOne({ where: { id: authCode.id } })).toBeNull();
    });

    // The grant row is the only OAuth record carrying audit value, so it outlives its own expiry
    // and goes only once every tool-call log that could reference it has itself been pruned —
    // i.e. once it has been dead longer than `oauth.grantRetentionDays` (left at its 30-day default here).
    it('keeps a recently-dead grant and deletes one dead longer than the retention window', async () => {
        const retention = server.app.get(McpOauthRetentionService);
        const connection = server.app.get(TransactionalConnection);
        const ctx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
        const grantRepo = connection.getRepository(ctx, McpOauthGrant);

        const recent = await grantFor(ctx, (await runFlow()).access_token);
        const longDead = await grantFor(ctx, (await runFlow()).access_token);
        await grantRepo.update({ id: recent.id }, { expiresAt: new Date(Date.now() - 2 * MS_PER_DAY) });
        await grantRepo.update({ id: longDead.id }, { expiresAt: new Date(Date.now() - 31 * MS_PER_DAY) });

        const result = await retention.deleteExpiredOauthRecords(ctx);

        expect(await grantRepo.findOne({ where: { id: recent.id } })).toBeTruthy();
        expect(await grantRepo.findOne({ where: { id: longDead.id } })).toBeNull();
        expect(result.deletedGrants).toBe(1);
        // Both grants were past expiry, so both of their sessions go regardless of the window.
        expect(result.deletedSessions).toBe(2);
    });

    // The scheduled task is the only production caller, so prove the wiring end to end.
    it('prunes when driven through the scheduled task', async () => {
        const connection = server.app.get(TransactionalConnection);
        const ctx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
        const grantRepo = connection.getRepository(ctx, McpOauthGrant);

        const grant = await grantFor(ctx, (await runFlow()).access_token);
        await grantRepo.update({ id: grant.id }, { expiresAt: new Date(Date.now() - MS_PER_DAY) });

        const injector = new Injector(server.app.get(ModuleRef));
        const result = (await mcpOauthRetentionTask.execute(injector)) as McpOauthRetentionResult;

        expect(result.deletedSessions).toBe(1);
        expect(
            await connection.getRepository(ctx, Session).findOne({ where: { id: grant.vendureSessionId } }),
        ).toBeNull();
    });

    it('deletes a grant revoked longer ago than the retention window', async () => {
        const retention = server.app.get(McpOauthRetentionService);
        const connection = server.app.get(TransactionalConnection);
        const ctx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
        const grantRepo = connection.getRepository(ctx, McpOauthGrant);

        const grant = await grantFor(ctx, (await runFlow()).access_token);
        // Revocation already removed the session; only the row's own retention is at stake here.
        await grantRepo.update({ id: grant.id }, { revokedAt: new Date(Date.now() - 31 * MS_PER_DAY) });

        await retention.deleteExpiredOauthRecords(ctx);

        expect(await grantRepo.findOne({ where: { id: grant.id } })).toBeNull();
    });

    // A client that registered (or was CIMD-resolved) but never went on to obtain a token —
    // e.g. it abandoned the flow after DCR — is cleaned up once it has sat unused past the
    // retention window.
    it('deletes a never-used client older than the retention window with no grants', async () => {
        const retention = server.app.get(McpOauthRetentionService);
        const connection = server.app.get(TransactionalConnection);
        const ctx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
        const clientRepo = connection.getRepository(ctx, McpOauthClient);

        // Drain what earlier tests left behind, so the count below is exact.
        await retention.deleteExpiredOauthRecords(ctx);

        const client = await createClient(ctx, { ageMs: MCP_UNUSED_OAUTH_CLIENT_RETENTION_MS + MS_PER_DAY });

        const result = await retention.deleteExpiredOauthRecords(ctx);

        expect(result.deletedClients).toBe(1);
        expect(await clientRepo.findOne({ where: { id: client.id } })).toBeNull();
    });

    // A client is still within its grace period to complete the flow, so it must survive even
    // though it, too, has never been used.
    it('keeps a never-used client younger than the retention window', async () => {
        const retention = server.app.get(McpOauthRetentionService);
        const connection = server.app.get(TransactionalConnection);
        const ctx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
        const clientRepo = connection.getRepository(ctx, McpOauthClient);

        await retention.deleteExpiredOauthRecords(ctx);

        const client = await createClient(ctx, { ageMs: 60_000 });

        const result = await retention.deleteExpiredOauthRecords(ctx);

        expect(result.deletedClients).toBe(0);
        expect(await clientRepo.findOne({ where: { id: client.id } })).toBeTruthy();
    });

    // Once a client has been used, it is kept indefinitely regardless of age — only
    // `McpOauthGrant`'s own retention window governs how long its usage history lives on.
    it('keeps a client with lastUsedAt set even when older than the retention window', async () => {
        const retention = server.app.get(McpOauthRetentionService);
        const connection = server.app.get(TransactionalConnection);
        const ctx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
        const clientRepo = connection.getRepository(ctx, McpOauthClient);

        await retention.deleteExpiredOauthRecords(ctx);

        const client = await createClient(ctx, {
            lastUsedAt: new Date(),
            ageMs: MCP_UNUSED_OAUTH_CLIENT_RETENTION_MS + MS_PER_DAY,
        });

        const result = await retention.deleteExpiredOauthRecords(ctx);

        expect(result.deletedClients).toBe(0);
        expect(await clientRepo.findOne({ where: { id: client.id } })).toBeTruthy();
    });

    // The cascade guard: `McpOauthGrant.oauthClient` cascade-deletes on its client, so a client
    // that a grant still references must never be deleted — even though it otherwise looks idle
    // (never used, past the window) — because that would silently take the grant with it.
    it('keeps a never-used, old client that a grant still references', async () => {
        const retention = server.app.get(McpOauthRetentionService);
        const connection = server.app.get(TransactionalConnection);
        const sessionService = server.app.get(SessionService);
        const ctx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
        const clientRepo = connection.getRepository(ctx, McpOauthClient);
        const grantRepo = connection.getRepository(ctx, McpOauthGrant);

        await retention.deleteExpiredOauthRecords(ctx);

        const client = await createClient(ctx, { ageMs: MCP_UNUSED_OAUTH_CLIENT_RETENTION_MS + MS_PER_DAY });
        const superadmin = await connection.getRepository(ctx, User).findOneByOrFail({
            identifier: 'superadmin',
        });
        const session = await sessionService.createAnonymousSession();
        const uniqueSuffix = Math.random().toString(36).slice(2);
        const grant = await grantRepo.save(
            new McpOauthGrant({
                accessTokenHash: `retention-test-access-${uniqueSuffix}`,
                refreshTokenHash: `retention-test-refresh-${uniqueSuffix}`,
                previousRefreshTokenHash: null,
                oauthClient: client,
                oauthClientId: client.id,
                actorId: superadmin.id,
                actorType: 'admin',
                resource: `${ISSUER}/mcp/admin`,
                accessTokenExpiresAt: new Date(Date.now() + 60_000),
                expiresAt: new Date(Date.now() + MS_PER_DAY),
                revokedAt: null,
                vendureSessionId: session.id,
                channelId: null,
                lastActivityAt: new Date(),
            }),
        );

        const result = await retention.deleteExpiredOauthRecords(ctx);

        expect(result.deletedClients).toBe(0);
        expect(await clientRepo.findOne({ where: { id: client.id } })).toBeTruthy();
        expect(await grantRepo.findOne({ where: { id: grant.id } })).toBeTruthy();
    });
});

describe('McpPlugin per-user rate limiting', () => {
    const pluginOptions: McpPluginOptions = {
        oauth: { tokenSecret: TOKEN_SECRET },
        // Only the user bucket is on. The session and client buckets are the two that a fresh
        // authorization resets, so with those off a refusal below can only come from the user
        // bucket. The OAuth-IP limit is off because the two flows spend several requests on the
        // OAuth endpoints.
        rateLimits: {
            perSession: { rpm: 0 },
            perUser: { rpm: 1 },
            perClient: { rpm: 0 },
            anonymousIp: false,
            oauthIp: false,
        },
    };
    const config = mergeConfig(testConfig(), { plugins: [McpPlugin.init(pluginOptions)] });
    const { server, adminClient } = createTestEnvironment(config);
    const baseUrl = () => `http://localhost:${config.apiOptions.port}`;

    let consentToken: string;

    beforeAll(async () => {
        McpPlugin.init(pluginOptions);
        await initTestServer(server);
        // An administrator of this suite's own. Rate-limit counters are not cleared when a suite's
        // server is destroyed, because the default in-memory cache strategy is one instance shared
        // by every server booted in this process, and the suite above already charged the
        // superadmin's user bucket.
        // AdministratorService.create checks that the acting user may grant the roles, so this
        // context acts as the superadmin.
        const bareCtx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
        const superadminUser = await server.app
            .get(TransactionalConnection)
            .getRepository(bareCtx, User)
            .findOneByOrFail({ identifier: 'superadmin' });
        const ctx = await server.app
            .get(RequestContextService)
            .create({ apiType: 'admin', user: superadminUser });
        const superAdminRole = await server.app.get(RoleService).getSuperAdminRole(ctx);
        await server.app.get(AdministratorService).create(ctx, {
            firstName: 'RateLimited',
            lastName: 'Admin',
            emailAddress: 'rate-limited@test.com',
            password: 'test',
            roleIds: [superAdminRole.id],
        });
        await adminClient.asUserWithCredentials('rate-limited@test.com', 'test');
        consentToken = adminClient.getAuthToken();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('counts one administrator across two authorizations on two client records', async () => {
        // Each flow registers a new client and gets a new grant with its own Vendure session, so the
        // session and client buckets both start empty for the second token. Only the person is the
        // same.
        const first = await runAuthorizationCodeFlow({
            baseUrl: baseUrl(),
            issuer: ISSUER,
            superAdminToken: consentToken,
        });
        const second = await runAuthorizationCodeFlow({
            baseUrl: baseUrl(),
            issuer: ISSUER,
            superAdminToken: consentToken,
        });
        expect(second.client_id).not.toBe(first.client_id);

        const allowed = await postMcp(baseUrl(), 'admin', rpc('ping', {}, 1), {
            token: first.access_token,
        });
        expect(allowed.status).toBe(200);

        const refused = await postMcp(baseUrl(), 'admin', rpc('ping', {}, 2), {
            token: second.access_token,
        });
        expectRateLimitRefusal(refused, { scope: 'user', id: 2 });
    });
});
