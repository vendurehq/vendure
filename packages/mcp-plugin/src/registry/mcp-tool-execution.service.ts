import { CallToolResult } from '@modelcontextprotocol/server';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { RequestContext } from '@vendure/core';
import { McpToolset } from '@vendure/mcp-sdk';

import { McpToolSummary } from '../types';

import { McpToolRegistryService } from './mcp-tool-registry.service';

/**
 * @description
 * Lists and runs MCP tools from inside the Vendure process. Calls use the same pipeline as HTTP
 * requests, including permissions, rate limits, validation, confirmations, and logging.
 *
 * Always pass the original `ctx` you received so the tool runs with the correct permissions and
 * session. Anonymous shop tools can use a `sessionToken` to continue the same shopper session.
 *
 * @example
 * ```ts
 * import { Injectable } from '\@nestjs/common';
 * import { RequestContext } from '\@vendure/core';
 * import { McpToolExecutionService } from '\@vendure/mcp-plugin';
 *
 * \@Injectable()
 * export class AssistantService {
 *     constructor(private mcpToolExecution: McpToolExecutionService) {}
 *
 *     async reply(ctx: RequestContext, message: string) {
 *         const tools = await this.mcpToolExecution.listTools(ctx, 'shop');
 *         // Hand `tools` to your model, then run whichever one it picks:
 *         return this.mcpToolExecution.executeTool(ctx, 'shop', 'search_products', {
 *             query: message,
 *         });
 *     }
 * }
 * ```
 *
 * @docsCategory core plugins/McpPlugin
 * @since 3.8.0
 */
@Injectable()
export class McpToolExecutionService {
    constructor(private readonly registry: McpToolRegistryService) {}

    /** The context must match the toolset: a Shop API context for `'shop'`, an Admin API context for `'admin'`. */
    async listTools(ctx: RequestContext, toolset: McpToolset): Promise<McpToolSummary[]> {
        this.assertContextMatchesToolset(ctx, toolset);
        return this.registry.getCallableTools(ctx, toolset);
    }

    /** Most failures come back as `isError: true` rather than thrown. Destructive tools require `confirm: true`. */
    async executeTool(
        ctx: RequestContext,
        toolset: McpToolset,
        toolName: string,
        input?: unknown,
    ): Promise<CallToolResult> {
        this.assertContextMatchesToolset(ctx, toolset);
        return this.registry.callToolDirect({ ctx }, toolset, toolName, input ?? {});
    }

    private assertContextMatchesToolset(ctx: RequestContext, toolset: McpToolset): void {
        if (ctx.apiType !== toolset) {
            throw new ForbiddenException(
                `The "${toolset}" MCP toolset requires a ${toolset} API RequestContext, ` +
                    `but the supplied context is for the "${ctx.apiType}" API.`,
            );
        }
    }
}
