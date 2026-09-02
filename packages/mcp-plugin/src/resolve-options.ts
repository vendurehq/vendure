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
    assertNonNegativeNumber('logging.ttlDays', ttlDays);
    if (oauth) {
        assertNonNegativeNumber('oauth.grantRetentionDays', oauth.grantRetentionDays);
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

function assertNonNegativeNumber(name: string, value: number): void {
    if (!Number.isFinite(value) || value < 0) {
        throw new Error(`McpPlugin: ${name} must be a non-negative finite number, got ${String(value)}.`);
    }
}

/**
 * Merges user rate-limit options over the defaults. The anonymous-IP backstop stays ON unless
 * the user explicitly passes `anonymousIp: false`.
 */
function resolveRateLimits(rateLimits?: McpRateLimitOptions): Required<McpRateLimitOptions> {
    const resolved: Required<McpRateLimitOptions> = {
        perSession: rateLimits?.perSession ?? DEFAULT_RATE_LIMIT_OPTIONS.perSession,
        perUser: rateLimits?.perUser ?? DEFAULT_RATE_LIMIT_OPTIONS.perUser,
        perClient: rateLimits?.perClient ?? DEFAULT_RATE_LIMIT_OPTIONS.perClient,
        perTool: { ...DEFAULT_RATE_LIMIT_OPTIONS.perTool, ...rateLimits?.perTool },
        anonymousIp: rateLimits?.anonymousIp ?? DEFAULT_RATE_LIMIT_OPTIONS.anonymousIp,
        oauthIp: rateLimits?.oauthIp ?? DEFAULT_RATE_LIMIT_OPTIONS.oauthIp,
    };
    assertRpm('rateLimits.perSession', resolved.perSession);
    assertRpm('rateLimits.perUser', resolved.perUser);
    assertRpm('rateLimits.perClient', resolved.perClient);
    assertRpm('rateLimits.anonymousIp', resolved.anonymousIp);
    assertRpm('rateLimits.oauthIp', resolved.oauthIp);
    for (const [toolName, perTool] of Object.entries(resolved.perTool)) {
        assertRpm(`rateLimits.perTool.${toolName}`, perTool);
    }
    return resolved;
}

/** `false` means the bucket is switched off; anything else must carry a usable rpm. */
function assertRpm(name: string, option: { rpm: number } | false | undefined): void {
    if (option === false || option === undefined) {
        return;
    }
    assertNonNegativeNumber(`${name}.rpm`, option.rpm);
}
