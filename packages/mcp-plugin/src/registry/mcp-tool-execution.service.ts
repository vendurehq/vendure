import { CallToolResult } from '@modelcontextprotocol/server';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { RequestContext } from '@vendure/core';
import { McpToolset } from '@vendure/mcp-sdk';

import { McpToolSummary } from '../types';

import { McpToolRegistryService } from './mcp-tool-registry.service';

/**
 * @description
 * Lists and runs MCP tools from code running inside the Vendure process, typically a chat
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
     * Returns the tools in the given toolset that this caller may execute. Each
     * {@link McpToolSummary} carries the input schema a call to that tool must satisfy. The list
     * leaves out disabled tools and tools the caller has no permission for.
     *
     * Pass the `RequestContext` of the shopper or administrator you are listing tools for. The
     * `'shop'` toolset requires a Shop API context and `'admin'` requires an Admin API context.
     * Passing the wrong one throws.
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
     * Runs one named tool in the given toolset and returns its `CallToolResult`. Pass the
     * `RequestContext` of the shopper or administrator the tool runs as, the tool name, and the
     * arguments that tool declares. Omitting `input` calls the tool with no arguments.
     *
     * The `'shop'` toolset requires a Shop API context and `'admin'` requires an Admin API
     * context. Passing the wrong one throws.
     *
     * Most failures come back as a result with `isError: true` rather than as a thrown error.
     * That covers invalid arguments, a missing permission, an exceeded rate limit, an unknown or
     * disabled tool, and an error thrown by the tool itself. Destructive tools need
     * `confirm: true` in the input, otherwise the result asks for confirmation instead of
     * running the tool.
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
