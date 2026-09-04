import type { RequestContext } from '@vendure/core';
import type { DEFAULT_OAUTH_OPTIONS } from './constants';
import type { McpOauthGrant } from './entities/mcp-oauth-grant.entity';
import type { McpLoggingOptions, McpOauthOptions, McpPluginOptions, McpRateLimitOptions } from './types';

// Server-internal only — never exposed publicly. {@link McpToolRegistryService} maps this to the
// plain-data `McpCallerInfo` (from `@vendure/mcp-sdk`) at the point it invokes a tool's `execute`.
export interface McpExecutionContext {
    ctx: RequestContext;
    grant?: McpOauthGrant;
    clientIp?: string;
}

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
