import type { RequestContext } from '@vendure/core';
import type { DEFAULT_OAUTH_OPTIONS } from './constants';
import type { McpOauthGrant } from './entities/mcp-oauth-grant.entity';
import type { McpLoggingOptions, McpOauthOptions, McpPluginOptions, McpRateLimitOptions } from './types';

/**
 * Carries the Vendure request context into the execution funnel, together with the MCP OAuth
 * grant and client IP resolved for the call when the request was authenticated over OAuth.
 *
 * Server-internal only — never exposed publicly. {@link McpToolRegistryService} maps this to the
 * plain-data `McpCallerInfo` (from `@vendure/mcp-sdk`) at the point it invokes a tool's `execute`.
 */
export interface McpExecutionContext {
    ctx: RequestContext;
    grant?: McpOauthGrant;
    clientIp?: string;
}

/**
 * Result of authenticating a bearer token: the resolved `RequestContext` plus the backing MCP
 * OAuth grant record. Server-internal only.
 */
export type McpAuthenticatedContext = Required<Pick<McpExecutionContext, 'ctx' | 'grant'>>;

export type McpOauthOptionsWithDefaults = McpOauthOptions &
    Required<Pick<McpOauthOptions, keyof typeof DEFAULT_OAUTH_OPTIONS>>;

export interface ResolvedMcpLoggingOptions extends McpLoggingOptions {
    ttlDays: number;
    capture: NonNullable<McpLoggingOptions['capture']>;
    maxBodyBytes: number;
    captureClientIp: boolean;
}

/**
 * Plugin options after `resolveMcpPluginOptions` has applied every documented default.
 * Services receive this via `MCP_PLUGIN_OPTIONS` and must not re-apply defaults.
 */
export interface ResolvedMcpPluginOptions extends McpPluginOptions {
    toolExposure: NonNullable<McpPluginOptions['toolExposure']>;
    shopAccess: NonNullable<McpPluginOptions['shopAccess']>;
    oauth?: McpOauthOptionsWithDefaults;
    rateLimits: Required<McpRateLimitOptions>;
    logging: ResolvedMcpLoggingOptions;
}
