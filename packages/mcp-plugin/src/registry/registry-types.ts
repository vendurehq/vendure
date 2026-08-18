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
     * The canonical input schema (single source of truth). Derived once at discovery: the tool's
     * `inputSchema`, or the no-args default when none is declared. Never mutated — the destructive
     * `confirm` field is injected onto a clone (see the wire schema below).
     */
    jsonInputSchema: McpJsonSchema;
    /**
     * Compiled validator for the WIRE input schema (canonical schema plus the injected optional
     * `confirm` field for destructive tools). Compiled once at bootstrap; registered with the SDK
     * per request and reused for discovery-path (`execute_tool`) inner-argument validation.
     */
    compiledInputSchema: StandardSchemaWithJSON;
    /**
     * The WIRE input schema: the canonical schema plus, for destructive tools, the injected
     * optional `confirm` field. This is what is registered with the SDK and advertised in tool
     * summaries — the schema a call must actually satisfy. For non-destructive tools it is the
     * same object as `jsonInputSchema`.
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
