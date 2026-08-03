import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_OAUTH_OPTIONS } from '../constants';
import { McpPluginOptions } from '../types';

import { McpOauthService } from './oauth.service';
import { deriveHashKey, hashToken } from './token-hash';

const ISSUER = 'https://shop.example.com';

function createService(oauth?: McpPluginOptions['oauth']): McpOauthService {
    const options: McpPluginOptions = {
        oauth: oauth === undefined ? undefined : { ...DEFAULT_OAUTH_OPTIONS, issuer: ISSUER, ...oauth },
    };
    // The methods exercised here validate input / read options before touching any
    // injected dependency, so the DB/session deps can be omitted.
    return new McpOauthService(
        undefined as any,
        undefined as any,
        undefined as any,
        undefined as any,
        undefined as any,
        { authOptions: { sessionCacheStrategy: { delete: vi.fn() } } } as any,
        options,
    );
}

describe('McpOauthService metadata', () => {
    it('builds RFC 8414 authorization-server metadata with a trailing-slash-trimmed issuer', () => {
        const service = createService({ tokenSecret: 's', issuer: `${ISSUER}/` });
        const meta = service.metadata();
        expect(meta.issuer).toBe(ISSUER);
        expect(meta.authorization_endpoint).toBe(`${ISSUER}/mcp/oauth/authorize`);
        expect(meta.token_endpoint).toBe(`${ISSUER}/mcp/oauth/token`);
        expect(meta.registration_endpoint).toBe(`${ISSUER}/mcp/oauth/register`);
        expect(meta.revocation_endpoint).toBe(`${ISSUER}/mcp/oauth/revoke`);
    });

    it('advertises only the S256 PKCE method and the none auth method', () => {
        const meta = createService({ tokenSecret: 's' }).metadata();
        expect(meta.code_challenge_methods_supported).toEqual(['S256']);
        expect(meta.token_endpoint_auth_methods_supported).toEqual(['none']);
        expect(meta.response_types_supported).toEqual(['code']);
        expect(meta.grant_types_supported).toEqual(['authorization_code', 'refresh_token']);
    });

    it('builds RFC 9728 protected-resource metadata per toolset', () => {
        const service = createService({ tokenSecret: 's' });
        expect(service.protectedResourceMetadata('shop')).toEqual({
            resource: `${ISSUER}/mcp/shop`,
            authorization_servers: [ISSUER],
            bearer_methods_supported: ['header'],
            resource_name: 'Vendure shop MCP',
        });
        expect(service.protectedResourceMetadata('admin').resource).toBe(`${ISSUER}/mcp/admin`);
    });

    // Pins the document exactly as clients receive it — the field list, their order, and the
    // absence of any key we do not advertise. Serving a key with an `undefined` value (which
    // JSON drops but `Object.keys` still shows) or reordering the fields both fail here.
    it('serves the protected-resource document with exactly the fields it advertises', () => {
        const service = createService({ tokenSecret: 's' });
        const document = service.protectedResourceMetadata('admin');
        expect(Object.keys(document)).toEqual([
            'resource',
            'authorization_servers',
            'bearer_methods_supported',
            'resource_name',
        ]);
        expect(JSON.stringify(document)).toBe(
            JSON.stringify({
                resource: `${ISSUER}/mcp/admin`,
                authorization_servers: [ISSUER],
                bearer_methods_supported: ['header'],
                resource_name: 'Vendure admin MCP',
            }),
        );
    });

    it('builds the protected-resource metadata URL per toolset', () => {
        const service = createService({ tokenSecret: 's' });
        expect(service.protectedResourceMetadataUrl('shop')).toBe(
            `${ISSUER}/.well-known/oauth-protected-resource/mcp/shop`,
        );
        expect(service.protectedResourceMetadataUrl('admin')).toBe(
            `${ISSUER}/.well-known/oauth-protected-resource/mcp/admin`,
        );
    });

    it('throws when OAuth is not configured', () => {
        const service = createService(undefined);
        expect(() => service.metadata()).toThrow(BadRequestException);
    });
});

describe('McpOauthService PKCE / grant gating', () => {
    it('rejects a non-code response_type', async () => {
        const service = createService({ tokenSecret: 's' });
        await expect(
            service.createAuthorizationRedirect({
                response_type: 'token',
                client_id: 'c',
                redirect_uri: 'https://x/cb',
                code_challenge: 'abc',
                code_challenge_method: 'S256',
            }),
        ).rejects.toThrow('Only response_type=code is supported');
    });

    it('rejects a plain PKCE code_challenge_method (S256 only)', async () => {
        const service = createService({ tokenSecret: 's' });
        await expect(
            service.createAuthorizationRedirect({
                response_type: 'code',
                client_id: 'c',
                redirect_uri: 'https://x/cb',
                code_challenge: 'abc',
                code_challenge_method: 'plain',
            }),
        ).rejects.toThrow('Only PKCE S256 is supported');
    });

    it('rejects an unsupported grant_type at the token endpoint', async () => {
        const service = createService({ tokenSecret: 's' });
        await expect(service.exchangeToken({ grant_type: 'password' })).rejects.toThrow(
            'Unsupported grant_type',
        );
    });
});

describe('McpOauthService OAuth credential lookup hashing', () => {
    it('hashes an OAuth credential with domain separation before storage and lookup', () => {
        const service = createService({ tokenSecret: 'test-secret' });
        const hashKey = deriveHashKey('test-secret');
        const storedHash = (service as any).hashLookup('plain-token');

        expect(storedHash).toBe(hashToken('lookup:plain-token', hashKey));
        expect(storedHash).not.toBe('plain-token');
    });
});
