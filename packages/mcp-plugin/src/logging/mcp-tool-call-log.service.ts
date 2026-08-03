import { Inject, Injectable } from '@nestjs/common';
import { EventBus, ID, Logger, RequestContext, TransactionalConnection } from '@vendure/core';

import {
    DEFAULT_LOG_TTL_DAYS,
    loggerCtx,
    MCP_PLUGIN_OPTIONS,
    MS_PER_DAY,
    RETENTION_DELETE_BATCH_SIZE,
} from '../constants';
import { McpToolCallLog } from '../entities/mcp-tool-call-log.entity';
import { McpToolCallEvent } from '../events/mcp-tool-call.event';
import { McpExecutionContext, McpPluginOptions, McpRegisteredTool, McpToolCallStatus } from '../types';

/** Input to the (Phase-6) tool-call logger. */
export interface LogToolCallInput {
    executionContext: McpExecutionContext;
    tool: McpRegisteredTool;
    input: unknown;
    output: unknown;
    durationMs: number;
    status: McpToolCallStatus;
}

/**
 * @description
 * Records MCP tool calls and publishes `McpToolCallEvent`s. Prunes expired logs per the
 * configured `logging.ttlDays` retention window.
 */
@Injectable()
export class McpToolCallLogService {
    constructor(
        private connection: TransactionalConnection,
        private eventBus: EventBus,
        @Inject(MCP_PLUGIN_OPTIONS) private options: McpPluginOptions,
    ) {}

    async logToolCall(input: LogToolCallInput): Promise<void> {
        const { ctx, grant } = input.executionContext;
        let saved = false;
        try {
            const log = new McpToolCallLog({
                grantId: grant?.id ?? null,
                // A grant carries the actor when the call arrived over OAuth. Without one the
                // context is the only identity there is: an in-process caller passes a signed-in
                // shopper's context, while the anonymous shop endpoint has nobody signed in.
                actor:
                    grant?.userId != null
                        ? String(grant.userId)
                        : ctx.activeUserId != null
                          ? String(ctx.activeUserId)
                          : null,
                actorType:
                    grant?.userType ??
                    (ctx.apiType === 'admin' ? 'admin' : ctx.activeUserId != null ? 'customer' : 'anonymous'),
                channelId: ctx.channelId ?? null,
                toolName: input.tool.name,
                pluginSource: input.tool.pluginSource,
                durationMs: input.durationMs,
                status: input.status,
                oauthClientId: grant?.oauthClientId ?? null,
            });
            const logging = this.options.logging;
            if (logging?.capture === 'full') {
                const bodies = logging.redact
                    ? logging.redact({
                          toolName: input.tool.name,
                          input: input.input,
                          output: input.output,
                      })
                    : { input: input.input, output: input.output };
                log.input = bodies.input ?? null;
                log.output = bodies.output ?? null;
            } else {
                log.input = null;
                log.output = null;
            }
            await this.connection.getRepository(ctx, McpToolCallLog).save(log);
            saved = true;
            await this.eventBus.publish(new McpToolCallEvent(ctx, log));
        } catch (e) {
            const reason = e instanceof Error ? e.message : String(e);
            if (saved) {
                Logger.warn(
                    `Recorded MCP tool call "${input.tool.name}" but publishing its McpToolCallEvent failed: ${reason}`,
                    loggerCtx,
                );
            } else {
                Logger.warn(`Failed to record MCP tool call "${input.tool.name}": ${reason}`, loggerCtx);
            }
        }
    }

    async deleteExpiredToolCallLogs(ctx: RequestContext, channelId?: ID | null): Promise<number> {
        const ttlDays = this.options.logging?.ttlDays ?? DEFAULT_LOG_TTL_DAYS;
        const cutoff = new Date(Date.now() - ttlDays * MS_PER_DAY);
        const repository = this.connection.getRepository(ctx, McpToolCallLog);
        let totalDeleted = 0;
        for (;;) {
            const query = repository
                .createQueryBuilder('log')
                .select('log.id', 'id')
                .where('log.createdAt < :cutoff', { cutoff })
                .limit(RETENTION_DELETE_BATCH_SIZE);
            if (channelId != null) {
                query.andWhere('log.channelId = :channelId', { channelId });
            }
            const expired = await query.getRawMany<{ id: ID }>();
            if (expired.length === 0) {
                break;
            }
            const result = await repository
                .createQueryBuilder()
                .delete()
                .where('id IN (:...ids)', { ids: expired.map(row => row.id) })
                .execute();
            totalDeleted += result.affected ?? expired.length;
            if (expired.length < RETENTION_DELETE_BATCH_SIZE) {
                break;
            }
        }
        return totalDeleted;
    }
}
