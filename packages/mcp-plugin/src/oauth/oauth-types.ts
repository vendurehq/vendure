import { McpToolset } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpOauthOptions } from '../types';

// Field names are snake_case to match the OAuth 2.1 wire contract.
export const registerClientInputSchema = z.object({
    client_name: z.string().optional(),
    client_uri: z.string().optional(),
    logo_uri: z.string().optional(),
    redirect_uris: z.array(z.string()).optional(),
    grant_types: z.array(z.string()).optional(),
    token_endpoint_auth_method: z.string().optional(),
});
export type RegisterClientInput = z.infer<typeof registerClientInputSchema>;

export const authorizeInputSchema = z.object({
    response_type: z.string().optional(),
    client_id: z.string().optional(),
    redirect_uri: z.string().optional(),
    state: z.string().optional(),
    code_challenge: z.string().optional(),
    code_challenge_method: z.string().optional(),
    resource: z.string().optional(),
});
export type AuthorizeInput = z.infer<typeof authorizeInputSchema>;

export const tokenInputSchema = z.object({
    grant_type: z.string().optional(),
    code: z.string().optional(),
    refresh_token: z.string().optional(),
    client_id: z.string().optional(),
    redirect_uri: z.string().optional(),
    code_verifier: z.string().optional(),
    resource: z.string().optional(),
});
export type TokenInput = z.infer<typeof tokenInputSchema>;

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
