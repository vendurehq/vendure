import { CrudPermissionDefinition } from '@vendure/core';

import { McpLogCapture, McpRateLimitOptions } from './types';

export const MCP_PLUGIN_OPTIONS = Symbol('MCP_PLUGIN_OPTIONS');

export const loggerCtx = 'McpPlugin';

export const DEFAULT_TOOL_EXPOSURE = 'direct' as const;

export const DEFAULT_SHOP_ACCESS = 'anonymous' as const;

export const MCP_SETTINGS_NAMESPACE = 'mcp';
/** Field name registered in `settingsStoreFields` under {@link MCP_SETTINGS_NAMESPACE}. */
export const MCP_TOOL_TOGGLES_FIELD_NAME = 'tool-toggles';
/** Namespaced lookup key used with `SettingsStoreService.get/set`. */
export const MCP_TOOL_TOGGLES_STORE_KEY = `${MCP_SETTINGS_NAMESPACE}.${MCP_TOOL_TOGGLES_FIELD_NAME}`;

/**
 * JSON-RPC error code for a rate-limit refusal (handshake pre-check only).
 */
export const RATE_LIMIT_ERROR_CODE = -31029;
/** Rate-limit window in milliseconds. */
export const RATE_LIMIT_WINDOW_MS = 60_000;
/** Cache-key prefix for rate-limit buckets. */
export const RATE_LIMIT_CACHE_PREFIX = 'mcp:rate-limit';

export const mcpServerPermission = new CrudPermissionDefinition('McpServer');

/** Throttles how often a bearer-token call bumps `McpOauthGrant.lastActivityAt`. */
export const MCP_GRANT_ACTIVITY_UPDATE_INTERVAL_MS = 60_000;

/**
 * How long a registered or CIMD-resolved `McpOauthClient` is kept once created without ever
 * being used.
 */
export const MCP_UNUSED_OAUTH_CLIENT_RETENTION_MS = 24 * 60 * 60 * 1000;

/** Turns the day-valued retention options into a cutoff date. */
export const MS_PER_DAY = 86_400_000;
/** Rows deleted per statement by a retention sweep — small enough not to lock a large table. */
export const RETENTION_DELETE_BATCH_SIZE = 500;
/** Default retention window for tool-call logs, in days. */
export const DEFAULT_LOG_TTL_DAYS = 30;
/**
 * Default per-field cap on stored tool-call bodies, in bytes. Each body is stored in its own
 * MySQL `TEXT` column (65,535-byte limit), so an oversized body never fails the insert.
 */
export const DEFAULT_LOG_MAX_BODY_BYTES = 64_000;
/** Default logging capture mode. */
export const DEFAULT_LOG_CAPTURE: McpLogCapture = 'metadata';

export const DEFAULT_OAUTH_OPTIONS = {
    accessTokenTtlSeconds: 15 * 60,
    refreshTokenTtlSeconds: 30 * 24 * 60 * 60,
    authorizationCodeTtlSeconds: 60,
    authorizationRequestTtlSeconds: 10 * 60,
    adminConsentPath: '/dashboard/mcp/authorize',
    allowLoopbackCimdDocuments: false,
    grantRetentionDays: 30,
} as const;

/** The only grant types this server supports: advertised in the metadata, enforced at registration. */
export const SUPPORTED_OAUTH_GRANT_TYPES = ['authorization_code', 'refresh_token'];

/**
 * CIMD (client_id metadata document) fetch budget — draft-ietf-oauth-client-id-metadata-document-02
 * recommends a ~5 KB size cap (§8.7); the deadline covers connection plus body.
 */
export const CIMD_FETCH_TIMEOUT_MS = 5_000;
export const CIMD_MAX_DOCUMENT_BYTES = 5 * 1024;
/**
 * Length caps on the client values that are stored in columns of their own. They keep an over-long
 * value a validation error (HTTP 400) instead of a database error at insert time, because MySQL's
 * varchar columns default to 255 characters — or, for the display-only client_uri/logo_uri fields,
 * the value is dropped instead of erroring.
 */
export const CIMD_MAX_CLIENT_ID_LENGTH = 512;
/**
 * Applies to `client_name`, `client_uri`, `logo_uri` and `redirect_uri` (whichever way the
 * client identified itself), and to the authorize request's `state` parameter.
 */
export const MAX_CLIENT_METADATA_FIELD_LENGTH = 255;
/**
 * How long a fetched document is reused before it is fetched again. The draft (§5.2) leaves the
 * lifetime to the server, so this is a fixed value rather than whatever the document's own
 * Cache-Control header asks for — which also stops a hostile document demanding one outbound
 * fetch per authorization request.
 */
export const CIMD_CACHE_TTL_SECONDS = 60 * 60;

/** Hard cap on simultaneous outbound CIMD fetches, regardless of how many distinct client_id URLs ask for one. */
export const MAX_CONCURRENT_CIMD_FETCHES = 8;

/**
 * Default rate limits. The anonymous-IP and OAuth-IP limits are ON by default (60 rpm each) — they
 * are the safety backstop for the unattributable anonymous `/mcp/shop` surface and the credential-less
 * OAuth surface respectively, and are disabled only via an explicit `false`. Per-tool limits are
 * opt-in (`0` = unlimited). Four tools ship with a default cap: the two that create rows quickly,
 * and the two that take money back from a customer.
 */
export const DEFAULT_RATE_LIMIT_OPTIONS: Required<McpRateLimitOptions> = {
    perSession: { rpm: 60 },
    perUser: { rpm: 120 },
    perClient: { rpm: 3000 },
    perTool: {
        place_order: { rpm: 5 },
        create_product: { rpm: 10 },
        refund_order: { rpm: 5 },
        cancel_order: { rpm: 5 },
    },
    anonymousIp: { rpm: 60 },
    oauthIp: { rpm: 60 },
};
