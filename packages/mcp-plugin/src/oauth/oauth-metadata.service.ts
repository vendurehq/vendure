import { getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/server';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { McpToolset } from '@vendure/mcp-sdk';

import { MCP_PLUGIN_OPTIONS, SUPPORTED_OAUTH_GRANT_TYPES } from '../constants';
import { ResolvedMcpPluginOptions } from '../internal-types';

import { OAUTH_ENDPOINT_PATHS } from './endpoint-paths';
import { McpOauthError } from './oauth-error';
import { resolvedOauthOptions } from './oauth-utils';

/** Builds the RFC 8414 and RFC 9728 OAuth discovery documents this server publishes. */
@Injectable()
export class McpOauthMetadataService {
    constructor(@Inject(MCP_PLUGIN_OPTIONS) private readonly options: ResolvedMcpPluginOptions) {}

    metadata() {
        const issuer = this.issuerOrigin();
        return {
            issuer,
            authorization_endpoint: `${issuer}/${OAUTH_ENDPOINT_PATHS.authorize}`,
            token_endpoint: `${issuer}/${OAUTH_ENDPOINT_PATHS.token}`,
            registration_endpoint: `${issuer}/${OAUTH_ENDPOINT_PATHS.register}`,
            revocation_endpoint: `${issuer}/${OAUTH_ENDPOINT_PATHS.revoke}`,
            response_types_supported: ['code'],
            grant_types_supported: SUPPORTED_OAUTH_GRANT_TYPES,
            code_challenge_methods_supported: ['S256'],
            token_endpoint_auth_methods_supported: ['none'],
            // CIMD (draft-ietf-oauth-client-id-metadata-document §6): clients check this
            // flag before sending a URL client_id, so it must be present because we support it.
            client_id_metadata_document_supported: true,
        };
    }

    protectedResourceMetadata(toolsetParam: string) {
        if (toolsetParam !== 'shop' && toolsetParam !== 'admin') {
            throw new NotFoundException();
        }
        if (!this.availableToolsets().includes(toolsetParam)) {
            throw new NotFoundException();
        }
        const issuer = this.issuerOrigin();
        return {
            resource: this.resourceForToolset(toolsetParam),
            authorization_servers: [issuer],
            bearer_methods_supported: ['header'],
            resource_name: `Vendure ${toolsetParam} MCP`,
        };
    }

    protectedResourceMetadataUrl(toolset: McpToolset): string {
        return getOAuthProtectedResourceMetadataUrl(new URL(this.resourceForToolset(toolset)));
    }

    resolveResource(resource?: string): { resource: string; toolset: McpToolset } {
        if (!resource) {
            throw new McpOauthError('invalid_target', 'resource is required');
        }
        let url: URL;
        try {
            url = new URL(resource);
        } catch {
            throw new McpOauthError('invalid_target', 'Unsupported OAuth resource');
        }
        if (url.search || url.hash) {
            throw new McpOauthError(
                'invalid_target',
                'OAuth resource must not include query parameters or fragments',
            );
        }
        const wanted = comparableResource(url);
        for (const toolset of this.availableToolsets()) {
            const candidate = this.resourceForToolset(toolset);
            if (comparableResource(new URL(candidate)) === wanted) {
                return { resource: candidate, toolset };
            }
        }
        throw new McpOauthError('invalid_target', 'Unsupported OAuth resource');
    }

    /** Shop is not a valid toolset when shop access is switched off. */
    private availableToolsets(): McpToolset[] {
        return this.options.shopAccess === 'disabled' ? ['admin'] : ['shop', 'admin'];
    }

    private issuerOrigin(): string {
        return resolvedOauthOptions(this.options).issuer.replace(/\/$/, '');
    }

    resourceForToolset(toolset: McpToolset): string {
        return `${this.issuerOrigin()}/mcp/${toolset}`;
    }
}

/** Origin plus path with a trailing slash removed, so two spellings of one resource compare equal. */
function comparableResource(url: URL): string {
    const path = url.pathname.length > 1 ? url.pathname.replace(/\/$/, '') : url.pathname;
    return `${url.origin}${path}`;
}
