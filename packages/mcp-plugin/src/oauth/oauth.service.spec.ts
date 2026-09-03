import { describe, expect, it } from 'vitest';

import { resolveMcpPluginOptions } from '../resolve-options';
import { McpPluginOptions } from '../types';

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

describe('McpOauthService OAuth credential lookup hashing', () => {
    it('hashes an OAuth credential with domain separation before storage and lookup', () => {
        const service = createService({ oauth: { tokenSecret: 'test-secret' } });
        const hashKey = deriveHashKey('test-secret');
        const storedHash = (service as any).hashLookup('plain-token');

        expect(storedHash).toBe(hashToken('lookup:plain-token', hashKey));
        expect(storedHash).not.toBe('plain-token');
    });
});
