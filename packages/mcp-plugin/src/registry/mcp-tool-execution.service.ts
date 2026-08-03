import { CallToolResult } from '@modelcontextprotocol/server';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { RequestContext } from '@vendure/core';
import { McpToolset } from '@vendure/mcp-sdk';

import { McpToolSummary } from '../types';

import { McpToolRegistryService } from './mcp-tool-registry.service';

/**
 * @description
 * Lists and runs MCP tools from code running inside the Vendure process — typically a chat
 * assistant a merchant builds as a plugin. Calls go through the same pipeline as HTTP requests,
 * so things like permissions, rate limits, validation, confirmations, and logging behave the same.
 *
 * Always pass the original `ctx` you received. Tools run as that user, and
 * creating a new context can lead to wrong permissions.
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
    constructor(private registry: McpToolRegistryService) {}

    /**
     * @description
     * Lists the tools this caller may execute. Filters out disabled tools and those the user has no permission for.
     *
     * Always lists the real tools. The `toolExposure: 'discovery'` option only shrinks the tool
     * list served over HTTP; it does not apply here.
     */
    async listTools(ctx: RequestContext, toolset: McpToolset): Promise<McpToolSummary[]> {
        this.assertContextMatchesToolset(ctx, toolset);
        return this.registry.getCallableTools(ctx, toolset);
    }

    /**
     * @description
     * Runs a tool and returns its result.
     *
     * Most errors (invalid input, no permission, rate limits, tool failure, etc.)
     * are returned as `isError` instead of throwing.  Destructive tools require `confirm: true`,
     * otherwise they return a confirmation-needed response.
     */
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
