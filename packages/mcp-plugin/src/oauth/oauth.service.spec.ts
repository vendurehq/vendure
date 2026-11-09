import { describe, expect, it } from 'vitest';

import { resolveMcpPluginOptions } from '../resolve-options';
import { McpPluginOptions } from '../types';

import { McpAccessTokenExpiredError } from './oauth-error';
import { McpOauthMetadataService } from './oauth-metadata.service';
import { McpOauthService } from './oauth.service';
import { deriveHashKey, hashToken } from './token-hash';

const ISSUER = 'https://shop.example.com';

function createService(
    opts: { oauth?: McpPluginOptions['oauth']; shopAccess?: McpPluginOptions['shopAccess'] } = {},
): McpOauthService {
    const options: McpPluginOptions = {
        oauth: opts.oauth === undefined ? undefined : { issuer: ISSUER, ...opts.oauth },
        shopAccess: opts.shopAccess,
    };
    // The methods exercised here validate input / read options before touching any
    // injected dependency, so the DB/session deps (and the CIMD resolver) can be omitted.
    const deps = {
        connection: undefined as any,
        requestContextService: undefined as any,
        sessionService: undefined as any,
        channelService: undefined as any,
        userService: undefined as any,
        options: resolveMcpPluginOptions(options),
        cimdClientResolver: undefined as any,
    };
    return new McpOauthService(
        deps.connection,
        deps.requestContextService,
        deps.sessionService,
        deps.channelService,
        deps.userService,
        deps.options,
        deps.cimdClientResolver,
        undefined as any,
        new McpOauthMetadataService(deps.options),
    );
}

describe('McpOauthService PKCE / grant gating', () => {
    // The response_type and PKCE checks now answer by redirecting to the registered
    // redirect_uri, which needs a stored client, so they are covered by the e2e suite
    // (oauth-edge.e2e-spec.ts) rather than here.
    it('rejects an unsupported grant_type at the token endpoint', async () => {
        const service = createService({ oauth: { tokenSecret: 's' } });
        await expect(service.exchangeToken({ grant_type: 'password' })).rejects.toThrow(
            'Unsupported grant_type',
        );
    });
});

describe('McpOauthService defaultResource fallback', () => {
    // RFC 8707 leaves the `resource` parameter optional for clients; `oauth.defaultResource`
    // names the resource for clients that omit it (#5744). Without it the behavior is unchanged.
    const codeGrant = {
        grant_type: 'authorization_code',
        code: 'some-code',
        client_id: 'some-client',
        redirect_uri: 'https://client.example.com/callback',
        code_verifier: 'some-verifier',
    };

    it('still rejects a token request that omits resource when no default is configured', async () => {
        const service = createService({ oauth: { tokenSecret: 's' } });
        await expect(service.exchangeToken(codeGrant)).rejects.toThrow(
            'code, client_id, redirect_uri, code_verifier and resource are required',
        );
    });

    it('falls back to the configured defaultResource when the token request omits resource', async () => {
        // The fallback passes the required-fields gate and resolves the default resource; the
        // exchange then proceeds into the DB layer, which is not wired in this unit harness.
        // The assertion is that it no longer fails with the missing-resource rejection.
        const service = createService({
            oauth: { tokenSecret: 's', defaultResource: `${ISSUER}/mcp/admin` },
        });
        await expect(service.exchangeToken(codeGrant)).rejects.not.toThrow(
            'code, client_id, redirect_uri, code_verifier and resource are required',
        );
    });

    it('validates the configured defaultResource through the same resolver', async () => {
        // An invalid default fails exactly like an invalid explicit resource would.
        const service = createService({
            oauth: { tokenSecret: 's', defaultResource: 'not-a-url' },
        });
        await expect(service.exchangeToken(codeGrant)).rejects.toThrow(
            'Unsupported OAuth resource',
        );
    });
});

describe('McpOauthService OAuth credential lookup hashing', () => {
    it('hashes an OAuth credential with domain separation before storage and lookup', () => {
        const service = createService({ oauth: { tokenSecret: 'test-secret' } });
        const hashKey = deriveHashKey('test-secret');
        const storedHash = (service as any).hashLookup('plain-token');

        expect(storedHash).toBe(hashToken('lookup:plain-token', hashKey));
        expect(storedHash).not.toBe('plain-token');
    });
});

describe('McpOauthService bearer token rejection', () => {
    const service = createService({ oauth: { tokenSecret: 's' } }) as any;
    const adminResource = service.oauthMetadata.resourceForToolset('admin');
    const inAnHour = () => new Date(Date.now() + 60 * 60 * 1000);
    const anHourAgo = () => new Date(Date.now() - 60 * 60 * 1000);

    /** A grant that passes every check, so each test can spoil exactly one of them. */
    const usableLookup = (overrides: Record<string, unknown> = {}) => ({
        grant: {
            actorType: 'admin',
            resource: adminResource,
            revokedAt: null,
            accessTokenExpiresAt: inAnHour(),
            expiresAt: inAnHour(),
            ...overrides,
        },
        sessionToken: null,
    });

    const usableGrant = (lookup: unknown) => () => service.usableGrant(lookup, 'admin');

    it('accepts a grant that passes every check', () => {
        expect(usableGrant(usableLookup())).not.toThrow();
    });

    it('reports an unknown access token', () => {
        expect(usableGrant(undefined)).toThrow('Invalid or expired access token');
    });

    it('reports a revoked access token separately from an unknown one', () => {
        expect(usableGrant(usableLookup({ revokedAt: anHourAgo() }))).toThrow('Access token revoked');
    });

    it('reports a lapsed access token as expired, so the client knows to refresh', () => {
        expect(usableGrant(usableLookup({ accessTokenExpiresAt: anHourAgo() }))).toThrow(
            McpAccessTokenExpiredError,
        );
    });

    it('reports a lapsed grant separately from a lapsed access token', () => {
        expect(usableGrant(usableLookup({ expiresAt: anHourAgo() }))).toThrow('MCP grant is expired');
    });
});
