import { McpServer } from '@modelcontextprotocol/server';
import { McpToolset } from '@vendure/mcp-sdk';

import { MCP_TOOL_KEYWORDS_META_KEY } from '../constants';
import { McpExecutionContext } from '../internal-types';
import { McpToolRegistryService } from '../registry/mcp-tool-registry.service';

/** Version advertised in the MCP server's `serverInfo`. Cosmetic — the MCP server implementation version. */
const MCP_SERVER_VERSION = '1.0.0';

/**
 * @description
 * Builds a fresh v2 `McpServer` for a single request, registering only the tools the caller is
 * permitted to see. Each tool is registered with its schema, compiled once at bootstrap, and a
 * callback that delegates to the registry's execution entry point.
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
                // A client that builds its own tool search, such as the Developer MCP, uses these.
                // No output schema is sent: a destructive tool's first result is `incomplete`, so
                // its declared output schema would not describe it.
                ...(tool.keywords?.length ? { _meta: { [MCP_TOOL_KEYWORDS_META_KEY]: tool.keywords } } : {}),
            },
            // The SDK validates `args` against the registered (wire) schema before this runs.
            async (args: unknown) => registry.callTool(executionContext, toolset, tool.name, args),
        );
    }
    return server;
}
