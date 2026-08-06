import type { RequestContext } from '@vendure/core';
import type { McpOauthGrant } from './entities/mcp-oauth-grant.entity';

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
