import { Inject, Injectable } from '@nestjs/common';
import { EventBus, ID, Logger, RequestContext, TransactionalConnection } from '@vendure/core';

import {
    DEFAULT_LOG_MAX_BODY_BYTES,
    DEFAULT_LOG_TTL_DAYS,
    loggerCtx,
    MCP_PLUGIN_OPTIONS,
    MS_PER_DAY,
    RETENTION_DELETE_BATCH_SIZE,
} from '../constants';
import { McpToolCallLog } from '../entities/mcp-tool-call-log.entity';
import { McpToolCallEvent } from '../events/mcp-tool-call.event';
import { McpExecutionContext } from '../internal-types';
import { McpRegisteredTool } from '../registry/registry-types';
import { McpPluginOptions, McpToolCallStatus } from '../types';

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
        const { ctx, grant, clientIp } = input.executionContext;
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
                // Calls under a grant are logged with the grant's channel. Null means the grant
                // is global (admin approvals store no channel), so its rows stay visible on
                // every channel's dashboard, the same way the grant itself is listed.
                channelId: grant ? (grant.channelId ?? null) : (ctx.channelId ?? null),
                clientIp: this.options.logging?.captureClientIp ? (clientIp ?? null) : null,
                toolName: input.tool.name,
                pluginSource: input.tool.pluginSource,
                durationMs: input.durationMs,
                status: input.status,
                oauthClientId: grant?.oauthClientId ?? null,
            });
            const logging = this.options.logging;
            if (logging?.capture === 'full') {
                let bodies: { input: unknown; output: unknown } | undefined;
                if (logging.redact) {
                    try {
                        bodies = logging.redact({
                            toolName: input.tool.name,
                            input: input.input,
                            output: input.output,
                        });
                    } catch (redactError) {
                        // A broken redact function must not cost the audit row, and raw bodies must never be stored.
                        const reason =
                            redactError instanceof Error ? redactError.message : String(redactError);
                        Logger.warn(
                            `The configured logging.redact function threw while redacting tool call ` +
                                `"${input.tool.name}": ${reason}. ` +
                                `The call was recorded without its input/output bodies.`,
                            loggerCtx,
                        );
                    }
                } else {
                    bodies = { input: input.input, output: input.output };
                }
                log.input = this.capBody(bodies?.input);
                log.output = this.capBody(bodies?.output);
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

    private capBody(value: unknown): unknown {
        if (value == null) {
            return null;
        }
        const maxBodyBytes = this.options.logging?.maxBodyBytes ?? DEFAULT_LOG_MAX_BODY_BYTES;
        const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
        if (bytes > maxBodyBytes) {
            return { omitted: `body exceeded logging.maxBodyBytes (${maxBodyBytes} bytes)`, bytes };
        }
        return value;
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
                // Channel-less rows come from global (admin) grants; they are visible on
                // every channel, so any channel may also sweep them.
                query.andWhere('(log.channelId = :channelId OR log.channelId IS NULL)', { channelId });
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
