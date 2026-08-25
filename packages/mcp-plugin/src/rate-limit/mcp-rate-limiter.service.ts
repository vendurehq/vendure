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
 * Thrown when a rate limit is exceeded. The error details include the affected scope and
 * how long the caller should wait before retrying.
 */
export class McpRateLimitExceededError extends Error {
    constructor(public readonly details: McpRateLimitExceeded) {
        super(details.message);
        Object.setPrototypeOf(this, McpRateLimitExceededError.prototype);
    }
}

/**
 * Enforces rate limits for MCP requests, authentication attempts, sessions, users, OAuth clients,
 * and individual tools. Limits are tracked using the configured cache service.
 */
@Injectable()
export class McpRateLimiterService {
    /** Tail of the increment queue per bucket key; an entry is removed once its tail settles. */
    private inFlightIncrements = new Map<string, Promise<void>>();

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
     * before it builds one for an anonymous shop request, so a rate-limited caller costs no database
     * work — not the session-header lookup, and not the session row a shop tool creates lazily.
     * This is the only place that bucket is charged; {@link buildSharedBucketChecks} deliberately
     * leaves it out.
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
            return this.exceededDetails('MCP request', check.scope, state.resetAt, now);
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
        // Increment every bucket first, then look for one over its limit. Each increment is atomic
        // per bucket key (see incrementBucket), so overlapping requests each advance the counter
        // instead of counting as one. Refused requests are counted too, which also rewrites the
        // bucket and keeps an actively-refusing bucket recent in a cache that evicts the least
        // recently used entries.
        const results = await Promise.all(
            checks.map(async check => ({ check, state: await this.incrementBucket(check.key, now) })),
        );
        const exceeded = results.find(({ check, state }) => state.count > check.rpm);
        if (exceeded) {
            return this.exceededDetails(subject, exceeded.check.scope, exceeded.state.resetAt, now);
        }
        return undefined;
    }

    /** The refusal both rate-limit paths return: the retry delay, and the message that states it. */
    private exceededDetails(
        subject: string,
        scope: string,
        resetAt: number,
        now: number,
    ): McpRateLimitExceeded {
        const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - now) / 1000));
        return {
            message: `Rate limit exceeded for ${subject} (${scope}). Retry after ${retryAfterSeconds} seconds.`,
            retryAfterSeconds,
            scope,
        };
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
     * Session, user and OAuth-client buckets, shared across every tool call in a request. The
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
        const userKey = this.userKey(input.executionContext);
        const perUserRpm = this.resolveRpm(rateLimits.perUser);
        if (userKey && perUserRpm > 0) {
            checks.push({
                key: `user:${endpoint}:${userKey}`,
                rpm: perUserRpm,
                scope: 'user',
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
        // No session and no grant: an in-process caller that passed a context without a session.
        // Every such caller shares this one bucket, because there is nothing here to tell them apart.
        return 'none';
    }

    /**
     * The identity behind session-scoped buckets. An anonymous HTTP caller (no OAuth grant, but a
     * client IP) often has no session at all when limits run — a shop tool creates one lazily —
     * and any token it does carry is caller-supplied, so the token cannot key a limit. Those
     * callers are keyed by IP instead.
     */
    private actorSessionKey(executionContext: McpExecutionContext): string {
        if (executionContext.grant == null && executionContext.clientIp != null) {
            return `anonymous-ip:${this.ipKey(executionContext.clientIp)}`;
        }
        return this.sessionKey(executionContext);
    }

    /**
     * The signed-in user behind the request, or `undefined` for an anonymous caller. Authorizing
     * again gives someone a new grant, a new session and possibly a new client record, so those
     * keys all change; their user id does not. Same key whether the call arrives over OAuth, over
     * the anonymous shop endpoint while signed in, or from in-process code.
     */
    private userKey(executionContext: McpExecutionContext): string | undefined {
        const userId = executionContext.ctx.activeUserId;
        return userId != null ? String(userId) : undefined;
    }

    private clientKey(executionContext: McpExecutionContext): string | undefined {
        return executionContext.grant?.oauthClientId != null
            ? `oauth:${executionContext.grant.oauthClientId}`
            : undefined;
    }

    // The caller identity for per-tool buckets. OAuth callers keep the grant's session in the key.
    // Do NOT collapse it to the client alone, or one first-party client serving every shopper would
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
