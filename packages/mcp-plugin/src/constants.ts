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
export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_CACHE_PREFIX = 'mcp:rate-limit';

export const mcpServerPermission = new CrudPermissionDefinition('McpServer');

/** Throttles how often a bearer-token call bumps `McpOauthGrant.lastActivityAt`. */
export const MCP_GRANT_ACTIVITY_UPDATE_INTERVAL_MS = 60_000;

/** Turns the day-valued retention options into a cutoff date. */
export const MS_PER_DAY = 86_400_000;

export const MCP_UNUSED_OAUTH_CLIENT_RETENTION_MS = MS_PER_DAY;
/** Rows deleted per statement by a retention sweep — small enough not to lock a large table. */
export const RETENTION_DELETE_BATCH_SIZE = 500;
export const DEFAULT_LOG_TTL_DAYS = 30;
// MySQL's TEXT columns cap out at 65,535 bytes, so this keeps a body under that limit.
export const DEFAULT_LOG_MAX_BODY_BYTES = 64_000;
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

// CIMD (client_id metadata document) fetch budget, per the ~5 KB cap the spec recommends (§8.7).
export const CIMD_FETCH_TIMEOUT_MS = 5_000;
export const CIMD_MAX_DOCUMENT_BYTES = 5 * 1024;
// Keeps an over-long value a validation error (HTTP 400) rather than a database error at insert time.
export const CIMD_MAX_CLIENT_ID_LENGTH = 512;
// Applies to client_name, client_uri, logo_uri and redirect_uri.
export const MAX_CLIENT_METADATA_FIELD_LENGTH = 255;
// Declared separately from the client-metadata cap above so changing one doesn't change the other.
export const MAX_OAUTH_STATE_LENGTH = 255;
// A fixed lifetime rather than the document's own Cache-Control header, so a hostile document
// can't force one outbound fetch per authorization request.
export const CIMD_CACHE_TTL_SECONDS = 60 * 60;

/** Hard cap on simultaneous outbound CIMD fetches, regardless of how many distinct client_id URLs ask for one. */
export const MAX_CONCURRENT_CIMD_FETCHES = 8;

// The anonymous-IP and OAuth-IP limits are on by default as the backstop for those unauthenticated
// surfaces. Per-tool limits are opt-in, capping only the tools that create rows or refund money.
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
