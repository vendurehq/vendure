import {
    AuthenticatedSession,
    mergeConfig,
    RequestContext,
    RequestContextService,
    Session,
    TransactionalConnection,
    UuidIdStrategy,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { MS_PER_DAY } from '../src/constants';
import { McpOauthGrant } from '../src/entities/mcp-oauth-grant.entity';
import { McpOauthRetentionService } from '../src/oauth/oauth-retention.service';
import { deriveHashKey, hashLookupToken } from '../src/oauth/token-hash';
import { McpPlugin } from '../src/plugin';
import { McpPluginOptions } from '../src/types';

import { postMcp, rpc } from './utils/mcp-http-client';
import { runAuthorizationCodeFlow, runShopAuthorizationCodeFlow } from './utils/oauth-test-client';
import { testServerInit } from './utils/test-server';

const TOKEN_SECRET = 'test-secret';
const ISSUER = `http://localhost:${testConfig().apiOptions.port}`;

// #5701 - with UuidIdStrategy on Postgres, Session.id is a uuid column while the grant's
// vendureSessionId is a varchar column, so any query comparing the two columns fails.
describe('McpPlugin OAuth with UuidIdStrategy', () => {
    const pluginOptions: McpPluginOptions = {
        oauth: {
            tokenSecret: TOKEN_SECRET,
            storefrontConsentUrl: 'https://storefront.example.com/mcp/authorize',
        },
        rateLimits: { oauthIp: false },
    };
    const config = mergeConfig(testConfig(), {
        entityOptions: { entityIdStrategy: new UuidIdStrategy() },
        plugins: [McpPlugin.init(pluginOptions)],
    });
    const { server, adminClient, shopClient } = createTestEnvironment(config);

    const hashKey = deriveHashKey(TOKEN_SECRET);
    const lookupHash = (value: string) => hashLookupToken(value, hashKey);
    const baseUrl = () => `http://localhost:${config.apiOptions.port}`;

    let superAdminToken: string;
    let customerAuthToken: string;
    let ctx: RequestContext;

    beforeAll(async () => {
        McpPlugin.init(pluginOptions);
        await server.init(testServerInit);
        await adminClient.asSuperAdmin();
        superAdminToken = adminClient.getAuthToken();

        const { customers } = await adminClient.query<{
            customers: { items: Array<{ emailAddress: string }> };
        }>(gql`
            query {
                customers(options: { take: 1 }) {
                    items {
                        emailAddress
                    }
                }
            }
        `);
        await shopClient.asUserWithCredentials(customers.items[0].emailAddress, 'test');
        customerAuthToken = shopClient.getAuthToken();
        ctx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    const grantRepo = () => server.app.get(TransactionalConnection).getRepository(ctx, McpOauthGrant);
    const sessionRepo = () => server.app.get(TransactionalConnection).getRepository(ctx, Session);

    const grantFor = (accessToken: string) =>
        grantRepo().findOneOrFail({ where: { accessTokenHash: lookupHash(accessToken) } });

    const listTools = (toolset: 'admin' | 'shop', token: string) =>
        postMcp(baseUrl(), toolset, rpc('tools/list', {}, 1), { token });

    it('accepts an admin bearer token issued by the OAuth flow', async () => {
        const { access_token } = await runAuthorizationCodeFlow({
            baseUrl: baseUrl(),
            issuer: ISSUER,
            superAdminToken,
        });

        const result = await listTools('admin', access_token);

        expect(result.status).toBe(200);
        expect(result.body.result.tools.length).toBeGreaterThan(0);
    });

    it('accepts a customer bearer token issued by the storefront OAuth flow', async () => {
        const { access_token } = await runShopAuthorizationCodeFlow({
            baseUrl: baseUrl(),
            issuer: ISSUER,
            vendureAuthToken: customerAuthToken,
        });

        const result = await listTools('shop', access_token);

        expect(result.status).toBe(200);
        expect(result.body.result.tools.length).toBeGreaterThan(0);
    });

    it('replaces a deleted Vendure session on the next request', async () => {
        const { access_token } = await runAuthorizationCodeFlow({
            baseUrl: baseUrl(),
            issuer: ISSUER,
            superAdminToken,
        });
        const before = await grantFor(access_token);
        await sessionRepo().delete({ id: before.vendureSessionId });

        const result = await listTools('admin', access_token);

        expect(result.status).toBe(200);
        const after = await grantFor(access_token);
        expect(after.vendureSessionId).not.toBe(before.vendureSessionId);
        const replacement = await server.app
            .get(TransactionalConnection)
            .getRepository(ctx, AuthenticatedSession)
            .findOneOrFail({ where: { id: after.vendureSessionId } });
        expect(replacement.apiType).toBe('admin');
    });

    it('refuses a revoked grant', async () => {
        const { access_token } = await runAuthorizationCodeFlow({
            baseUrl: baseUrl(),
            issuer: ISSUER,
            superAdminToken,
        });
        const grant = await grantFor(access_token);
        await grantRepo().update({ id: grant.id }, { revokedAt: new Date() });

        const result = await listTools('admin', access_token);

        expect(result.status).toBe(401);
        expect(result.body.message).toBe('Access token revoked');
    });

    it('deletes the Vendure session of an expired grant during retention', async () => {
        const { access_token } = await runAuthorizationCodeFlow({
            baseUrl: baseUrl(),
            issuer: ISSUER,
            superAdminToken,
        });
        const grant = await grantFor(access_token);
        await grantRepo().update({ id: grant.id }, { expiresAt: new Date(Date.now() - MS_PER_DAY) });

        const result = await server.app.get(McpOauthRetentionService).deleteExpiredOauthRecords(ctx);

        expect(result.deletedSessions).toBeGreaterThanOrEqual(1);
        expect(await sessionRepo().findOne({ where: { id: grant.vendureSessionId } })).toBeNull();
    });
});
