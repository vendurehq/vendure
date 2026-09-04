import { Inject, Injectable } from '@nestjs/common';
import { EventBus, Logger, RequestContext, TransactionalConnection } from '@vendure/core';

import { loggerCtx, MCP_PLUGIN_OPTIONS } from '../constants';
import { McpOauthGrant } from '../entities/mcp-oauth-grant.entity';
import { McpToolCallLog } from '../entities/mcp-tool-call-log.entity';
import { McpToolCallEvent } from '../events/mcp-tool-call.event';
import { McpExecutionContext, ResolvedMcpPluginOptions } from '../internal-types';
import { McpRegisteredTool } from '../registry/registry-types';
import { McpActorType, McpToolCallStatus } from '../types';

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
        private readonly connection: TransactionalConnection,
        private readonly eventBus: EventBus,
        @Inject(MCP_PLUGIN_OPTIONS) private readonly options: ResolvedMcpPluginOptions,
    ) {}

    async logToolCall(call: LogToolCallInput): Promise<void> {
        const { ctx, grant, clientIp } = call.executionContext;
        let saved = false;
        try {
            const log = new McpToolCallLog({
                grantId: grant?.id ?? null,
                actor: this.resolveActor(grant, ctx),
                actorType: this.resolveActorType(grant, ctx),
                channelId: grant ? (grant.channelId ?? null) : (ctx.channelId ?? null),
                clientIp: this.options.logging.captureClientIp ? (clientIp ?? null) : null,
                toolName: call.tool.name,
                pluginSource: call.tool.pluginSource,
                durationMs: call.durationMs,
                status: call.status,
                oauthClientId: grant?.oauthClientId ?? null,
            });
            const bodies = this.captureBodies(call);
            log.input = bodies.input;
            log.output = bodies.output;
            await this.connection.getRepository(ctx, McpToolCallLog).save(log);
            saved = true;
            await this.eventBus.publish(new McpToolCallEvent(ctx, log));
        } catch (e) {
            const reason = e instanceof Error ? e.message : String(e);
            if (saved) {
                Logger.warn(
                    `Recorded MCP tool call "${call.tool.name}" but publishing its McpToolCallEvent failed: ${reason}`,
                    loggerCtx,
                );
            } else {
                Logger.warn(`Failed to record MCP tool call "${call.tool.name}": ${reason}`, loggerCtx);
            }
        }
    }

    private resolveActor(grant: McpOauthGrant | undefined, ctx: RequestContext): string | null {
        if (grant?.actorId != null) {
            return String(grant.actorId);
        }
        if (ctx.activeUserId != null) {
            return String(ctx.activeUserId);
        }
        return null;
    }

    private resolveActorType(grant: McpOauthGrant | undefined, ctx: RequestContext): McpActorType {
        if (grant?.actorType != null) {
            return grant.actorType;
        }
        if (ctx.apiType === 'admin') {
            return 'admin';
        }
        if (ctx.activeUserId != null) {
            return 'customer';
        }
        return 'anonymous';
    }

    /** Both `input` and `output` come back null in `metadata` capture mode, or if the operator's redact function throws. */
    private captureBodies(call: LogToolCallInput): { input: unknown; output: unknown } {
        const logging = this.options.logging;
        if (logging.capture !== 'full') {
            return { input: null, output: null };
        }
        let bodies: { input: unknown; output: unknown } | undefined;
        if (logging.redact) {
            try {
                bodies = logging.redact({
                    toolName: call.tool.name,
                    input: call.input,
                    output: call.output,
                });
            } catch (redactError) {
                const reason = redactError instanceof Error ? redactError.message : String(redactError);
                Logger.warn(
                    `The configured logging.redact function threw while redacting tool call ` +
                        `"${call.tool.name}": ${reason}. ` +
                        `The call was recorded without its input/output bodies.`,
                    loggerCtx,
                );
            }
        } else {
            bodies = { input: call.input, output: call.output };
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
}
