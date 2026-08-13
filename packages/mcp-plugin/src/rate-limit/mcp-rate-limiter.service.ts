import { Inject, Injectable } from '@nestjs/common';
import { CacheService } from '@vendure/core';
import { McpToolset } from '@vendure/mcp-sdk';
import { createHash } from 'node:crypto';

import { MCP_PLUGIN_OPTIONS, RATE_LIMIT_CACHE_PREFIX, RATE_LIMIT_WINDOW_MS } from '../constants';
import { McpExecutionContext, ResolvedMcpPluginOptions } from '../internal-types';

/** A single rate-limit bucket to check/consume. */
interface RateLimitCheck {
    key: string;
    rpm: number;
    scope: string;
}

/** In-cache state of one fixed-window bucket. */
interface BucketState {
    count: number;
    resetAt: number;
}

/** Details carried by {@link McpRateLimitExceededError}. */
export interface McpRateLimitExceeded {
    message: string;
    retryAfterSeconds: number;
    scope: string;
}

/** Input to the rate-limit enforcement/check methods. */
export interface RateLimitInput {
    executionContext: McpExecutionContext;
    endpoint: McpToolset;
    /** What the request is metered as: a tool name, or a JSON-RPC method name at the handshake. */
    subject: string;
}

/**
 * Thrown when a rate-limit bucket is exceeded. The controller's handshake pre-check maps this to a
 * JSON-RPC `-31029` error whose `data` carries `{ retryAfterSeconds, scope }`; inside a tool call it
 * is caught and flattened to an `isError` result.
 */
export class McpRateLimitExceededError extends Error {
    constructor(public readonly details: McpRateLimitExceeded) {
        super(details.message);
        Object.setPrototypeOf(this, McpRateLimitExceededError.prototype);
    }
}

/**
 * @description
 * Enforces per-minute request limits. Counters live in CacheService and reset every minute.
 * Five kinds of counter exist, and each is charged at the one point in a request's life where
 * the work it protects would otherwise happen:
 *
 * - Anonymous IP: charged by the transport before an anonymous shop request is processed,
 *   because processing one writes a session row ({@link checkAnonymousIpRateLimit}).
 * - Failed authentication per IP: checked by the transport before a bearer token's database
 *   lookup, counted when the lookup rejects the token ({@link checkBearerAuthFailureRateLimit},
 *   {@link recordBearerAuthFailure}).
 * - Session and OAuth client: charged by the transport for protocol messages and by the tool
 *   registry for tool calls ({@link checkRateLimit}, {@link enforceRateLimit}).
 * - Per tool: charged by the tool registry alongside the session and client counters.
 * - OAuth IP: charged by the guard in front of the OAuth controller's HTTP routes
 *   ({@link enforceOauthIpRateLimit}).
 *
 * Naming: `check*` methods return the exceeded-limit details (or `undefined` when within the
 * limit); `enforce*` methods throw {@link McpRateLimitExceededError} instead.
 */
@Injectable()
export class McpRateLimiterService {
    constructor(
        private cacheService: CacheService,
        @Inject(MCP_PLUGIN_OPTIONS) private options: ResolvedMcpPluginOptions,
    ) {}

    /** Throws {@link McpRateLimitExceededError} if any relevant bucket is at/over its limit. */
    async enforceRateLimit(input: RateLimitInput): Promise<void> {
        const exceeded = await this.checkRateLimit(input);
        if (exceeded) {
            throw new McpRateLimitExceededError(exceeded);
        }
    }

    /**
     * Charges every relevant bucket, then reports the first bucket over its limit (or `undefined`
     * when all are within it). A refused request stays charged, like other fixed-window limiters.
     */
    async checkRateLimit(input: RateLimitInput): Promise<McpRateLimitExceeded | undefined> {
        return this.runChecks(this.buildRateLimitChecks(input), input.subject);
    }

    /**
     * Charges the anonymous-IP bucket alone, without a resolved context. The transport calls this
     * before it builds one for an anonymous shop request, because building it creates a Vendure session
     * row — the write belongs inside the limit rather than behind it. This is the only place that
     * bucket is charged; {@link buildSharedBucketChecks} deliberately leaves it out.
     */
    async checkAnonymousIpRateLimit(
        endpoint: McpToolset,
        clientIp?: string,
    ): Promise<McpRateLimitExceeded | undefined> {
        const check = this.buildAnonymousIpCheck(endpoint, this.ipKey(clientIp));
        if (!check) {
            return undefined;
        }
        return this.runChecks([check], 'MCP request');
    }

    /**
     * Charges the OAuth-IP bucket alone, for a call into the OAuth HTTP surface. One shared bucket
     * covers every route on `McpOauthController` — see {@link McpOauthRateLimitGuard}, which is
     * the only caller of this method.
     */
    async enforceOauthIpRateLimit(clientIp?: string): Promise<void> {
        const check = this.buildOauthIpCheck(this.ipKey(clientIp));
        if (!check) {
            return;
        }
        const exceeded = await this.runChecks([check], 'MCP OAuth request');
        if (exceeded) {
            throw new McpRateLimitExceededError(exceeded);
        }
    }

    /**
     * Blocks a request when its address has failed authentication too many times in the
     * current minute. Runs before the token is checked against the database, so a blocked
     * address stops costing database work. Only failures count toward the limit (see
     * {@link recordBearerAuthFailure}), but once blocked, every request from that address
     * is refused until the minute is over.
     */
    async checkBearerAuthFailureRateLimit(clientIp?: string): Promise<McpRateLimitExceeded | undefined> {
        const check = this.buildBearerAuthFailureCheck(this.ipKey(clientIp));
        if (!check) {
            return undefined;
        }
        const now = Date.now();
        const state = await this.getBucketState(check.key, now);
        if (state && state.count > check.rpm) {
            // Keep counting refused attempts, so the cache entry stays alive while the flood lasts.
            await this.incrementBucket(check.key, now);
            const retryAfterSeconds = Math.max(1, Math.ceil((state.resetAt - now) / 1000));
            return {
                message: `Rate limit exceeded for MCP request (${check.scope}). Retry after ${retryAfterSeconds} seconds.`,
                retryAfterSeconds,
                scope: check.scope,
            };
        }
        return undefined;
    }

    /** Counts one failed bearer authentication for this address. */
    async recordBearerAuthFailure(clientIp?: string): Promise<void> {
        const check = this.buildBearerAuthFailureCheck(this.ipKey(clientIp));
        if (!check) {
            return;
        }
        await this.incrementBucket(check.key, Date.now());
    }

    private async runChecks(
        checks: RateLimitCheck[],
        subject: string,
    ): Promise<McpRateLimitExceeded | undefined> {
        if (checks.length === 0) {
            return undefined;
        }
        const now = Date.now();
        // Charge first, judge after. Each increment is atomic per bucket key (see incrementBucket),
        // so overlapping requests each advance the counter — the previous read-then-write split let
        // N overlapping requests collectively count as one. Charging refused requests also rewrites
        // the bucket, which keeps an actively-refusing bucket recent in an LRU-evicting cache.
        const results = await Promise.all(
            checks.map(async check => ({ check, state: await this.incrementBucket(check.key, now) })),
        );
        const exceeded = results.find(({ check, state }) => state.count > check.rpm);
        if (exceeded) {
            const retryAfterSeconds = Math.max(1, Math.ceil((exceeded.state.resetAt - now) / 1000));
            return {
                message: `Rate limit exceeded for ${subject} (${exceeded.check.scope}). Retry after ${retryAfterSeconds} seconds.`,
                retryAfterSeconds,
                scope: exceeded.check.scope,
            };
        }
        return undefined;
    }

    /** Builds the list of buckets to check for a request: the shared buckets, then one per tool. */
    private buildRateLimitChecks(input: RateLimitInput): RateLimitCheck[] {
        const checks: RateLimitCheck[] = [
            ...this.buildSharedBucketChecks(input),
            ...this.buildPerToolChecks(input),
        ];
        // De-dupe by key so a bucket is never double-counted within one request.
        return [...new Map(checks.map(check => [check.key, check])).values()];
    }

    /**
     * Session and OAuth-client buckets, shared across every tool call in a request. The
     * anonymous-IP bucket is absent by design: it applies to exactly the requests the transport
     * charges at the edge (see {@link checkAnonymousIpRateLimit}), and charging it here too would
     * count the same request twice.
     */
    private buildSharedBucketChecks(input: RateLimitInput): RateLimitCheck[] {
        const checks: RateLimitCheck[] = [];
        const endpoint = input.endpoint;
        const rateLimits = this.options.rateLimits;
        const perSessionRpm = this.resolveRpm(rateLimits.perSession);
        if (perSessionRpm > 0) {
            checks.push({
                key: `session:${endpoint}:${this.actorSessionKey(input.executionContext)}`,
                rpm: perSessionRpm,
                scope: 'session',
            });
        }
        const clientKey = this.clientKey(input.executionContext);
        const perClientRpm = this.resolveRpm(rateLimits.perClient);
        if (clientKey && perClientRpm > 0) {
            checks.push({
                key: `client:${endpoint}:${clientKey}`,
                rpm: perClientRpm,
                scope: 'OAuth client',
            });
        }
        return checks;
    }

    /** The per-minute limit of a rate-limit option: 0 when the option is off or unset. */
    private resolveRpm(option: { rpm: number } | false | undefined): number {
        return option === false ? 0 : (option?.rpm ?? 0);
    }

    /** The anonymous-IP bucket for an endpoint, or `undefined` when it does not apply. */
    private buildAnonymousIpCheck(endpoint: McpToolset, ipKey: string): RateLimitCheck | undefined {
        const rpm = this.resolveRpm(this.options.rateLimits.anonymousIp);
        if (endpoint !== 'shop' || rpm <= 0) {
            return undefined;
        }
        return { key: `anonymous-ip:${endpoint}:${ipKey}`, rpm, scope: 'anonymous IP' };
    }

    /** The OAuth-IP bucket, or `undefined` when it does not apply. */
    private buildOauthIpCheck(ipKey: string): RateLimitCheck | undefined {
        const rpm = this.resolveRpm(this.options.rateLimits.oauthIp);
        if (rpm <= 0) {
            return undefined;
        }
        return { key: `oauth-ip:${ipKey}`, rpm, scope: 'OAuth IP' };
    }

    /**
     * The failed-bearer-authentication bucket. A separate bucket from the OAuth surface's, but
     * governed by the same `oauthIp` option: both meter what an unauthenticated address may spend.
     */
    private buildBearerAuthFailureCheck(ipKey: string): RateLimitCheck | undefined {
        const rpm = this.resolveRpm(this.options.rateLimits.oauthIp);
        if (rpm <= 0) {
            return undefined;
        }
        return { key: `auth-failure:${ipKey}`, rpm, scope: 'authentication failures' };
    }

    /** The bucket for `input.subject`, keyed by actor+session (see {@link toolActorKey}). */
    private buildPerToolChecks(input: RateLimitInput): RateLimitCheck[] {
        const rpm = this.resolveRpm(this.options.rateLimits.perTool[input.subject]);
        if (rpm <= 0) {
            return [];
        }
        return [
            {
                key: `tool:${input.endpoint}:${this.toolActorKey(input.executionContext)}:${input.subject}`,
                rpm,
                scope: `tool:${input.subject}`,
            },
        ];
    }

    /** Reads a bucket's current state, treating an expired window as if the bucket didn't exist. */
    private async getBucketState(key: string, now: number): Promise<BucketState | undefined> {
        const state = await this.cacheService.get<BucketState>(this.cacheKey(key));
        if (!state || state.resetAt <= now) {
            return undefined;
        }
        return state;
    }

    /** Tail of the increment queue per bucket key; an entry is removed once its tail settles. */
    private inFlightIncrements = new Map<string, Promise<void>>();

    private incrementBucket(key: string, now: number): Promise<BucketState> {
        const run = async (): Promise<BucketState> => {
            const state = await this.getBucketState(key, now);
            const next: BucketState = state
                ? { count: state.count + 1, resetAt: state.resetAt }
                : { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
            await this.cacheService.set(this.cacheKey(key), next, {
                ttl: Math.max(1000, next.resetAt - now),
            });
            return next;
        };
        const previous = this.inFlightIncrements.get(key) ?? Promise.resolve();
        const result = previous.then(run, run);
        const tail = result.then(
            () => undefined,
            () => undefined,
        );
        this.inFlightIncrements.set(key, tail);
        void tail.then(() => {
            // Only clear the entry if no later increment has replaced it.
            if (this.inFlightIncrements.get(key) === tail) {
                this.inFlightIncrements.delete(key);
            }
        });
        return result;
    }

    private sessionKey(executionContext: McpExecutionContext): string {
        const sessionToken = executionContext.ctx.session?.token;
        if (sessionToken) {
            return `vendure:${this.hash(sessionToken)}`;
        }
        if (executionContext.grant?.id != null) {
            return `mcp:${executionContext.grant.id}`;
        }
        return 'none';
    }

    /**
     * The identity behind session-scoped buckets. An anonymous HTTP caller (no OAuth grant, but a
     * client IP) is minted a fresh Vendure session token on every request that omits the session
     * header, so the token cannot key a limit — those callers are keyed by IP instead.
     */
    private actorSessionKey(executionContext: McpExecutionContext): string {
        if (executionContext.grant == null && executionContext.clientIp != null) {
            return `anonymous-ip:${this.ipKey(executionContext.clientIp)}`;
        }
        return this.sessionKey(executionContext);
    }

    private clientKey(executionContext: McpExecutionContext): string | undefined {
        return executionContext.grant?.oauthClientId != null
            ? `oauth:${executionContext.grant.oauthClientId}`
            : undefined;
    }

    // The caller identity for per-tool buckets. OAuth callers keep the grant's session in the key —
    // do NOT collapse it to the client alone, or one first-party client serving every shopper would
    // share a single per-tool bucket store-wide. Anonymous and in-process callers use the same
    // identity as the session bucket (IP for anonymous HTTP, own session for in-process).
    private toolActorKey(executionContext: McpExecutionContext): string {
        const clientKey = this.clientKey(executionContext);
        return clientKey
            ? `client:${clientKey}:session:${this.sessionKey(executionContext)}`
            : this.actorSessionKey(executionContext);
    }

    private ipKey(clientIp?: string): string {
        return clientIp ?? 'unknown';
    }

    private cacheKey(key: string): string {
        return `${RATE_LIMIT_CACHE_PREFIX}:${this.hash(key)}`;
    }

    private hash(value: string): string {
        return createHash('sha256').update(value).digest('base64url');
    }
}
