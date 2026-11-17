import { Session } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { resolveMcpPluginOptions } from '../resolve-options';
import { McpPluginOptions } from '../types';

import { McpAccessTokenExpiredError } from './oauth-error';
import { McpOauthMetadataService } from './oauth-metadata.service';
import { McpOauthService } from './oauth.service';
import { deriveHashKey, hashLookupToken, hashToken } from './token-hash';

const ISSUER = 'https://shop.example.com';

function createService(
    opts: { oauth?: McpPluginOptions['oauth']; shopAccess?: McpPluginOptions['shopAccess'] } = {},
    customDeps: Partial<{ connection: any }> = {},
): McpOauthService {
    const options: McpPluginOptions = {
        oauth: opts.oauth === undefined ? undefined : { issuer: ISSUER, ...opts.oauth },
        shopAccess: opts.shopAccess,
    };
    // Most methods exercised here validate input / read options before touching any injected
    // dependency, so the deps can be omitted. The grant lookup tests pass a mocked connection.
    const deps = {
        connection: customDeps.connection ?? (undefined as any),
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

describe('McpOauthService findGrantAndSessionToken', () => {
    it('returns grant and session token when both exist', async () => {
        const mockGrant = { id: 'grant-1', vendureSessionId: 'sess-uuid-1' };
        const mockSession = { id: 'sess-uuid-1', token: 'sess-token-abc' };
        const grantRepo = {
            findOne: vi.fn().mockResolvedValue(mockGrant),
        };
        const sessionRepo = {
            findOne: vi.fn().mockResolvedValue(mockSession),
        };
        const connection = {
            getRepository: vi.fn((ctx: any, entity: any) => {
                if (entity === Session) {
                    return sessionRepo;
                }
                return grantRepo;
            }),
        };
        const service = createService({ oauth: { tokenSecret: 's' } }, { connection }) as any;
        const res = await service.findGrantAndSessionToken({} as any, 'raw-access-token');
        expect(res).toEqual({ grant: mockGrant, sessionToken: 'sess-token-abc' });
        expect(grantRepo.findOne).toHaveBeenCalledWith({
            where: { accessTokenHash: hashLookupToken('raw-access-token', deriveHashKey('s')) },
            relations: { oauthClient: true },
        });
        expect(sessionRepo.findOne).toHaveBeenCalledWith({
            where: { id: 'sess-uuid-1' },
            select: { id: true, token: true },
        });
    });

    it('returns grant with null sessionToken when session is missing', async () => {
        const mockGrant = { id: 'grant-1', vendureSessionId: 'sess-uuid-2' };
        const grantRepo = {
            findOne: vi.fn().mockResolvedValue(mockGrant),
        };
        const sessionRepo = {
            findOne: vi.fn().mockResolvedValue(null),
        };
        const connection = {
            getRepository: vi.fn((ctx: any, entity: any) => (entity === Session ? sessionRepo : grantRepo)),
        };
        const service = createService({ oauth: { tokenSecret: 's' } }, { connection }) as any;
        const res = await service.findGrantAndSessionToken({} as any, 'raw-access-token');
        expect(res).toEqual({ grant: mockGrant, sessionToken: null });
    });

    it('returns undefined without querying Session when grant does not exist', async () => {
        const grantRepo = {
            findOne: vi.fn().mockResolvedValue(null),
        };
        const sessionRepo = {
            findOne: vi.fn(),
        };
        const connection = {
            getRepository: vi.fn((ctx: any, entity: any) => (entity === Session ? sessionRepo : grantRepo)),
        };
        const service = createService({ oauth: { tokenSecret: 's' } }, { connection }) as any;
        const res = await service.findGrantAndSessionToken({} as any, 'raw-access-token');
        expect(res).toBeUndefined();
        expect(sessionRepo.findOne).not.toHaveBeenCalled();
    });
});
