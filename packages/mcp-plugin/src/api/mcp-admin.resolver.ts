import { Args, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import {
    Allow,
    CacheService,
    Ctx,
    ID,
    ListQueryBuilder,
    ListQueryOptions,
    Permission,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { McpToolset } from '@vendure/mcp-sdk';
import { DateUtils } from 'typeorm/util/DateUtils';

import { mcpServerPermission } from '../constants';
import { McpOauthGrant, McpToolCallLog } from '../entities';
import { McpToolCallLogService } from '../logging/mcp-tool-call-log.service';
import { McpOauthService } from '../oauth/oauth.service';
import { McpToolRegistryService } from '../registry/mcp-tool-registry.service';
import { McpRegisteredTool } from '../registry/registry-types';

/** A registered tool and whether it is currently enabled. */
interface McpToolInfo {
    id: string;
    name: string;
    toolset: string;
    description: string;
    pluginSource: string;
    behavior: string;
    enabled: boolean;
}

/** An OAuth grant, summarised for the admin overview. */
interface McpOauthGrantInfo {
    id: ID;
    createdAt: Date;
    updatedAt: Date;
    actorId: string | null;
    actorType: string | null;
    channelId: ID | null;
    oauthClientName: string | null;
    lastActivityAt: Date;
    expiresAt: Date;
    revokedAt: Date | null;
}

// Written as `type`, not `interface`: these get cached, and CacheService only accepts
// plain JSON-serialisable shapes, which TS interfaces don't count as.
type McpTopTool = {
    toolName: string;
    count: number;
};

type McpStats = {
    totalCalls: number;
    successRate: number;
    errorRate: number;
    p50LatencyMs: number | null;
    p95LatencyMs: number | null;
    callsPerHour: number;
    topTools: McpTopTool[];
};

const STATS_TIME_RANGE_HOURS: Record<string, number> = {
    '1h': 1,
    '24h': 24,
    '7d': 24 * 7,
    '30d': 24 * 30,
};

const STATS_CACHE_TTL_MS = 60_000;

/**
 * Admin API resolver for the MCP server. It reads tools, grants, the tool-call log and
 * stats, and hands the maintenance mutations off to the registry, OAuth, and tool-call-log
 * services.
 *
 * Tool-call input/output are returned exactly as stored — no redaction here. They are
 * null unless the server is configured to capture full call bodies.
 */
@Resolver()
export class McpAdminResolver {
    constructor(
        private connection: TransactionalConnection,
        private registry: McpToolRegistryService,
        private toolCallLog: McpToolCallLogService,
        private oauthService: McpOauthService,
        private cacheService: CacheService,
        private listQueryBuilder: ListQueryBuilder,
    ) {}

    @Query()
    @Allow(mcpServerPermission.Read)
    async mcpTools(@Ctx() ctx: RequestContext): Promise<McpToolInfo[]> {
        const toggles = await this.registry.getToolToggles(ctx);
        return this.registry.getRegistrySnapshot().map(tool => this.toToolInfo(tool, toggles));
    }

    @Query()
    @Allow(mcpServerPermission.Read)
    async mcpOauthGrants(
        @Ctx() ctx: RequestContext,
        @Args() args: { includeInactive?: boolean; options?: ListQueryOptions<McpOauthGrant> },
    ): Promise<{ items: McpOauthGrantInfo[]; totalItems: number }> {
        const qb = this.listQueryBuilder.build(McpOauthGrant, args.options ?? undefined, {
            ctx,
            relations: ['oauthClient'],
            entityAlias: 'grant',
            customPropertyMap: { oauthClientName: 'oauthClient.clientName' },
        });
        if (!args.includeInactive) {
            qb.andWhere('grant.revokedAt IS NULL').andWhere('grant.expiresAt > :now', {
                now: new Date(),
            });
        }
        if (ctx.channelId != null) {
            // The active channel's grants, plus channel-less (global) grants
            qb.andWhere('(grant.channelId = :channelId OR grant.channelId IS NULL)', {
                channelId: ctx.channelId,
            });
        }
        if (args.options?.sort == null || Object.keys(args.options.sort).length === 0) {
            qb.orderBy('grant.lastActivityAt', 'DESC');
        }
        qb.addOrderBy('grant.id', 'DESC');
        const [grants, totalItems] = await qb.getManyAndCount();
        const items = grants.map(grant => ({
            id: grant.id,
            createdAt: grant.createdAt,
            updatedAt: grant.updatedAt,
            actorId: grant.actorId != null ? String(grant.actorId) : null,
            actorType: grant.actorType ?? null,
            channelId: grant.channelId,
            oauthClientName: grant.oauthClient?.clientName ?? null,
            lastActivityAt: grant.lastActivityAt,
            expiresAt: grant.expiresAt,
            revokedAt: grant.revokedAt,
        }));
        return { items, totalItems };
    }

    @Query()
    @Allow(mcpServerPermission.Read)
    async mcpToolCallLogs(
        @Ctx() ctx: RequestContext,
        @Args() args: { options?: ListQueryOptions<McpToolCallLog> },
    ): Promise<{ items: McpToolCallLog[]; totalItems: number }> {
        const qb = this.listQueryBuilder.build(McpToolCallLog, args.options ?? undefined, {
            ctx,
            entityAlias: 'log',
        });
        if (ctx.channelId != null) {
            // Channel-less rows come from global (admin) grants and show on every
            // channel, matching the grants query above.
            qb.andWhere('(log.channelId = :channelId OR log.channelId IS NULL)', {
                channelId: ctx.channelId,
            });
        }
        return qb.getManyAndCount().then(([items, totalItems]) => ({ items, totalItems }));
    }

    @Query()
    @Allow(mcpServerPermission.Read)
    async mcpStats(@Ctx() ctx: RequestContext, @Args() args: { timeRange?: string }): Promise<McpStats> {
        const timeRange = args.timeRange ?? '24h';
        const hours = STATS_TIME_RANGE_HOURS[timeRange];
        if (hours == null) {
            throw new UserInputError(
                `Invalid timeRange "${timeRange}" - use one of ${Object.keys(STATS_TIME_RANGE_HOURS).join(', ')}`,
            );
        }
        const channelKey = ctx.channelId != null ? String(ctx.channelId) : 'all';
        const cacheKey = `mcp:stats:${channelKey}:${timeRange}`;
        const cached = await this.cacheService.get<McpStats>(cacheKey);
        if (cached) {
            return cached;
        }
        const stats = await this.computeStats(ctx, hours);
        await this.cacheService.set(cacheKey, stats, { ttl: STATS_CACHE_TTL_MS });
        return stats;
    }

    @Mutation()
    @Allow(mcpServerPermission.Update)
    async setMcpToolEnabled(
        @Ctx() ctx: RequestContext,
        @Args() args: { toolName: string; toolset: McpToolset; enabled: boolean },
    ): Promise<McpToolInfo> {
        const tool = this.registry
            .getRegistrySnapshot()
            .find(t => t.name === args.toolName && t.toolset === args.toolset);
        if (!tool) {
            throw new UserInputError(`Unknown MCP tool "${args.toolName}" in toolset "${args.toolset}"`);
        }
        await this.registry.setToolEnabled(ctx, args.toolset, args.toolName, args.enabled);
        const toggles = await this.registry.getToolToggles(ctx);
        return this.toToolInfo(tool, toggles);
    }

    @Mutation()
    @Allow(mcpServerPermission.Update)
    async revokeMcpOauthGrant(@Ctx() ctx: RequestContext, @Args() args: { id: ID }): Promise<boolean> {
        return this.oauthService.revokeGrantById(ctx, args.id);
    }

    @Mutation()
    @Allow(mcpServerPermission.Update)
    async removeExpiredMcpToolCallLogs(@Ctx() ctx: RequestContext): Promise<number> {
        return this.toolCallLog.deleteExpiredToolCallLogs(ctx, ctx.channelId);
    }

    // Gated loosely on Authenticated: the service enforces the real requirements
    // (an authenticated admin with UpdateMcpServer, submitted from the consent page's origin),
    // mirroring how the Shop API's authorizeMcpClient leaves enforcement to the service.
    @Mutation()
    @Allow(Permission.Authenticated)
    async authorizeMcpClient(
        @Ctx() ctx: RequestContext,
        @Args() args: { requestToken: string; approved: boolean },
    ): Promise<{ redirectUrl: string }> {
        return this.oauthService.approveAdminRequest(ctx, args.requestToken, args.approved);
    }

    private toToolInfo(tool: McpRegisteredTool, toggles: Record<string, boolean>): McpToolInfo {
        return {
            id: this.registry.toolKey(tool.toolset, tool.name),
            name: tool.name,
            toolset: tool.toolset,
            description: tool.description,
            pluginSource: tool.pluginSource,
            behavior: tool.resolvedBehavior,
            enabled: this.registry.isToolEnabled(tool, toggles),
        };
    }

    /**
     * Builds the stats for the last `hours`, for the active channel. The database does
     * the counting and percentile work, so we never load every row.
     */
    private async computeStats(ctx: RequestContext, hours: number): Promise<McpStats> {
        const since = DateUtils.mixedDateToUtcDatetimeString(new Date(Date.now() - hours * 3_600_000));

        const statusRows = await this.windowedQuery(ctx, since)
            .select('log.status', 'status')
            .addSelect('COUNT(*)', 'count')
            .groupBy('log.status')
            .getRawMany<{ status: string; count: string | number }>();

        let totalCalls = 0;
        let successCount = 0;
        for (const row of statusRows) {
            const count = Number(row.count);
            totalCalls += count;
            if (row.status === 'success') {
                successCount += count;
            }
        }

        const topToolRows = await this.windowedQuery(ctx, since)
            .select('log.toolName', 'toolName')
            .addSelect('COUNT(*)', 'count')
            .groupBy('log.toolName')
            .orderBy('count', 'DESC')
            // Secondary key so tools with equal counts sort deterministically instead of in DB-dependent order
            .addOrderBy('log.toolName', 'ASC')
            .limit(10)
            .getRawMany<{ toolName: string; count: string | number }>();
        const topTools = topToolRows.map(row => ({ toolName: row.toolName, count: Number(row.count) }));

        const durationCount = await this.windowedQuery(ctx, since)
            .andWhere('log.durationMs IS NOT NULL')
            .getCount();
        const p50LatencyMs = await this.durationPercentile(ctx, since, durationCount, 0.5);
        const p95LatencyMs = await this.durationPercentile(ctx, since, durationCount, 0.95);

        return {
            totalCalls,
            successRate: totalCalls === 0 ? 0 : successCount / totalCalls,
            errorRate: totalCalls === 0 ? 0 : (totalCalls - successCount) / totalCalls,
            p50LatencyMs,
            p95LatencyMs,
            callsPerHour: hours === 0 ? 0 : totalCalls / hours,
            topTools,
        };
    }

    /**
     * Returns the nth-percentile durationMs for the window: order the rows by duration
     * and jump to the row at that position. Works the same on SQLite and Postgres.
     */
    private async durationPercentile(
        ctx: RequestContext,
        since: string,
        total: number,
        percentile: number,
    ): Promise<number | null> {
        if (total === 0) {
            return null;
        }
        const offset = Math.min(total - 1, Math.floor((total - 1) * percentile));
        const row = await this.windowedQuery(ctx, since)
            .andWhere('log.durationMs IS NOT NULL')
            .select('log.durationMs', 'durationMs')
            .orderBy('log.durationMs', 'ASC')
            .offset(offset)
            .limit(1)
            .getRawOne<{ durationMs: string | number }>();
        return row ? Number(row.durationMs) : null;
    }

    /**
     * A query over the tool-call log, limited to the window and the active channel.
     * Channel-less rows come from global (admin) grants and count on every channel.
     */
    private windowedQuery(ctx: RequestContext, since: string) {
        const qb = this.connection
            .getRepository(ctx, McpToolCallLog)
            .createQueryBuilder('log')
            .where('log.createdAt >= :since', { since });
        if (ctx.channelId != null) {
            qb.andWhere('(log.channelId = :channelId OR log.channelId IS NULL)', {
                channelId: ctx.channelId,
            });
        }
        return qb;
    }
}

/**
 * Three log fields can hold personal data: the call's input, the call's output (either may
 * contain names, emails or addresses), and the caller's IP address. Listing log entries only
 * needs the MCP read permission, but these three fields also need the ReadCustomer permission.
 * Without it they are returned as null, not as an error.
 */
@Resolver('McpToolCallLog')
export class McpToolCallLogEntityResolver {
    // Not `@Allow`: that would error on every row, and the log should stay readable for admins without customer access.
    @ResolveField()
    input(@Parent() log: McpToolCallLog, @Ctx() ctx: RequestContext): unknown {
        return ctx.userHasPermissions([Permission.ReadCustomer]) ? log.input : null;
    }

    @ResolveField()
    output(@Parent() log: McpToolCallLog, @Ctx() ctx: RequestContext): unknown {
        return ctx.userHasPermissions([Permission.ReadCustomer]) ? log.output : null;
    }

    @ResolveField()
    clientIp(@Parent() log: McpToolCallLog, @Ctx() ctx: RequestContext): string | null {
        return ctx.userHasPermissions([Permission.ReadCustomer]) ? log.clientIp : null;
    }
}
