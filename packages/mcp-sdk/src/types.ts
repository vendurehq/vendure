import type { ToolBehavior } from '@vendure/common/lib/command';

/**
 * @description
 * Which API a tool uses: `shop` tools work over the Shop API, `admin` tools over
 * the Admin API.
 *
 * @docsCategory mcp-sdk
 * @since 3.8.0
 */
export type McpToolset = 'shop' | 'admin';

/**
 * @description
 * How a tool behaves, which tells the MCP server how to expose it: `readonly` tools
 * only read data, `mutating` tools change it, and `destructive` tools ask for
 * consent before running: the first call returns an `incomplete` result with a preview and a
 * digest, and the tool runs when it is called again with `confirm` set to that digest.
 *
 * @docsCategory mcp-sdk
 * @since 3.8.0
 */
export type McpToolBehavior = ToolBehavior;
