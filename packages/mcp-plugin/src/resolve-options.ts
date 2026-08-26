import {
    DEFAULT_LOG_CAPTURE,
    DEFAULT_LOG_MAX_BODY_BYTES,
    DEFAULT_LOG_TTL_DAYS,
    DEFAULT_OAUTH_OPTIONS,
    DEFAULT_RATE_LIMIT_OPTIONS,
    DEFAULT_SHOP_ACCESS,
    DEFAULT_TOOL_EXPOSURE,
} from './constants';
import { ResolvedMcpPluginOptions } from './internal-types';
import { McpPluginOptions, McpRateLimitOptions } from './types';

/**
 * Applies every documented option default. The one exception is `oauth.issuer`, which the
 * plugin's `configuration` hook defaults later because it needs the configured API port.
 */
export function resolveMcpPluginOptions(options: McpPluginOptions = {}): ResolvedMcpPluginOptions {
    const oauth = options.oauth && { ...DEFAULT_OAUTH_OPTIONS, ...options.oauth };
    const ttlDays = options.logging?.ttlDays ?? DEFAULT_LOG_TTL_DAYS;
    assertRetentionDays('logging.ttlDays', ttlDays);
    if (oauth) {
        assertRetentionDays('oauth.grantRetentionDays', oauth.grantRetentionDays);
    }
    return {
        toolExposure: options.toolExposure ?? DEFAULT_TOOL_EXPOSURE,
        shopAccess: options.shopAccess ?? DEFAULT_SHOP_ACCESS,
        oauth,
        rateLimits: resolveRateLimits(options.rateLimits),
        dnsRebinding: options.dnsRebinding,
        logging: {
            ttlDays,
            capture: options.logging?.capture ?? DEFAULT_LOG_CAPTURE,
            redact: options.logging?.redact,
            maxBodyBytes: options.logging?.maxBodyBytes ?? DEFAULT_LOG_MAX_BODY_BYTES,
            retentionSchedule: options.logging?.retentionSchedule,
            captureClientIp: options.logging?.captureClientIp ?? false,
        },
    };
}

function assertRetentionDays(name: string, value: number): void {
    if (!Number.isFinite(value) || value < 0) {
        throw new Error(`McpPlugin: ${name} must be a non-negative finite number, got ${String(value)}.`);
    }
}

/**
 * Merges user rate-limit options over the defaults. The anonymous-IP backstop stays ON unless
 * the user explicitly passes `anonymousIp: false`.
 */
function resolveRateLimits(rateLimits?: McpRateLimitOptions): Required<McpRateLimitOptions> {
    return {
        perSession: rateLimits?.perSession ?? DEFAULT_RATE_LIMIT_OPTIONS.perSession,
        perUser: rateLimits?.perUser ?? DEFAULT_RATE_LIMIT_OPTIONS.perUser,
        perClient: rateLimits?.perClient ?? DEFAULT_RATE_LIMIT_OPTIONS.perClient,
        perTool: { ...DEFAULT_RATE_LIMIT_OPTIONS.perTool, ...rateLimits?.perTool },
        anonymousIp: rateLimits?.anonymousIp ?? DEFAULT_RATE_LIMIT_OPTIONS.anonymousIp,
        oauthIp: rateLimits?.oauthIp ?? DEFAULT_RATE_LIMIT_OPTIONS.oauthIp,
    };
}
