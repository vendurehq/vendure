import { RequestContext, TransactionalConnection, User } from '@vendure/core';
import crypto from 'crypto';

import { McpAuthorizationCode } from '../../src/entities/mcp-authorization-code.entity';
import { McpOauthClient } from '../../src/entities/mcp-oauth-client.entity';
import { deriveHashKey, hashLookupToken } from '../../src/oauth/token-hash';

// Server-side test fixtures, as opposed to the HTTP flow driver in ./oauth-test-client.
// These reach straight into the database, so a test can start from a grant it fully
// controls without walking the register -> authorize -> consent path first.

/** Every seeded code stores its own PKCE challenge, so one shared verifier is fine. */
const DEFAULT_VERIFIER = 'a'.repeat(64);
const DEFAULT_REDIRECT_URI = 'https://example.com/cb';

export interface SeedAuthorizationCodeOptions {
    /** Must match the plugin's configured `oauth.tokenSecret` so the stored hash resolves. */
    tokenSecret: string;
    /** OAuth resource (audience) the resulting grant is scoped to. */
    resource: string;
    /** Unique per test — `McpOauthClient.clientId` carries a unique index. */
    clientId: string;
    /** Plaintext authorization code the test will exchange. */
    codePlaintext: string;
}

/** The token-endpoint input that redeems a seeded authorization code. */
export interface AuthorizationCodeExchangeInput {
    grant_type: 'authorization_code';
    code: string;
    client_id: string;
    redirect_uri: string;
    code_verifier: string;
    resource: string;
}

/**
 * Seeds an OAuth client plus an unconsumed authorization code approved for the seeded
 * superadmin, and returns the input that redeems it. The caller decides when — and how
 * many times — to exchange, which is what tests of single-use and rotation behaviour need.
 */
export async function seedAuthorizationCode(
    connection: TransactionalConnection,
    ctx: RequestContext,
    options: SeedAuthorizationCodeOptions,
): Promise<{ client: McpOauthClient; exchangeInput: AuthorizationCodeExchangeInput }> {
    const { tokenSecret, resource, clientId, codePlaintext } = options;

    const superadmin = await connection
        .getRepository(ctx, User)
        .findOne({ where: { identifier: 'superadmin' } });
    if (!superadmin) {
        throw new Error('Expected a seeded superadmin user');
    }

    const client = await connection.getRepository(ctx, McpOauthClient).save(
        new McpOauthClient({
            clientId,
            clientName: clientId,
            clientUri: null,
            logoUri: null,
            redirectUris: [DEFAULT_REDIRECT_URI],
            grantTypes: ['authorization_code', 'refresh_token'],
            tokenEndpointAuthMethod: 'none',
            lastUsedAt: null,
        }),
    );

    await connection.getRepository(ctx, McpAuthorizationCode).save(
        new McpAuthorizationCode({
            code: hashLookupToken(codePlaintext, deriveHashKey(tokenSecret)),
            oauthClient: client,
            oauthClientId: client.id,
            actorId: superadmin.id,
            actorType: 'admin',
            redirectUri: DEFAULT_REDIRECT_URI,
            resource,
            codeChallenge: crypto.createHash('sha256').update(DEFAULT_VERIFIER).digest('base64url'),
            codeChallengeMethod: 'S256',
            channelId: null,
            expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        }),
    );

    return {
        client,
        exchangeInput: {
            grant_type: 'authorization_code',
            code: codePlaintext,
            client_id: clientId,
            redirect_uri: DEFAULT_REDIRECT_URI,
            code_verifier: DEFAULT_VERIFIER,
            resource,
        },
    };
}

/**
 * Runs `work` with a TypeORM subscriber installed that makes every update to `entity`
 * throw `message`, and removes it again afterwards even if `work` fails. Stands in for
 * a write failing for any reason — deadlock, constraint, lost connection — so a test can
 * prove the surrounding transaction rolls back.
 */
export async function withFailingUpdate(
    connection: TransactionalConnection,
    entity: new (...args: any[]) => any,
    message: string,
    work: () => Promise<void>,
): Promise<void> {
    const blocker = {
        listenTo: () => entity,
        beforeUpdate: () => {
            throw new Error(message);
        },
    };
    const { subscribers } = connection.rawConnection;
    subscribers.push(blocker as any);
    try {
        await work();
    } finally {
        subscribers.splice(subscribers.indexOf(blocker as any), 1);
    }
}
