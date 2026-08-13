import { mergeConfig, RequestContextService, Session, TransactionalConnection } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { McpOauthClient } from '../src/entities/mcp-oauth-client.entity';
import { McpOauthGrant } from '../src/entities/mcp-oauth-grant.entity';
import { McpOauthService } from '../src/oauth/oauth.service';
import { deriveHashKey, hashLookupToken } from '../src/oauth/token-hash';
import { McpPlugin } from '../src/plugin';

import { seedAuthorizationCode, withFailingUpdate } from './utils/oauth-test-fixtures';

const TOKEN_SECRET = 'test-secret';
const RESOURCE = `http://localhost:${testConfig().apiOptions.port}/mcp/admin`;

describe('McpPlugin OAuth single-use code', () => {
    const config = mergeConfig(testConfig(), {
        plugins: [McpPlugin.init({ oauth: { tokenSecret: TOKEN_SECRET } })],
    });
    const { server } = createTestEnvironment(config);

    const hashKey = deriveHashKey(TOKEN_SECRET);
    const lookupHash = (value: string) => hashLookupToken(value, hashKey);

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products.csv'),
            customerCount: 1,
        });
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    /** The services, admin context and code-seeding helper every test here works through. */
    const testEnv = async () => {
        const connection = server.app.get(TransactionalConnection);
        const oauth = server.app.get(McpOauthService);
        const ctx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
        /** Seeds a client plus an unconsumed authorization code, ready to exchange. */
        const seedCode = (clientId: string, codePlaintext: string) =>
            seedAuthorizationCode(connection, ctx, {
                tokenSecret: TOKEN_SECRET,
                resource: RESOURCE,
                clientId,
                codePlaintext,
            });
        return { connection, oauth, ctx, seedCode };
    };

    // T11 — two concurrent exchanges of the same authorization code must yield
    // exactly one success and one failure (the atomic claim makes the code single-use).
    it('exchanges the same authorization code concurrently with exactly one winner', async () => {
        const { oauth, seedCode } = await testEnv();
        const { exchangeInput } = await seedCode('test-client', 'single-use-code');

        const [a, b] = await Promise.allSettled([
            oauth.exchangeToken(exchangeInput),
            oauth.exchangeToken(exchangeInput),
        ]);

        const fulfilled = [a, b].filter(r => r.status === 'fulfilled');
        const rejected = [a, b].filter((r): r is PromiseRejectedResult => r.status === 'rejected');
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect(rejected[0].reason.message).toBe('Authorization code invalid or expired');
    });

    // T12 — refresh-token rotation must be atomic and in place: the same grant row swaps
    // to the new token hashes, remembers the rotated-away refresh hash, and a replay of
    // the original refresh token is rejected.
    it('rotates a refresh token atomically in place on the same grant row', async () => {
        const { connection, oauth, ctx, seedCode } = await testEnv();
        const { exchangeInput } = await seedCode('rotation-client', 'rotation-code');

        // Exercise the real authorization-code grant so a genuine access+refresh pair and an
        // McpOauthGrant exist before we rotate.
        const first = await oauth.exchangeToken(exchangeInput);

        const priorGrant = await connection.getRepository(ctx, McpOauthGrant).findOne({
            where: { accessTokenHash: lookupHash(first.access_token) },
        });
        if (!priorGrant) {
            throw new Error('Expected the issued grant to be persisted');
        }
        const grantId = priorGrant.id;
        const sessionBefore = await connection
            .getRepository(ctx, Session)
            .findOneByOrFail({ id: priorGrant.vendureSessionId });

        const second = await oauth.exchangeToken({
            grant_type: 'refresh_token',
            refresh_token: first.refresh_token,
            client_id: 'rotation-client',
            resource: RESOURCE,
        });
        expect(second.access_token).not.toBe(first.access_token);

        // Rotation happened in place: the same grant row carries the new hashes and
        // remembers the rotated-away refresh hash for reuse detection.
        const rotatedGrant = await connection.getRepository(ctx, McpOauthGrant).findOne({
            where: { accessTokenHash: lookupHash(second.access_token) },
        });
        if (!rotatedGrant) {
            throw new Error('Expected the rotated grant row to exist');
        }
        expect(rotatedGrant.id).toBe(grantId);
        expect(rotatedGrant.refreshTokenHash).toBe(lookupHash(second.refresh_token));
        expect(rotatedGrant.previousRefreshTokenHash).toBe(lookupHash(first.refresh_token));
        expect(rotatedGrant.revokedAt).toBeNull();

        // The prior access token no longer resolves...
        const staleAccess = await connection.getRepository(ctx, McpOauthGrant).findOne({
            where: { accessTokenHash: lookupHash(first.access_token) },
        });
        expect(staleAccess).toBeNull();

        // ...while the Vendure session behind the grant is untouched: same row, same token.
        // Only the OAuth credentials rotate.
        const sessionAfter = await connection
            .getRepository(ctx, Session)
            .findOneByOrFail({ id: rotatedGrant.vendureSessionId });
        expect(rotatedGrant.vendureSessionId).toBe(priorGrant.vendureSessionId);
        expect(sessionAfter.token).toBe(sessionBefore.token);

        expect(await oauth.authenticateBearerToken(second.access_token, 'admin')).toBeTruthy();
        await expect(oauth.authenticateBearerToken(first.access_token, 'admin')).rejects.toThrow(
            /invalid or expired/i,
        );

        // Replaying the original refresh token is rejected (and, per OAuth 2.1 reuse
        // detection, revokes the grant — covered by the dedicated test below).
        await expect(
            oauth.exchangeToken({
                grant_type: 'refresh_token',
                refresh_token: first.refresh_token,
                client_id: 'rotation-client',
                resource: RESOURCE,
            }),
        ).rejects.toThrow('Refresh token invalid or expired');
    });

    // Refresh writes two rows — the grant's rotated hashes and the client's lastUsedAt.
    // If the second fails, the first must not survive, or the caller is left holding a
    // refresh token the server has already rotated away and can never use again.
    it('rolls back the rotated token hashes when the client update fails', async () => {
        const { connection, oauth, seedCode } = await testEnv();
        const { exchangeInput } = await seedCode('rollback-client', 'rollback-code');
        const first = await oauth.exchangeToken(exchangeInput);

        const refresh = () =>
            oauth.exchangeToken({
                grant_type: 'refresh_token',
                refresh_token: first.refresh_token,
                client_id: 'rollback-client',
                resource: RESOURCE,
            });

        await withFailingUpdate(connection, McpOauthClient, 'forced client update failure', async () => {
            await expect(refresh()).rejects.toThrow('forced client update failure');
        });

        // The refresh token the client still holds is unchanged, so retrying works.
        expect((await refresh()).access_token).toBeTruthy();
    });

    // OAuth 2.1 refresh-token reuse detection — a rotated-away refresh token presented
    // again means it leaked, so the whole grant is revoked, killing the new tokens too.
    it('revokes the whole grant when a rotated refresh token is reused', async () => {
        const { connection, oauth, ctx, seedCode } = await testEnv();
        const { exchangeInput } = await seedCode('reuse-client', 'reuse-code');

        const first = await oauth.exchangeToken(exchangeInput);
        const second = await oauth.exchangeToken({
            grant_type: 'refresh_token',
            refresh_token: first.refresh_token,
            client_id: 'reuse-client',
            resource: RESOURCE,
        });

        // Reusing the rotated-away refresh token is rejected...
        await expect(
            oauth.exchangeToken({
                grant_type: 'refresh_token',
                refresh_token: first.refresh_token,
                client_id: 'reuse-client',
                resource: RESOURCE,
            }),
        ).rejects.toThrow('Refresh token invalid or expired');

        // ...and revokes the whole grant: the row is marked revoked and its
        // Vendure session is deleted.
        const grant = await connection.getRepository(ctx, McpOauthGrant).findOne({
            where: { accessTokenHash: lookupHash(second.access_token) },
        });
        if (!grant) {
            throw new Error('Expected the grant row to survive revocation');
        }
        expect(grant.revokedAt).toBeTruthy();
        const grantSession = await connection
            .getRepository(ctx, Session)
            .findOne({ where: { id: grant.vendureSessionId } });
        expect(grantSession).toBeNull();

        // The rotated-to tokens are dead as well.
        await expect(oauth.authenticateBearerToken(second.access_token, 'admin')).rejects.toThrow(
            /invalid or expired/i,
        );
        await expect(
            oauth.exchangeToken({
                grant_type: 'refresh_token',
                refresh_token: second.refresh_token,
                client_id: 'reuse-client',
                resource: RESOURCE,
            }),
        ).rejects.toThrow('Refresh token invalid or expired');
    });
});
