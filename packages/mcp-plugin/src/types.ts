import type { StandardSchemaWithJSON, ToolAnnotations } from '@modelcontextprotocol/server';
import { type ScheduledTaskConfig } from '@vendure/core';
import {
    McpJsonSchema,
    McpToolBehavior,
    McpToolHandler,
    McpToolMetadata,
    McpToolset,
} from '@vendure/mcp-sdk';

/**
 * @description
 * Controls which tools are returned by the MCP `tools/list` call.
 *
 * - `discovery` exposes a small, stable set of meta-tools (`search_tools` and
 *   `execute_tool`) that let an agent search for registered Vendure tools
 *   (results ranked by keyword relevance) and execute them by name.
 * - `direct` exposes every callable Vendure tool directly to the agent.
 *
 * @docsCategory core plugins/McpPlugin
 * @since 3.8.0
 */
export type McpToolExposureMode = 'direct' | 'discovery';

/**
 * @description
 * OAuth-related options for {@link McpPlugin}.
 *
 * @docsCategory core plugins/McpPlugin
 * @since 3.8.0
 */
export interface McpOauthOptions {
    /**
     * @description
     * Server secret used to HMAC-hash OAuth tokens at rest. Required to enable OAuth.
     * Must be supplied via an environment variable. Generate it once via `openssl rand -base64 32`.
     *
     * Rotating this secret invalidates all active OAuth tokens, forcing clients to re-authorize.
     * The Vendure sessions behind existing grants cannot be reached through the old tokens; the
     * retention task deletes them once their grants expire.
     */
    tokenSecret: string;
    /**
     * @description
     * The public URL of your Vendure server, e.g. `https://shop.example.com`. OAuth
     * clients use it to find this server's login and token endpoints.
     *
     * It must be just `https://` plus the host (and port if needed) — no path, or the
     * server refuses to start: clients fetch the server's OAuth info at fixed
     * `/.well-known/...` addresses directly under the host, so a path here would point
     * them at addresses that don't exist. If a proxy serves Vendure under a path, use a
     * subdomain instead, or forward `/.well-known/*` to Vendure too.
     *
     * When unset, it defaults to `http://localhost:<port>` using the port your server is
     * configured with (`apiOptions.port`), so local development needs no configuration.
     *
     * @default 'http://localhost:<apiOptions.port>'
     */
    issuer?: string;
    /**
     * @description
     * Lifetime of an issued access token, in seconds.
     *
     * @default 900
     */
    accessTokenTtlSeconds?: number;
    /**
     * @description
     * Lifetime of an issued refresh token, in seconds. Every refresh resets it, so in
     * practice this is how long a client may go without refreshing before its grant dies
     * and the retention task deletes the Vendure session behind it. Refreshing rotates
     * the OAuth token pair only; it never replaces that session.
     *
     * @default 2592000
     */
    refreshTokenTtlSeconds?: number;
    /**
     * @description
     * Lifetime of an authorization code before it must be exchanged, in seconds.
     *
     * @default 60
     */
    authorizationCodeTtlSeconds?: number;
    /**
     * @description
     * Lifetime of a pending authorization request (consent window), in seconds.
     *
     * @default 600
     */
    authorizationRequestTtlSeconds?: number;
    /**
     * @description
     * Path (relative to `issuer`) of the admin consent page that approves
     * admin-scoped authorization requests.
     *
     * @default '/dashboard/mcp/authorize'
     */
    adminConsentPath?: string;
    /**
     * @description
     * Absolute URL of the storefront consent page that approves customer-scoped
     * authorization requests. Required only if you want customers to authorize MCP
     * clients; a deployment that uses the admin toolset alone does not need it.
     */
    storefrontConsentUrl?: string;
    /**
     * @description
     * Allows a client to identify itself with a `client_id` URL that points at the local machine
     * (`localhost`, `127.0.0.1` or `::1`), over plain HTTP, so that a metadata document served by
     * your own development setup can be fetched.
     *
     * Leave this off anywhere reachable by others. With it on, anyone who can reach the authorize
     * endpoint — no credentials needed — can make the server open a connection to any port on the
     * machine it runs on. The server refuses to start with this enabled when `NODE_ENV` is
     * `production`.
     *
     * @default false
     */
    allowLoopbackCimdDocuments?: boolean;
    /**
     * @description
     * How long to keep a grant after it dies, by expiry or revocation, before the row itself is
     * deleted. The grant is the only OAuth record with anything to audit, so it outlives the
     * authorization it recorded.
     *
     * Each tool-call log references the grant it was made under, and that link is nulled when the
     * grant is deleted. Set this at or above {@link McpLoggingOptions.ttlDays} if every retained
     * log should still be able to resolve its grant.
     *
     * @default 30 (days)
     */
    grantRetentionDays?: number;
    /**
     * @description
     * Schedule for the cleanup job that prunes OAuth records which can no longer be used: the
     * Vendure session created for each expired grant, expired authorization requests and
     * codes, and grants dead for longer than `grantRetentionDays`.
     *
     * @default cron => cron.everyDayAt(3, 30)
     */
    retentionSchedule?: McpRetentionSchedule;
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

/**
 * @description
 * Per-scope request-rate limits for MCP calls, expressed in requests per minute (`rpm`).
 * A value of `0` means unlimited.
 *
 * @docsCategory core plugins/McpPlugin
 * @since 3.8.0
 */
export interface McpRateLimitOptions {
    /**
     * Limit per MCP session: for logged-in users, this is their session.
     * For anonymous `/mcp/shop` calls, it falls back to the client IP.
     *
     * @default { rpm: 60 }
     */
    perSession?: { rpm: number };
    /**
     * Limit per registered OAuth client.
     *
     * @default { rpm: 120 }
     */
    perClient?: { rpm: number };
    /**
     * Opt-in per-tool limits, keyed by tool name (`0` = unlimited).
     *
     * @default { place_order: { rpm: 5 }, create_product: { rpm: 10 } }
     */
    perTool?: Record<string, { rpm: number }>;
    /**
     * Limit per client IP for anonymous `/mcp/shop` calls
     *
     * Behind a reverse proxy, enable Vendure's `trustProxy` so `req.ip` reports the client
     * address rather than the proxy's.
     *
     * @default { rpm: 60 }
     */
    anonymousIp?: { rpm: number } | false;
    /**
     * Limit per client IP across the whole OAuth HTTP surface: every route on the OAuth
     * controller shares this one bucket, including the `.well-known` metadata documents.
     *
     * Behind a reverse proxy, enable Vendure's `trustProxy` so `req.ip` reports the client
     * address rather than the proxy's.
     *
     * @default { rpm: 60 }
     */
    oauthIp?: { rpm: number } | false;
}

/**
 * @description
 * DNS-rebinding protection for the MCP transport. When `allowedHosts`/`allowedOrigins` are
 * provided, requests whose `Host`/`Origin` header is not in the list are rejected before the
 * MCP handler runs. When omitted, the guard is not applied.
 *
 * @docsCategory core plugins/McpPlugin
 * @since 3.8.0
 */
export interface McpDnsRebindingOptions {
    allowedHosts?: string[];
    allowedOrigins?: string[];
}

export type McpRetentionSchedule = Exclude<ScheduledTaskConfig['schedule'], string>;

/** How much of each MCP tool call {@link McpLoggingOptions.capture} persists. */
export type McpLogCapture = 'metadata' | 'full';

/**
 * @description
 * Operator-supplied redaction for {@link McpLoggingOptions.redact}.
 *
 * @docsCategory core plugins/McpPlugin
 * @since 3.8.0
 */
export type McpLogRedactFn = (entry: { toolName: string; input: unknown; output: unknown }) => {
    input: unknown;
    output: unknown;
};

/**
 * @description
 * Controls how MCP tool calls are logged and retained. Every call is recorded as an
 * {@link McpToolCallLog} row and published as an `McpToolCallEvent`.
 *
 * @docsCategory core plugins/McpPlugin
 * @since 3.8.0
 */
export interface McpLoggingOptions {
    /**
     * How long to keep tool-call logs before they are automatically deleted.
     *
     * @default 30 (days)
     */
    ttlDays?: number;

    /**
     * Controls how much data from each tool call is stored.
     *
     * - `'metadata'`: Stores only high-level info (tool name, actor, status, duration, IDs).
     *
     * - `'full'`: Also stores the full `input` and `output` of each call.
     *   This may include sensitive data. Provide `redact` to sanitize it,
     *   otherwise data is stored as-is.
     *
     * @default 'metadata'
     */
    capture?: McpLogCapture;

    /**
     * Optional function to sanitize a call's `input` and `output`
     * before they are stored. Only applies when `capture` is `'full'`.
     * If this function throws, the call is still recorded but with `input` and `output`
     * set to `null`, and a warning is logged.
     *
     * @example
     * ```ts
     * redact: ({ input, output }) => ({
     *   input,
     *   output: { ...output, customer: undefined }
     * })
     * ```
     */
    redact?: McpLogRedactFn;

    /**
     * Cron-style schedule for the cleanup job that deletes expired logs.
     *
     * @default cron => cron.everyDayAt(2, 30)
     */
    retentionSchedule?: McpRetentionSchedule;
}

/**
 * @description
 * Options passed to {@link McpPlugin.init}.
 *
 * @docsCategory core plugins/McpPlugin
 * @since 3.8.0
 */
export interface McpPluginOptions {
    /**
     * Controls which tools are returned by the MCP `tools/list` call.
     * See {@link McpToolExposureMode} for the available modes.
     *
     * @default 'direct'
     */
    toolExposure?: McpToolExposureMode;
    /**
     * @description
     * Controls HTTP access to the `/mcp/shop` endpoint and the shop toolset.
     *
     * - `'anonymous'` (default): the endpoint accepts anonymous callers as well as
     *   OAuth-authenticated customers.
     * - `'authenticated'`: the endpoint requires an OAuth Bearer token. Token-less
     *   requests receive a 401 with the standard auth challenge.
     * - `'disabled'`: the endpoint responds 404 and customer OAuth authorization
     *   requests are refused.
     *
     * In-process tool execution via {@link McpToolExecutionService} is not affected.
     *
     * @default 'anonymous'
     */
    shopAccess?: 'disabled' | 'authenticated' | 'anonymous';
    /**
     * @description
     * OAuth options. When omitted, the OAuth surface is disabled.
     */
    oauth?: McpOauthOptions;
    /**
     * @description
     * Per-scope request-rate limits. Sensible defaults apply when omitted; see
     * {@link McpRateLimitOptions}.
     */
    rateLimits?: McpRateLimitOptions;
    /**
     * @description
     * DNS-rebinding protection for the MCP transport. See {@link McpDnsRebindingOptions}.
     */
    dnsRebinding?: McpDnsRebindingOptions;
    /**
     * @description
     * Tool-call logging and retention. Sensible defaults apply when omitted; see
     * {@link McpLoggingOptions}.
     */
    logging?: McpLoggingOptions;
}

/**
 * @description
 * A tool as described to a caller, carrying everything a model needs to decide whether to call it.
 * Returned by {@link McpToolExecutionService.listTools} and by the `search_tools` discovery meta-tool.
 *
 * @docsCategory core plugins/McpPlugin
 * @since 3.8.0
 */
export interface McpToolSummary {
    name: string;
    title?: string;
    description: string;
    toolset: McpToolset;
    behavior: McpToolBehavior;
    annotations: ToolAnnotations;
    /**
     * The input schema a call must satisfy: the tool's declared schema plus, for a destructive
     * tool, the optional `confirm` field the registry injects.
     */
    inputSchema: McpJsonSchema;
}

/**
 * Identifies the type of Vendure actor (user) associated with an MCP OAuth grant.
 */
export type McpActorType = 'customer' | 'admin' | 'anonymous';

/**
 * Terminal outcome of a single MCP tool call recorded in {@link McpToolCallLog}.
 */
export type McpToolCallStatus = 'success' | 'error';

/**
 * @description
 * A discovered `@McpTool` provider, enriched by the registry at bootstrap. This is the registry's
 * single source of truth, consumed by the transport factory and the admin API.
 */
export interface McpRegisteredTool extends McpToolMetadata {
    /** The discovered provider instance (implements `execute`). */
    handler: McpToolHandler;
    /** Name of the Nest module/host that declared the provider. */
    pluginSource: string;
    /** The tool's `behavior`, defaulting to `mutating` when not declared. */
    resolvedBehavior: McpToolBehavior;
    /** MCP annotations derived from behavior; surfaced to the agent in `tools/list` and `search_tools`. */
    annotations: ToolAnnotations;
    /**
     * The canonical input schema (single source of truth). Derived once at discovery: the tool's
     * `inputSchema`, or the no-args default when none is declared. Never mutated — the destructive
     * `confirm` field is injected onto a clone (see the wire schema below).
     */
    jsonInputSchema: McpJsonSchema;
    /**
     * Compiled validator for the WIRE input schema (canonical schema plus the injected optional
     * `confirm` field for destructive tools). Compiled once at bootstrap; registered with the SDK
     * per request and reused for discovery-path (`execute_tool`) inner-argument validation.
     */
    compiledInputSchema: StandardSchemaWithJSON;
    /**
     * The WIRE input schema: the canonical schema plus, for destructive tools, the injected
     * optional `confirm` field. This is what is registered with the SDK and advertised in tool
     * summaries — the schema a call must actually satisfy. For non-destructive tools it is the
     * same object as `jsonInputSchema`.
     */
    wireJsonSchema: McpJsonSchema;
    /** The declared output schema, if any (drives output-drift logging). */
    jsonOutputSchema?: McpJsonSchema;
    /** Compiled validator for the declared output schema, if any. */
    compiledOutputSchema?: StandardSchemaWithJSON;
}

/**
 * @description
 * A tool as handed to the per-request transport for registration with the MCP server: exactly the
 * fields the SDK registration call needs. Real tools satisfy it as-is; the discovery meta-tools
 * (`search_tools` / `execute_tool`) are built directly in this shape, since they have no handler
 * of their own (they are routed by name in `callTool`) and belong to no single toolset.
 */
export type McpExposedTool = Pick<
    McpRegisteredTool,
    'name' | 'title' | 'description' | 'compiledInputSchema' | 'annotations'
>;
