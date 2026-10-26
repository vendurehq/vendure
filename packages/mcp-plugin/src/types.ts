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
     * Server secret used to HMAC-hash OAuth tokens at rest. Required to enable OAuth. Supply it via
     * an environment variable, generated once with `openssl rand -base64 32`.
     *
     * Rotating this secret invalidates all active OAuth tokens, forcing clients to re-authorize.
     * The Vendure sessions behind existing grants become unreachable; the retention task deletes
     * them once their grants expire.
     */
    tokenSecret: string;
    /**
     * @description
     * The public origin of this Vendure server, such as `https://shop.example.com`. OAuth clients
     * read this server's login and token endpoints from `/.well-known/...` directly under it, so
     * it must be a scheme and host with no path. The server refuses to start otherwise. If a
     * proxy serves Vendure under a path, use a subdomain or forward `/.well-known/*` to Vendure.
     *
     * @default 'http://localhost:<apiOptions.port>'
     */
    issuer?: string;
    /**
     * @default 900
     */
    accessTokenTtlSeconds?: number;
    /**
     * @description
     * Every refresh resets this clock, so what it really sets is how long a client may go
     * quiet before its grant dies and the cleanup job deletes the Vendure session behind it.
     *
     * @default 2592000
     */
    refreshTokenTtlSeconds?: number;
    /**
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
     * admin-scoped authorization requests. Must start with a single `/`. The Vendure
     * server serves this page itself, so a full URL here is refused at startup.
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
     * (`localhost`, `127.0.0.1` or `::1`) over plain HTTP, so a metadata document served by your
     * own development setup can be fetched.
     *
     * Leave this off anywhere reachable by others: with it on, anyone who can reach the authorize
     * endpoint can make the server open a connection, with no credentials, to any port on the
     * machine it runs on. The server refuses to start with this enabled when `NODE_ENV` is
     * `production`.
     *
     * @default false
     */
    allowLoopbackCimdDocuments?: boolean;
    /**
     * @description
     * How long a dead grant, expired or revoked, is kept before the row is deleted. It is the
     * only OAuth record worth auditing, so it outlives the rest.
     *
     * Deleting a grant also clears the link from every tool-call log that points at it. Set this
     * at or above {@link McpLoggingOptions.ttlDays} if your logs should keep that link.
     *
     * Must be non-negative. Set to `0` to retain dead grants forever.
     *
     * @default 30 (days)
     */
    grantRetentionDays?: number;
    /**
     * @description
     * When the cleanup job runs. It clears out expired authorization requests and codes, grants
     * dead for longer than `grantRetentionDays`, and the Vendure session behind each expired
     * grant. That grant keeps working against the ordinary GraphQL APIs until then, so running
     * the job less often widens that gap. Revoking a grant kills its session at once.
     *
     * @default cron => cron.everyDayAt(3, 30)
     */
    retentionSchedule?: McpRetentionSchedule;
}

/**
 * @description
 * Per-scope request-rate limits for MCP calls, expressed in requests per minute (`rpm`). A value
 * of `0` means unlimited. Every limit except `oauthIp` is counted separately for the admin and
 * shop endpoints. An over-limit request is refused with HTTP `429` and a `Retry-After` header,
 * except an over-limit tool call inside an open session, which returns an `isError` tool result
 * instead.
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
     * Requests per minute allowed per signed-in user, counted across every session and OAuth
     * client acting for that user. Authorizing again can start a new session and client record,
     * but the user bucket keeps counting through both, since the user's id does not change.
     * Anonymous callers have no user, so `anonymousIp` covers them instead.
     *
     * @default { rpm: 120 }
     */
    perUser?: { rpm: number };
    /**
     * @description
     * Requests per minute allowed per registered OAuth client, counted across every user of that
     * client. One client record can serve all of a store's shoppers, so the default is sized for a
     * whole application's traffic. `perUser` limits an individual instead. A client identified by
     * a metadata document URL (CIMD) gets one record per URL. Requests with no OAuth grant, such as
     * in-process or anonymous calls, have no client bucket.
     *
     * @default { rpm: 3000 }
     */
    perClient?: { rpm: number };
    /**
     * @description
     * Requests per minute allowed per tool, keyed by tool name. `0` means unlimited. Each caller
     * has its own bucket per tool: an OAuth caller is counted by client plus session, an anonymous
     * caller by client IP. A new authorization creates a new session, so its per-tool counters
     * start fresh. `oauthIp` bounds how often one address can re-authorize, while `perUser` keeps
     * counting across authorizations.
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
     * Requests per minute allowed per client IP across the whole OAuth HTTP surface. Every route
     * on the OAuth controller shares this one bucket, including the `.well-known` metadata
     * documents. The same limit also caps failed bearer-token authentications on the MCP
     * endpoints, in a separate per-IP bucket, so an address over its limit is refused before its
     * token costs a database lookup. `false` disables the limit. Behind a reverse proxy, enable
     * Vendure's `trustProxy` so `req.ip` reports the client address rather than the proxy's.
     *
     * @default { rpm: 60 }
     */
    oauthIp?: { rpm: number } | false;
}

/**
 * @description
 * Protects the MCP transport against DNS rebinding. Both options take bare hostnames, never
 * full URLs or header values. Omitting an option, or giving it an empty array, applies no
 * check at all.
 *
 * @docsCategory core plugins/McpPlugin
 * @since 3.8.0
 */
export interface McpDnsRebindingOptions {
    /**
     * @description
     * Hostnames the `Host` header of an MCP request may name. Drop the port, and bracket an
     * IPv6 address, for example `[::1]`. A request naming any other host is refused with HTTP
     * `403` before the MCP handler runs.
     */
    allowedHosts?: string[];
    /**
     * @description
     * Hostnames the `Origin` header of an MCP request may name. Drop the scheme and the port, and
     * bracket an IPv6 address, for example `[::1]`. A request naming any other origin is refused
     * with HTTP `403` before the MCP handler runs.
     *
     * A request with no `Origin` header passes, since non-browser MCP clients don't send one, so
     * this option constrains browsers only, not every caller.
     */
    allowedOrigins?: string[];
}

export type McpRetentionSchedule = ScheduledTaskConfig['schedule'];

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
 * Controls how MCP tool calls are logged and retained. Every call that runs a tool is recorded as
 * an {@link McpToolCallLog} row and published as an `McpToolCallEvent`. Calls refused before the
 * tool runs, such as an unknown or switched-off tool, invalid arguments, a missing permission, or
 * a rate limit, leave no row and no event. So does the confirmation preview of a destructive tool.
 *
 * @docsCategory core plugins/McpPlugin
 * @since 3.8.0
 */
export interface McpLoggingOptions {
    /**
     * @description
     * How many days to retain tool-call logs. Must be non-negative. Set to `0` to retain all logs.
     *
     * @default 30 (days)
     */
    ttlDays?: number;

    /**
     * @description
     * How much of each tool call is stored on its log row. `metadata` stores the tool name, the
     * actor, the status, the duration and the related IDs. `full` also stores the call's `input`
     * and `output`, which may hold personal data. Supply `redact` to sanitize those, and see
     * `maxBodyBytes` for the size cap applied to each.
     *
     * @default 'metadata'
     */
    capture?: McpLogCapture;

    /**
     * @description
     * Function that rewrites a call's `input` and `output` before they are stored. Runs only
     * when `capture` is `'full'`. If it throws, the call is still recorded, both bodies are
     * stored as `null`, and a warning is logged.
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
     * @description
     * The largest `input` or `output` body stored on a log row, in bytes, measured after redaction
     * and JSON serialization. Applies only when `capture` is `'full'`. A larger body is replaced
     * with a marker recording the reason and the real size, so the audit row is still written. The
     * default fits within the 65,535-byte limit of a MySQL `TEXT` column.
     *
     * @default 64000
     */
    maxBodyBytes?: number;

    /**
     * @description
     * Schedule for the cleanup job that deletes expired tool-call logs. Accepts a cron
     * expression string, or a function that builds one.
     *
     * @default cron => cron.everyDayAt(2, 30)
     */
    retentionSchedule?: McpRetentionSchedule;

    /**
     * @description
     * Whether each tool-call log row stores the caller's IP address. Off by default because an
     * IP address is personal data. Behind a reverse proxy, enable Vendure's `trustProxy` so the
     * stored address is the caller's rather than the proxy's.
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
     * @description
     * Which tools the MCP `tools/list` call returns. See {@link McpToolExposureMode} for the
     * available modes. In-process listing through {@link McpToolExecutionService} always lists
     * the real tools and ignores this.
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
     * Leave this out and the anonymous shop endpoint still works, but anything needing a token
     * fails with `400 MCP OAuth is not configured`. That covers the admin endpoint, the
     * authenticated shop endpoint, and the OAuth endpoints themselves.
     */
    oauth?: McpOauthOptions;
    rateLimits?: McpRateLimitOptions;
    dnsRebinding?: McpDnsRebindingOptions;
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
    /**
     * @description
     * The tool's unique snake_case name within its toolset, e.g. `search_products`.
     */
    name: string;
    /**
     * @description
     * Human-readable title declared by the tool. The same value is copied onto
     * `annotations.title`.
     */
    title?: string;
    /**
     * @description
     * What the tool does, written for an AI agent to read.
     */
    description: string;
    /**
     * @description
     * Which Vendure API the tool works over: `shop` for the Shop API, `admin` for the Admin API.
     */
    toolset: McpToolset;
    /**
     * @description
     * What the tool does to data: `readonly` only reads it, `mutating` changes it, and
     * `destructive` changes it and needs a confirmation round-trip before running.
     */
    behavior: McpToolBehavior;
    /**
     * @description
     * MCP annotations derived from `behavior`. `readOnlyHint` and `idempotentHint` are true for
     * a `readonly` tool. `destructiveHint` is true for a `destructive` tool.
     */
    annotations: ToolAnnotations;
    /**
     * @description
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
