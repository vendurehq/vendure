import { McpServer } from '@modelcontextprotocol/server';
import { McpToolset } from '@vendure/mcp-sdk';

import { McpExecutionContext } from '../internal-types';
import { McpToolRegistryService } from '../registry/mcp-tool-registry.service';

/** Version advertised in the MCP server's `serverInfo`. Cosmetic — the MCP server implementation version. */
const MCP_SERVER_VERSION = '1.0.0';

/**
 * @description
 * Builds a fresh v2 `McpServer` for a single request, registering only the caller's permitted tool
 * subset from the registry. Each tool is registered with its cached compiled schema (compiled once
 * at bootstrap — the factory never calls `fromJsonSchema`) and a callback that delegates to the
 * registry's single execution entry.
 *
 * @since 3.8.0
 */
export async function createMcpServerForRequest(
    executionContext: McpExecutionContext,
    toolset: McpToolset,
    registry: McpToolRegistryService,
): Promise<McpServer> {
    const server = new McpServer(
        { name: `vendure-mcp-${toolset}`, version: MCP_SERVER_VERSION },
        // Overrides the SDK default of true: every request gets a throwaway server with no open connection to notify clients on.
        { capabilities: { tools: { listChanged: false } } },
    );
    const tools = await registry.getExposedTools(executionContext, toolset);
    for (const tool of tools) {
        server.registerTool(
            tool.name,
            {
                title: tool.title,
                description: tool.description,
                inputSchema: tool.compiledInputSchema,
                annotations: tool.annotations,
            },
            // The SDK validates `args` against the registered (wire) schema before this runs.
            async (args: unknown) => registry.callTool(executionContext, toolset, tool.name, args),
        );
    }
    return server;
}
