import { Inject, Injectable } from '@nestjs/common';
import { CacheService } from '@vendure/core';
import { McpToolset } from '@vendure/mcp-sdk';
import { createHash } from 'node:crypto';

import { MCP_PLUGIN_OPTIONS, RATE_LIMIT_CACHE_PREFIX, RATE_LIMIT_WINDOW_MS } from '../constants';
import { McpExecutionContext, ResolvedMcpPluginOptions } from '../internal-types';

import { ipBucketKey } from './ip-bucket-key';

interface RateLimitCheck {
    key: string;
    rpm: number;
    scope: string;
}

interface BucketState {
    count: number;
    resetAt: number;
}

export interface McpRateLimitExceeded {
    message: string;
    retryAfterSeconds: number;
    scope: string;
}

export interface RateLimitInput {
    executionContext: McpExecutionContext;
    endpoint: McpToolset;
    /** What the request is metered as: a tool name, or a JSON-RPC method name at the handshake. */
    subject: string;
}

export class McpRateLimitExceededError extends Error {
    constructor(public readonly details: McpRateLimitExceeded) {
        super(details.message);
        Object.setPrototypeOf(this, McpRateLimitExceededError.prototype);
    }
}

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
     * Early anonymous-IP gate (before session or DB access exists).
     * This bucket is intentionally NOT part of standard request checks to avoid double charging.
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
     * Rate limits repeated authentication failures per IP.
     * - only failed attempts contribute to the counter
     * - once exceeded, all requests are blocked until window resets
     */
    async checkBearerAuthFailureRateLimit(clientIp?: string): Promise<McpRateLimitExceeded | undefined> {
        const check = this.buildBearerAuthFailureCheck(this.ipKey(clientIp));
        if (!check) {
            return undefined;
        }
        const now = Date.now();
        const state = await this.getBucketState(check.key);
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
        const results = await Promise.all(
            checks.map(async check => ({ check, state: await this.incrementBucket(check.key, now) })),
        );
        const exceeded = results.find(({ check, state }) => state.count > check.rpm);
        if (exceeded) {
            return this.exceededDetails(subject, exceeded.check.scope, exceeded.state.resetAt, now);
        }
        return undefined;
    }

    private exceededDetails(
        subject: string,
        scope: string,
        resetAt: number,
        now: number,
    ): McpRateLimitExceeded {
        // `resetAt` was written by whichever instance created the bucket, so a clock difference
        // between instances could otherwise advertise a wait longer than a window can ever be.
        const windowSeconds = RATE_LIMIT_WINDOW_MS / 1000;
        const retryAfterSeconds = Math.min(windowSeconds, Math.max(1, Math.ceil((resetAt - now) / 1000)));
        return {
            message: `Rate limit exceeded for ${subject} (${scope}). Retry after ${retryAfterSeconds} seconds.`,
            retryAfterSeconds,
            scope,
        };
    }

    private buildRateLimitChecks(input: RateLimitInput): RateLimitCheck[] {
        const checks: RateLimitCheck[] = [
            ...this.buildSharedBucketChecks(input),
            ...this.buildPerToolChecks(input),
        ];
        // De-dupe by key so a bucket is never double-counted within one request.
        return [...new Map(checks.map(check => [check.key, check])).values()];
    }

    /**
     * Shared identity buckets: session, user, OAuth client
     * These represent persistent actor identity across tool calls.
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

    private async getBucketState(key: string): Promise<BucketState | undefined> {
        return this.cacheService.get<BucketState>(this.cacheKey(key));
    }

    private incrementBucket(key: string, now: number): Promise<BucketState> {
        const run = async (): Promise<BucketState> => {
            const state = await this.getBucketState(key);
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

    private actorSessionKey(executionContext: McpExecutionContext): string {
        if (executionContext.grant == null && executionContext.clientIp != null) {
            return `anonymous-ip:${this.ipKey(executionContext.clientIp)}`;
        }
        return this.sessionKey(executionContext);
    }

    private userKey(executionContext: McpExecutionContext): string | undefined {
        const userId = executionContext.ctx.activeUserId;
        return userId != null ? String(userId) : undefined;
    }

    private clientKey(executionContext: McpExecutionContext): string | undefined {
        return executionContext.grant?.oauthClientId != null
            ? `oauth:${executionContext.grant.oauthClientId}`
            : undefined;
    }

    /**
     * Actor identity for tool-level rate limits.
     *
     * Important distinction:
     * - client alone would collapse all users under one bucket
     * - session preserves per-session fairness under shared clients
     */
    private toolActorKey(executionContext: McpExecutionContext): string {
        const clientKey = this.clientKey(executionContext);
        return clientKey
            ? `client:${clientKey}:session:${this.sessionKey(executionContext)}`
            : this.actorSessionKey(executionContext);
    }

    private ipKey(clientIp?: string): string {
        return ipBucketKey(clientIp);
    }

    private cacheKey(key: string): string {
        return `${RATE_LIMIT_CACHE_PREFIX}:${this.hash(key)}`;
    }

    private hash(value: string): string {
        return createHash('sha256').update(value).digest('base64url');
    }
}
