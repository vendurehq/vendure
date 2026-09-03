import { Inject } from '@nestjs/common';
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
import { McpToolBehavior, McpToolset } from '@vendure/mcp-sdk';
import { ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { DateUtils } from 'typeorm/util/DateUtils';

import { MCP_PLUGIN_OPTIONS, mcpServerPermission } from '../constants';
import { McpOauthGrant, McpOauthGrantStatus, McpToolCallLog } from '../entities';
import { ResolvedMcpPluginOptions } from '../internal-types';
import { McpToolCallLogService } from '../logging/mcp-tool-call-log.service';
import { McpOauthService } from '../oauth/oauth.service';
import { McpToolRegistryService } from '../registry/mcp-tool-registry.service';
import { McpRegisteredTool } from '../registry/registry-types';
import { McpGrantUserType, McpToolCallStatus, McpToolExposureMode } from '../types';

import { McpActorService } from './mcp-actor.service';

/** A registered tool and whether it is currently enabled. */
interface McpToolInfo {
    id: string;
    name: string;
    toolset: McpToolset;
    description: string;
    pluginSource: string;
    behavior: McpToolBehavior;
    enabled: boolean;
}

/** An OAuth grant, summarised for the admin overview. */
interface McpOauthGrantInfo {
    id: ID;
    createdAt: Date;
    updatedAt: Date;
    actorId: string;
    actorType: McpGrantUserType;
    channelId: ID | null;
    oauthClientName: string | null;
    lastActivityAt: Date;
    expiresAt: Date;
    revokedAt: Date | null;
    status: McpOauthGrantStatus;
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

/** How this MCP server is configured, so the dashboard can show only what applies. */
interface McpServerConfig {
    toolExposure: McpToolExposureMode;
    shopAccess: NonNullable<ResolvedMcpPluginOptions['shopAccess']>;
    oauthConfigured: boolean;
    issuer: string | null;
}

const STATS_TIME_RANGE_HOURS: Record<string, number> = {
    '1h': 1,
    '24h': 24,
    '7d': 24 * 7,
    '30d': 24 * 30,
};

const STATS_CACHE_TTL_MS = 60_000;

@Resolver()
export class McpAdminResolver {
    constructor(
        private connection: TransactionalConnection,
        private registry: McpToolRegistryService,
        private toolCallLog: McpToolCallLogService,
        private oauthService: McpOauthService,
        private cacheService: CacheService,
        private listQueryBuilder: ListQueryBuilder,
        @Inject(MCP_PLUGIN_OPTIONS) private options: ResolvedMcpPluginOptions,
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
        @Args() args: { includeInactive: boolean; options?: ListQueryOptions<McpOauthGrant> },
    ): Promise<{ items: McpOauthGrantInfo[]; totalItems: number }> {
        const qb = this.listQueryBuilder.build(McpOauthGrant, args.options ?? undefined, {
            ctx,
            relations: ['oauthClient'],
            customPropertyMap: { oauthClientName: 'oauthClient.clientName' },
        });
        if (!args.includeInactive) {
            qb.andWhere('mcpoauthgrant.revokedAt IS NULL').andWhere('mcpoauthgrant.expiresAt > :now', {
                now: new Date(),
            });
        }
        this.scopeToChannel(qb, 'mcpoauthgrant', ctx.channelId);
        if (Object.keys(args.options?.sort ?? {}).length === 0) {
            qb.orderBy('mcpoauthgrant.lastActivityAt', 'DESC');
        }
        qb.addOrderBy('mcpoauthgrant.id', 'DESC');
        const [grants, totalItems] = await qb.getManyAndCount();
        const items = grants.map(grant => ({
            id: grant.id,
            createdAt: grant.createdAt,
            updatedAt: grant.updatedAt,
            actorId: String(grant.actorId),
            actorType: grant.actorType,
            channelId: grant.channelId,
            oauthClientName: grant.oauthClient?.clientName ?? null,
            lastActivityAt: grant.lastActivityAt,
            expiresAt: grant.expiresAt,
            revokedAt: grant.revokedAt,
            status: grant.status,
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
        this.scopeToChannel(qb, 'log', ctx.channelId);
        if (Object.keys(args.options?.sort ?? {}).length === 0) {
            qb.orderBy('log.createdAt', 'DESC');
        }
        qb.addOrderBy('log.id', 'DESC');
        const [items, totalItems] = await qb.getManyAndCount();
        return { items, totalItems };
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
        const cacheKey = `mcp:stats:${String(ctx.channelId)}:${timeRange}`;
        const cached = await this.cacheService.get<McpStats>(cacheKey);
        if (cached) {
            return cached;
        }
        const stats = await this.computeStats(ctx, hours);
        await this.cacheService.set(cacheKey, stats, { ttl: STATS_CACHE_TTL_MS });
        return stats;
    }

    @Query()
    @Allow(mcpServerPermission.Read)
    mcpServerConfig(): McpServerConfig {
        return {
            toolExposure: this.options.toolExposure,
            shopAccess: this.options.shopAccess,
            oauthConfigured: this.options.oauth != null,
            issuer: this.options.oauth?.issuer ?? null,
        };
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

    private async computeStats(ctx: RequestContext, hours: number): Promise<McpStats> {
        const since = DateUtils.mixedDateToUtcDatetimeString(new Date(Date.now() - hours * 3_600_000));

        const statusRows = await this.windowedQuery(ctx, since)
            .select('log.status', 'status')
            .addSelect('COUNT(*)', 'count')
            .groupBy('log.status')
            .getRawMany<{ status: McpToolCallStatus; count: string | number }>();

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
            callsPerHour: totalCalls / hours,
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

    /** A query over the tool-call log, limited to the window and the active channel. */
    private windowedQuery(ctx: RequestContext, since: string) {
        const qb = this.connection
            .getRepository(ctx, McpToolCallLog)
            .createQueryBuilder('log')
            .where('log.createdAt >= :since', { since });
        this.scopeToChannel(qb, 'log', ctx.channelId);
        return qb;
    }

    /**
     * Limits a query to the active channel's rows. Every grant records the channel it was
     * approved on, so a row belonging to no channel is not something this channel should see.
     * Written once because the grants list, the tool-call log list and the statistics window
     * all need the same condition.
     */
    private scopeToChannel<T extends ObjectLiteral>(qb: SelectQueryBuilder<T>, alias: string, channelId: ID) {
        qb.andWhere(`${alias}.channelId = :channelId`, { channelId });
    }
}

/**
 * Three log fields can hold personal data: the call's input, the call's output (either may
 * contain names, emails or addresses), and the caller's IP address. Listing log entries only
 * needs the MCP read permission, but these three fields also need the ReadCustomer permission.
 * Without it they are returned as null, not as an error.
 *
 * This resolver also turns the stored user id into a name, which needs a lookup rather than a
 * permission check.
 */
@Resolver('McpToolCallLog')
export class McpToolCallLogEntityResolver {
    constructor(private actorService: McpActorService) {}

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

    // Resolved per row rather than joined, because the stored id points at either a Customer
    // or an Administrator depending on the row's actorType.
    @ResolveField()
    async actorName(@Parent() log: McpToolCallLog, @Ctx() ctx: RequestContext): Promise<string | null> {
        const identity = await this.actorService.resolveIdentity(ctx, log.actor, log.actorType);
        return identity.name;
    }

    @ResolveField()
    async customerId(@Parent() log: McpToolCallLog, @Ctx() ctx: RequestContext): Promise<ID | null> {
        const identity = await this.actorService.resolveIdentity(ctx, log.actor, log.actorType);
        return identity.customerId;
    }
}

/** The same name lookup for OAuth grants, which store the user id as `actorId`. */
@Resolver('McpOauthGrant')
export class McpOauthGrantActorResolver {
    constructor(private actorService: McpActorService) {}

    @ResolveField()
    async actorName(@Parent() grant: McpOauthGrantInfo, @Ctx() ctx: RequestContext): Promise<string | null> {
        const identity = await this.actorService.resolveIdentity(ctx, grant.actorId, grant.actorType);
        return identity.name;
    }

    @ResolveField()
    async customerId(@Parent() grant: McpOauthGrantInfo, @Ctx() ctx: RequestContext): Promise<ID | null> {
        const identity = await this.actorService.resolveIdentity(ctx, grant.actorId, grant.actorType);
        return identity.customerId;
    }
}
