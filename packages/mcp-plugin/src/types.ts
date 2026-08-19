import type { ToolAnnotations } from '@modelcontextprotocol/server';
import { type ScheduledTaskConfig } from '@vendure/core';
import { McpJsonSchema, McpToolBehavior, McpToolset } from '@vendure/mcp-sdk';

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
     * admin-scoped authorization requests. Must start with a single `/` —
     * the consent page is served by the Vendure server itself, so a full URL
     * here is refused at startup.
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
     * An expired grant's Vendure session keeps working against the ordinary GraphQL APIs until
     * this job deletes it, so a slower schedule lengthens that window. Revoking a grant deletes
     * its session at once, without waiting for this job.
     *
     * @default cron => cron.everyDayAt(3, 30)
     */
    retentionSchedule?: McpRetentionSchedule;
}

/**
 * @description
 * Per-scope request-rate limits for MCP calls, expressed in requests per minute (`rpm`).
 * A value of `0` means unlimited. Every limit except `oauthIp` is counted separately for
 * the admin and shop endpoints. The server refuses an over-limit request with HTTP `429`
 * and a `Retry-After` header. An over-limit tool call inside an open session returns an
 * `isError` tool result instead of an HTTP error.
 *
 * @docsCategory core plugins/McpPlugin
 * @since 3.8.0
 */
export interface McpRateLimitOptions {
    /**
     * @description
     * Requests per minute allowed per MCP session. A signed-in caller is counted by their
     * Vendure session. An anonymous `/mcp/shop` caller is counted by client IP instead.
     *
     * @default { rpm: 60 }
     */
    perSession?: { rpm: number };
    /**
     * @description
     * Requests per minute allowed per signed-in user, counted across every session and
     * OAuth client acting for that user. Authorizing again starts a new session and can
     * create a new client record. The user bucket keeps counting through both, because
     * the user's id does not change. Anonymous callers have no user, so `anonymousIp`
     * covers them instead.
     *
     * @default { rpm: 120 }
     */
    perUser?: { rpm: number };
    /**
     * @description
     * Requests per minute allowed per registered OAuth client, counted across every user
     * of that client. One client record can serve all of a store's shoppers, so the
     * default is sized for a whole application's traffic. `perUser` limits an individual.
     * A client identified by a metadata document URL (CIMD) gets one record per URL.
     * Requests that carry no OAuth grant, such as in-process or anonymous calls, have no
     * client bucket.
     *
     * @default { rpm: 3000 }
     */
    perClient?: { rpm: number };
    /**
     * @description
     * Requests per minute allowed per tool, keyed by tool name. `0` means unlimited.
     * Each caller has its own bucket per tool: an OAuth caller is counted by client plus
     * session, an anonymous caller by client IP. A new authorization creates a new
     * session, so its per-tool counters start fresh. The `oauthIp` limit bounds how often
     * one address can authorize again. The `perUser` limit keeps counting across
     * authorizations.
     *
     * @default { place_order: { rpm: 5 }, create_product: { rpm: 10 }, refund_order: { rpm: 5 }, cancel_order: { rpm: 5 } }
     */
    perTool?: Record<string, { rpm: number }>;
    /**
     * @description
     * Requests per minute allowed per client IP for anonymous `/mcp/shop` calls. `false`
     * disables the limit. Behind a reverse proxy, enable Vendure's `trustProxy` so
     * `req.ip` reports the client address rather than the proxy's.
     *
     * @default { rpm: 60 }
     */
    anonymousIp?: { rpm: number } | false;
    /**
     * @description
     * Requests per minute allowed per client IP across the whole OAuth HTTP surface.
     * Every route on the OAuth controller shares this one bucket, including the
     * `.well-known` metadata documents. The same limit also caps failed bearer-token
     * authentications on the MCP endpoints, in a separate bucket per IP. An address over
     * that bucket's limit is refused before its token costs a database lookup. `false`
     * disables the limit. Behind a reverse proxy, enable Vendure's `trustProxy` so
     * `req.ip` reports the client address rather than the proxy's.
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
     * Maximum byte size for stored `input` and `output` bodies (JSON-serialized, post-redaction).
     * Only applies when `capture` is `'full'`.
     *
     * Oversized values are replaced with a metadata marker (storing reason and actual size)
     * to ensure the audit row is still created.
     *
     * @default 64000 Fits safely within MySQL `TEXT` columns (65,535 byte limit).
     */
    maxBodyBytes?: number;

    /**
     * Cron-style schedule for the cleanup job that deletes expired logs.
     *
     * @default cron => cron.everyDayAt(2, 30)
     */
    retentionSchedule?: McpRetentionSchedule;

    /**
     * Stores the caller's IP address on each tool-call log row. Off by default because an IP
     * address is personal data. If your server runs behind a reverse proxy, also enable Vendure's `trustProxy` setting —
     * otherwise every row stores the proxy's address instead of the real caller's.
     *
     * @default false
     */
    captureClientIp?: boolean;
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
 * The kind of Vendure user who gave consent, recorded on an MCP OAuth grant and on the
 * authorization code it came from. Consent always requires someone signed in, so there is
 * no anonymous case here.
 */
export type McpGrantUserType = 'customer' | 'admin';

/**
 * Who a logged MCP tool call ran as. `'anonymous'` covers calls to the shop endpoint with
 * nobody signed in.
 */
export type McpActorType = McpGrantUserType | 'anonymous';

/**
 * Terminal outcome of a single MCP tool call recorded in {@link McpToolCallLog}.
 */
export type McpToolCallStatus = 'success' | 'error';
