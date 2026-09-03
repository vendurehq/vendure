import { getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/server';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { McpToolset } from '@vendure/mcp-sdk';

import { MCP_PLUGIN_OPTIONS, SUPPORTED_OAUTH_GRANT_TYPES } from '../constants';
import { ResolvedMcpPluginOptions } from '../internal-types';

import { OAUTH_ENDPOINT_PATHS } from './endpoint-paths';
import { McpOauthError } from './oauth-error';
import { resolvedOauthOptions } from './oauth-utils';

/**
 * Builds the OAuth discovery documents this server publishes, and resolves the `resource`
 * values they advertise: the RFC 8414 authorization-server metadata, the RFC 9728
 * protected-resource metadata for each toolset, and the URL those documents live at.
 */
@Injectable()
export class McpOauthMetadataService {
    constructor(@Inject(MCP_PLUGIN_OPTIONS) private options: ResolvedMcpPluginOptions) {}

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

    protectedResourceMetadata(endpoint: string) {
        if (endpoint !== 'shop' && endpoint !== 'admin') {
            throw new NotFoundException();
        }
        if (endpoint === 'shop' && this.options.shopAccess === 'disabled') {
            throw new NotFoundException();
        }
        const issuer = this.issuerOrigin();
        return {
            resource: this.resourceForToolset(endpoint),
            authorization_servers: [issuer],
            bearer_methods_supported: ['header'],
            resource_name: `Vendure ${endpoint} MCP`,
        };
    }

    protectedResourceMetadataUrl(endpoint: McpToolset): string {
        return getOAuthProtectedResourceMetadataUrl(new URL(this.resourceForToolset(endpoint)));
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
        const toolsets: readonly McpToolset[] =
            this.options.shopAccess === 'disabled' ? (['admin'] as const) : (['shop', 'admin'] as const);
        for (const toolset of toolsets) {
            if (this.sameResourceUrl(url, new URL(this.resourceForToolset(toolset)))) {
                return { resource: this.resourceForToolset(toolset), toolset };
            }
        }
        throw new McpOauthError('invalid_target', 'Unsupported OAuth resource');
    }

    private sameResourceUrl(left: URL, right: URL): boolean {
        return (
            left.protocol.toLowerCase() === right.protocol.toLowerCase() &&
            left.hostname.toLowerCase() === right.hostname.toLowerCase() &&
            left.port === right.port &&
            this.normalizeResourcePath(left.pathname) === this.normalizeResourcePath(right.pathname)
        );
    }

    private normalizeResourcePath(pathname: string): string {
        return pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
    }

    /** The configured issuer URL with any trailing slash removed. */
    private issuerOrigin(): string {
        return resolvedOauthOptions(this.options).issuer.replace(/\/$/, '');
    }

    resourceForToolset(toolset: McpToolset): string {
        return `${this.issuerOrigin()}/mcp/${toolset}`;
    }
}
