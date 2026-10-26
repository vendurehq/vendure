import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { resolveMcpPluginOptions } from '../resolve-options';
import { McpPluginOptions } from '../types';

import { McpOauthMetadataService } from './oauth-metadata.service';

const ISSUER = 'https://shop.example.com';

function createService(
    opts: { oauth?: McpPluginOptions['oauth']; shopAccess?: McpPluginOptions['shopAccess'] } = {},
): McpOauthMetadataService {
    const options: McpPluginOptions = {
        oauth: opts.oauth === undefined ? undefined : { issuer: ISSUER, ...opts.oauth },
        shopAccess: opts.shopAccess,
    };
    return new McpOauthMetadataService(resolveMcpPluginOptions(options));
}

describe('McpOauthMetadataService metadata', () => {
    it('builds RFC 8414 authorization-server metadata with a trailing-slash-trimmed issuer', () => {
        const service = createService({ oauth: { tokenSecret: 's', issuer: `${ISSUER}/` } });
        const meta = service.metadata();
        expect(meta.issuer).toBe(ISSUER);
        expect(meta.authorization_endpoint).toBe(`${ISSUER}/mcp/oauth/authorize`);
        expect(meta.token_endpoint).toBe(`${ISSUER}/mcp/oauth/token`);
        expect(meta.registration_endpoint).toBe(`${ISSUER}/mcp/oauth/register`);
        expect(meta.revocation_endpoint).toBe(`${ISSUER}/mcp/oauth/revoke`);
    });

    it('advertises only the S256 PKCE method and the none auth method', () => {
        const meta = createService({ oauth: { tokenSecret: 's' } }).metadata();
        expect(meta.code_challenge_methods_supported).toEqual(['S256']);
        expect(meta.token_endpoint_auth_methods_supported).toEqual(['none']);
        expect(meta.response_types_supported).toEqual(['code']);
        expect(meta.grant_types_supported).toEqual(['authorization_code', 'refresh_token']);
    });

    it('advertises CIMD support (client_id_metadata_document_supported)', () => {
        const meta = createService({ oauth: { tokenSecret: 's' } }).metadata();
        expect(meta.client_id_metadata_document_supported).toBe(true);
    });

    it('builds RFC 9728 protected-resource metadata per toolset', () => {
        const service = createService({ oauth: { tokenSecret: 's' } });
        expect(service.protectedResourceMetadata('shop')).toEqual({
            resource: `${ISSUER}/mcp/shop`,
            authorization_servers: [ISSUER],
            bearer_methods_supported: ['header'],
            resource_name: 'Vendure shop MCP',
        });
        expect(service.protectedResourceMetadata('admin').resource).toBe(`${ISSUER}/mcp/admin`);
    });

    it('builds the protected-resource metadata URL per toolset', () => {
        const service = createService({ oauth: { tokenSecret: 's' } });
        expect(service.protectedResourceMetadataUrl('shop')).toBe(
            `${ISSUER}/.well-known/oauth-protected-resource/mcp/shop`,
        );
        expect(service.protectedResourceMetadataUrl('admin')).toBe(
            `${ISSUER}/.well-known/oauth-protected-resource/mcp/admin`,
        );
    });

    it('throws when OAuth is not configured', () => {
        const service = createService();
        expect(() => service.metadata()).toThrow(BadRequestException);
    });

    it('404s the shop protected-resource metadata when shopAccess is disabled, but still serves admin', () => {
        const service = createService({ oauth: { tokenSecret: 's' }, shopAccess: 'disabled' });
        expect(() => service.protectedResourceMetadata('shop')).toThrow(NotFoundException);
        expect(service.protectedResourceMetadata('admin').resource).toBe(`${ISSUER}/mcp/admin`);
    });
});

describe('McpOauthMetadataService resource resolution', () => {
    // With shopAccess disabled, resolveResource must not recognise the shop resource at all —
    // an authorize request naming it fails the same way it would for any unrecognised URL.
    it('refuses the shop resource when shopAccess is disabled', () => {
        const service = createService({ oauth: { tokenSecret: 's' }, shopAccess: 'disabled' });
        expect(() => service.resolveResource(`${ISSUER}/mcp/shop`)).toThrow('Unsupported OAuth resource');
    });

    // A resource with a query string gets the specific message, not the generic
    // "Unsupported OAuth resource" — the caller needs to know which part of the URL to fix.
    it('names the query-string problem when a resource carries one', () => {
        const service = createService({ oauth: { tokenSecret: 's' } });
        expect(() => service.resolveResource(`${ISSUER}/mcp/shop?x=1`)).toThrow(
            'OAuth resource must not include query parameters or fragments',
        );
    });
});
