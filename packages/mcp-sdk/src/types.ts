/**
 * @description
 * Which API a tool uses: `shop` tools work over the Shop API, `admin` tools over
 * the Admin API.
 *
 * @docsCategory core plugins/McpPlugin
 * @since 3.8.0
 */
export type McpToolset = 'shop' | 'admin';

/**
 * @description
 * How a tool behaves, which tells the MCP server how to expose it: `readonly` tools
 * only read data, `mutating` tools change it, and `destructive` tools ask for
 * confirmation before running.
 *
 * @docsCategory core plugins/McpPlugin
 * @since 3.8.0
 */
export type McpToolBehavior = 'readonly' | 'mutating' | 'destructive';
