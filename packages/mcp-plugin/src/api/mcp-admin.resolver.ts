import { Inject } from '@nestjs/common';
import { Args, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import {
    Allow,
    CacheService,
    Ctx,
    ForbiddenError,
    ID,
    ListQueryBuilder,
    ListQueryOptions,
    NullOptionals,
    Permission,
    RequestContext,
    SortParameter,
    TransactionalConnection,
    UserInputError,
    VendureEntity,
} from '@vendure/core';
import { McpToolBehavior, McpToolset } from '@vendure/mcp-sdk';
import { ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { DateUtils } from 'typeorm/util/DateUtils';

import { MCP_PLUGIN_OPTIONS, mcpServerPermission } from '../constants';
import { McpOauthGrant, McpToolCallLog } from '../entities';
import { ResolvedMcpPluginOptions } from '../internal-types';
import { McpToolCallLogRetentionService } from '../logging/mcp-tool-call-log-retention.service';
import { McpOauthService } from '../oauth/oauth.service';
import { McpToolRegistryService } from '../registry/mcp-tool-registry.service';
import { McpRegisteredTool } from '../registry/registry-types';
import { McpToolCallStatus, McpToolExposureMode } from '../types';

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

// A `type`, not `interface`, because these get cached and CacheService only accepts plain JSON shapes.
type McpStats = {
    totalCalls: number;
    successRate: number;
    errorRate: number;
    p50LatencyMs: number | null;
    p95LatencyMs: number | null;
    callsPerHour: number;
    topTools: Array<{ toolName: string; count: number }>;
};

/** How this MCP server is configured, so the dashboard can show only what applies. */
interface McpServerConfig {
    toolExposure: McpToolExposureMode;
    shopAccess: NonNullable<ResolvedMcpPluginOptions['shopAccess']>;
    oauthConfigured: boolean;
    issuer: string | null;
}

const STATS_TIME_RANGE_HOURS = new Map<string, number>([
    ['1h', 1],
    ['24h', 24],
    ['7d', 24 * 7],
    ['30d', 24 * 30],
]);

const STATS_CACHE_TTL_MS = 60_000;

@Resolver()
export class McpAdminResolver {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly registry: McpToolRegistryService,
        private readonly oauthService: McpOauthService,
        private readonly cacheService: CacheService,
        private readonly listQueryBuilder: ListQueryBuilder,
        @Inject(MCP_PLUGIN_OPTIONS) private readonly options: ResolvedMcpPluginOptions,
        private readonly toolCallLogRetention: McpToolCallLogRetentionService,
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
    ): Promise<{ items: McpOauthGrant[]; totalItems: number }> {
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
        this.applyDefaultOrder(qb, 'mcpoauthgrant', args.options?.sort, 'lastActivityAt');
        const [items, totalItems] = await qb.getManyAndCount();
        return { items, totalItems };
    }

    @Query()
    @Allow(mcpServerPermission.Read)
    async mcpToolCallLogs(
        @Ctx() ctx: RequestContext,
        @Args() args: { options?: ListQueryOptions<McpToolCallLog> },
    ): Promise<{ items: McpToolCallLog[]; totalItems: number }> {
        // Filtering or sorting by clientIp would reveal the addresses the field resolver hides.
        if (
            !ctx.userHasPermissions([Permission.ReadCustomer]) &&
            listOptionsUseField(args.options, 'clientIp')
        ) {
            throw new ForbiddenError();
        }
        const qb = this.listQueryBuilder.build(McpToolCallLog, args.options ?? undefined, {
            ctx,
            entityAlias: 'log',
        });
        this.scopeToChannel(qb, 'log', ctx.channelId);
        this.applyDefaultOrder(qb, 'log', args.options?.sort, 'createdAt');
        const [items, totalItems] = await qb.getManyAndCount();
        return { items, totalItems };
    }

    @Query()
    @Allow(mcpServerPermission.Read)
    async mcpStats(@Ctx() ctx: RequestContext, @Args() args: { timeRange?: string }): Promise<McpStats> {
        const timeRange = args.timeRange ?? '24h';
        const hours = STATS_TIME_RANGE_HOURS.get(timeRange);
        if (hours == null) {
            throw new UserInputError(
                `Invalid timeRange "${timeRange}" - use one of ${Array.from(STATS_TIME_RANGE_HOURS.keys()).join(', ')}`,
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
        return this.toolCallLogRetention.deleteExpiredToolCallLogs(ctx, ctx.channelId);
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
        const { p50LatencyMs, p95LatencyMs } = await this.durationPercentiles(ctx, since, durationCount);

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

    // Numbers the rows in duration order and picks the two positions, in one statement.
    private async durationPercentiles(
        ctx: RequestContext,
        since: string,
        total: number,
    ): Promise<{ p50LatencyMs: number | null; p95LatencyMs: number | null }> {
        if (total === 0) {
            return { p50LatencyMs: null, p95LatencyMs: null };
        }
        // 1-based position of the nth-percentile row in duration order.
        const positionOf = (percentile: number) => Math.floor((total - 1) * percentile) + 1;
        const p50Position = positionOf(0.5);
        const p95Position = positionOf(0.95);
        // Lower-case aliases: Postgres folds these unquoted column names to lower case.
        const rows = await this.connection
            .getRepository(ctx, McpToolCallLog)
            .manager.createQueryBuilder()
            .select('ranked.duration_ms', 'duration_ms')
            .addSelect('ranked.row_position', 'row_position')
            .from(subQuery => {
                const ranked = subQuery
                    .select('log.durationMs', 'duration_ms')
                    .addSelect('ROW_NUMBER() OVER (ORDER BY log.durationMs ASC)', 'row_position')
                    .from(McpToolCallLog, 'log');
                return this.limitToWindow(ranked, ctx, since).andWhere('log.durationMs IS NOT NULL');
            }, 'ranked')
            .where('ranked.row_position IN (:...positions)', { positions: [p50Position, p95Position] })
            .getRawMany<{ duration_ms: string | number; row_position: string | number }>();
        const durationAt = (position: number) => {
            const row = rows.find(r => Number(r.row_position) === position);
            return row ? Number(row.duration_ms) : null;
        };
        return { p50LatencyMs: durationAt(p50Position), p95LatencyMs: durationAt(p95Position) };
    }

    private windowedQuery(ctx: RequestContext, since: string) {
        const qb = this.connection.getRepository(ctx, McpToolCallLog).createQueryBuilder('log');
        return this.limitToWindow(qb, ctx, since);
    }

    private limitToWindow<T extends ObjectLiteral>(
        qb: SelectQueryBuilder<T>,
        ctx: RequestContext,
        since: string,
    ) {
        qb.where('log.createdAt >= :since', { since });
        this.scopeToChannel(qb, 'log', ctx.channelId);
        return qb;
    }

    // Shared by the grants list, the tool-call log list and the statistics window.
    private scopeToChannel<T extends ObjectLiteral>(qb: SelectQueryBuilder<T>, alias: string, channelId: ID) {
        qb.andWhere(`${alias}.channelId = :channelId`, { channelId });
    }

    // Newest first by default, with id DESC always last so same-timestamp rows stay in a stable order.
    private applyDefaultOrder<T extends VendureEntity>(
        qb: SelectQueryBuilder<T>,
        alias: string,
        sort: NullOptionals<SortParameter<T>> | null | undefined,
        column: string,
    ): void {
        if (Object.keys(sort ?? {}).length === 0) {
            qb.orderBy(`${alias}.${column}`, 'DESC');
        }
        qb.addOrderBy(`${alias}.id`, 'DESC');
    }
}

/** A field that holds personal data: visible only with ReadCustomer on top of the MCP read permission. */
function personalField<T>(ctx: RequestContext, value: T): T | null {
    return ctx.userHasPermissions([Permission.ReadCustomer]) ? value : null;
}

/** True when the list options sort by the field or filter on it, including inside nested `_and` / `_or` groups. */
function listOptionsUseField(options: ListQueryOptions<McpToolCallLog> | undefined, field: string): boolean {
    if (options?.sort && field in options.sort) {
        return true;
    }
    return filterUsesField(options?.filter, field);
}

function filterUsesField(filter: unknown, field: string): boolean {
    if (!filter || typeof filter !== 'object') {
        return false;
    }
    const { _and, _or, ...fields } = filter as Record<string, unknown>;
    if (field in fields) {
        return true;
    }
    return [_and, _or].some(
        group => Array.isArray(group) && group.some(item => filterUsesField(item, field)),
    );
}

// Input, output and clientIp need the ReadCustomer permission on top of the MCP read permission,
// since they can hold personal data; without it they resolve to null rather than an error.
@Resolver('McpToolCallLog')
export class McpToolCallLogEntityResolver {
    constructor(private readonly actorService: McpActorService) {}

    // Not `@Allow`: that would error on every row, and the log should stay readable for admins without customer access.
    @ResolveField()
    input(@Parent() log: McpToolCallLog, @Ctx() ctx: RequestContext): unknown {
        return personalField(ctx, log.input);
    }

    @ResolveField()
    output(@Parent() log: McpToolCallLog, @Ctx() ctx: RequestContext): unknown {
        return personalField(ctx, log.output);
    }

    @ResolveField()
    clientIp(@Parent() log: McpToolCallLog, @Ctx() ctx: RequestContext): string | null {
        return personalField(ctx, log.clientIp);
    }

    // Resolved per row rather than joined, since the stored id points at either a Customer or an Administrator.
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

@Resolver('McpOauthGrant')
export class McpOauthGrantEntityResolver {
    constructor(private readonly actorService: McpActorService) {}

    // The client is loaded as a re lation by the list query; the schema exposes only its name.
    @ResolveField()
    oauthClientName(@Parent() grant: McpOauthGrant): string | null {
        return grant.oauthClient?.clientName ?? null;
    }

    @ResolveField()
    async actorName(@Parent() grant: McpOauthGrant, @Ctx() ctx: RequestContext): Promise<string | null> {
        const identity = await this.actorService.resolveIdentity(ctx, grant.actorId, grant.actorType);
        return identity.name;
    }

    @ResolveField()
    async customerId(@Parent() grant: McpOauthGrant, @Ctx() ctx: RequestContext): Promise<ID | null> {
        const identity = await this.actorService.resolveIdentity(ctx, grant.actorId, grant.actorType);
        return identity.customerId;
    }
}
