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
    const oauth = options.oauth && { ...DEFAULT_OAUTH_OPTIONS, ...withoutUndefined(options.oauth) };
    const ttlDays = options.logging?.ttlDays ?? DEFAULT_LOG_TTL_DAYS;
    assertNonNegativeNumber('logging.ttlDays', ttlDays);
    if (oauth) {
        assertNonNegativeNumber('oauth.grantRetentionDays', oauth.grantRetentionDays);
    }
    const toolExposure = options.toolExposure ?? DEFAULT_TOOL_EXPOSURE;
    const shopAccess = options.shopAccess ?? DEFAULT_SHOP_ACCESS;
    const capture = options.logging?.capture ?? DEFAULT_LOG_CAPTURE;
    assertOneOf('toolExposure', toolExposure, ['direct', 'discovery']);
    assertOneOf('shopAccess', shopAccess, ['anonymous', 'authenticated', 'disabled']);
    assertOneOf('logging.capture', capture, ['metadata', 'full']);
    if (shopAccess === 'authenticated' && !oauth) {
        throw new Error(
            'McpPlugin: shopAccess "authenticated" needs an oauth block, because the shop endpoint ' +
                'answers every token-less request with an OAuth challenge that names the issuer.',
        );
    }
    return {
        toolExposure,
        shopAccess,
        oauth,
        rateLimits: resolveRateLimits(options.rateLimits),
        dnsRebinding: options.dnsRebinding,
        logging: {
            ttlDays,
            capture,
            redact: options.logging?.redact,
            maxBodyBytes: options.logging?.maxBodyBytes ?? DEFAULT_LOG_MAX_BODY_BYTES,
            retentionSchedule: options.logging?.retentionSchedule,
            captureClientIp: options.logging?.captureClientIp ?? false,
        },
    };
}

// An option read from an unset environment variable must fall back to its default rather than erase it.
function withoutUndefined<T extends object>(value: T): T {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

function assertOneOf(name: string, value: string, allowed: readonly string[]): void {
    if (!allowed.includes(value)) {
        throw new Error(`McpPlugin: ${name} must be one of ${allowed.join(', ')}, got ${String(value)}.`);
    }
}

function assertNonNegativeNumber(name: string, value: number): void {
    if (!Number.isFinite(value) || value < 0) {
        throw new Error(`McpPlugin: ${name} must be a non-negative finite number, got ${String(value)}.`);
    }
}

// The anonymous-IP backstop stays on unless the user explicitly passes `anonymousIp: false`.
function resolveRateLimits(rateLimits?: McpRateLimitOptions): Required<McpRateLimitOptions> {
    const resolved: Required<McpRateLimitOptions> = {
        perSession: rateLimits?.perSession ?? DEFAULT_RATE_LIMIT_OPTIONS.perSession,
        perUser: rateLimits?.perUser ?? DEFAULT_RATE_LIMIT_OPTIONS.perUser,
        perClient: rateLimits?.perClient ?? DEFAULT_RATE_LIMIT_OPTIONS.perClient,
        perTool: {
            ...DEFAULT_RATE_LIMIT_OPTIONS.perTool,
            ...(rateLimits?.perTool && withoutUndefined(rateLimits.perTool)),
        },
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
function assertRpm(name: string, option: { rpm: number } | false): void {
    if (option === false) {
        return;
    }
    assertNonNegativeNumber(`${name}.rpm`, option.rpm);
}
