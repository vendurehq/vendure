import { McpToolset } from '@vendure/mcp-sdk';

import { McpOauthOptions } from '../types';

// Request and response shapes for the MCP OAuth HTTP endpoints. Field names are
// snake_case to match the OAuth 2.1 wire contract. Shared by McpOauthService and the
// OAuth HTTP controller.

export interface RegisterClientInput {
    client_name?: string;
    client_uri?: string;
    logo_uri?: string;
    redirect_uris?: string[];
    grant_types?: string[];
    token_endpoint_auth_method?: string;
}

export interface AuthorizeInput {
    response_type?: string;
    client_id?: string;
    redirect_uri?: string;
    state?: string;
    code_challenge?: string;
    code_challenge_method?: string;
    resource?: string;
}

export interface TokenInput {
    grant_type?: string;
    code?: string;
    refresh_token?: string;
    client_id?: string;
    redirect_uri?: string;
    code_verifier?: string;
    resource?: string;
}

export interface AuthorizationRequestInfo {
    client_id: string;
    /**
     * How the client's identity was established: 'cimd' when the client_id is a URL whose
     * metadata document was fetched and validated (its hostname is verifiable), 'dcr' for
     * Dynamic Client Registration (all fields self-asserted).
     */
    client_id_source: 'cimd' | 'dcr';
    client_name: string;
    client_uri?: string;
    logo_uri?: string;
    redirect_uri: string;
    resource: string;
    toolset: McpToolset;
}

export interface RegisteredClientResponse {
    client_id: string;
    client_name: string;
    client_uri?: string;
    logo_uri?: string;
    redirect_uris: string[];
    grant_types: string[];
    token_endpoint_auth_method: string;
}

export interface OAuthTokenResponse {
    access_token: string;
    refresh_token: string;
    token_type: 'Bearer';
    expires_in: number;
}

/**
 * OAuth options with all optional fields resolved to their defaults. Built by
 * {@link McpPlugin.init} and consumed by the internal `McpOauthService`. The retention schedule
 * is excluded: it configures a scheduled task, not the runtime behaviour of the OAuth server, and
 * its default lives in the task itself.
 */
export type ResolvedMcpOauthOptions = Required<
    Omit<McpOauthOptions, 'retentionSchedule' | 'storefrontConsentUrl'>
> &
    Pick<McpOauthOptions, 'retentionSchedule' | 'storefrontConsentUrl'>;
