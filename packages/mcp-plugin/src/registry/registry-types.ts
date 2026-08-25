import type { StandardSchemaWithJSON, ToolAnnotations } from '@modelcontextprotocol/server';
import { McpJsonSchema, McpToolBehavior, McpToolHandler, McpToolMetadata } from '@vendure/mcp-sdk';

/**
 * @description
 * A discovered `@McpTool` provider, enriched by the registry at bootstrap. This is the registry's
 * single source of truth, consumed by the transport factory and the admin API.
 */
export interface McpRegisteredTool extends McpToolMetadata {
    /** The discovered provider instance (implements `execute`). */
    handler: McpToolHandler;
    /** Name of the Nest module/host that declared the provider. */
    pluginSource: string;
    /** The tool's `behavior`, defaulting to `mutating` when not declared. */
    resolvedBehavior: McpToolBehavior;
    /** MCP annotations derived from behavior; surfaced to the agent in `tools/list` and `search_tools`. */
    annotations: ToolAnnotations;
    /**
     * The tool's original input schema. Derived once during discovery from the tool's
     * `inputSchema`, or a default no-args schema when none is provided. This schema is
     * never modified; additional fields are added to a separate copy for the wire schema.
     */
    jsonInputSchema: McpJsonSchema;
    /**
     * Validator for the final input schema. Created once during startup and reused to
     * validate tool calls.
     */
    compiledInputSchema: StandardSchemaWithJSON;
    /**
     * The final input schema exposed to callers. It is based on `jsonInputSchema` and may
     * include optional `confirm` or `sessionToken` fields when required. If no fields are
     * added, it is the same schema as `jsonInputSchema`.
     */
    wireJsonSchema: McpJsonSchema;
    /** Compiled validator for the declared output schema, if any. */
    compiledOutputSchema?: StandardSchemaWithJSON;
}

/**
 * @description
 * A tool as handed to the per-request transport for registration with the MCP server: exactly the
 * fields the SDK registration call needs. Real tools satisfy it as-is; the discovery meta-tools
 * (`search_tools` / `execute_tool`) are built directly in this shape, since they have no handler
 * of their own (they are routed by name in `callTool`) and belong to no single toolset.
 */
export type McpExposedTool = Pick<
    McpRegisteredTool,
    'name' | 'title' | 'description' | 'compiledInputSchema' | 'annotations'
>;
