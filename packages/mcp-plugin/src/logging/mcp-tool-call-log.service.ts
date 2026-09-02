import { Inject, Injectable } from '@nestjs/common';
import { EventBus, ID, Logger, RequestContext, TransactionalConnection } from '@vendure/core';

import { loggerCtx, MCP_PLUGIN_OPTIONS, MS_PER_DAY, RETENTION_DELETE_BATCH_SIZE } from '../constants';
import { McpToolCallLog } from '../entities/mcp-tool-call-log.entity';
import { McpToolCallEvent } from '../events/mcp-tool-call.event';
import { McpExecutionContext, ResolvedMcpPluginOptions } from '../internal-types';
import { McpRegisteredTool } from '../registry/registry-types';
import { McpToolCallStatus } from '../types';

export interface LogToolCallInput {
    executionContext: McpExecutionContext;
    tool: McpRegisteredTool;
    input: unknown;
    output: unknown;
    durationMs: number;
    status: McpToolCallStatus;
}

@Injectable()
export class McpToolCallLogService {
    constructor(
        private connection: TransactionalConnection,
        private eventBus: EventBus,
        @Inject(MCP_PLUGIN_OPTIONS) private options: ResolvedMcpPluginOptions,
    ) {}

    async logToolCall(input: LogToolCallInput): Promise<void> {
        const { ctx, grant, clientIp } = input.executionContext;
        let saved = false;
        try {
            const log = new McpToolCallLog({
                grantId: grant?.id ?? null,
                actor:
                    grant?.actorId != null
                        ? String(grant.actorId)
                        : ctx.activeUserId != null
                          ? String(ctx.activeUserId)
                          : null,
                actorType:
                    grant?.actorType ??
                    (ctx.apiType === 'admin' ? 'admin' : ctx.activeUserId != null ? 'customer' : 'anonymous'),
                channelId: grant ? (grant.channelId ?? null) : (ctx.channelId ?? null),
                clientIp: this.options.logging.captureClientIp ? (clientIp ?? null) : null,
                toolName: input.tool.name,
                pluginSource: input.tool.pluginSource,
                durationMs: input.durationMs,
                status: input.status,
                oauthClientId: grant?.oauthClientId ?? null,
            });
            const bodies = this.captureBodies(input);
            log.input = bodies.input;
            log.output = bodies.output;
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

    /**
     * The `input` and `output` values to store on the log row. Both are null in `metadata` capture
     * mode, and both are null when the operator's redact function throws.
     */
    private captureBodies(input: LogToolCallInput): { input: unknown; output: unknown } {
        const logging = this.options.logging;
        if (logging.capture !== 'full') {
            return { input: null, output: null };
        }
        let bodies: { input: unknown; output: unknown } | undefined;
        if (logging.redact) {
            try {
                bodies = logging.redact({
                    toolName: input.tool.name,
                    input: input.input,
                    output: input.output,
                });
            } catch (redactError) {
                const reason = redactError instanceof Error ? redactError.message : String(redactError);
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
        return { input: this.capBody(bodies?.input), output: this.capBody(bodies?.output) };
    }

    private capBody(value: unknown): unknown {
        if (value == null) {
            return null;
        }
        const maxBodyBytes = this.options.logging.maxBodyBytes;
        const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
        if (bytes > maxBodyBytes) {
            return { omitted: `body exceeded logging.maxBodyBytes (${maxBodyBytes} bytes)`, bytes };
        }
        return value;
    }

    async deleteExpiredToolCallLogs(ctx: RequestContext, channelId?: ID | null): Promise<number> {
        const ttlDays = this.options.logging.ttlDays;
        if (ttlDays === 0) {
            return 0;
        }
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
                // A channel only ever prunes its own rows, matching what it can see in the
                // dashboard log list.
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
