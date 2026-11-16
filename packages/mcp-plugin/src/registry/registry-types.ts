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
    /** Decided once at discovery, so the advertised schema and the call-time session exchange cannot disagree. */
    acceptsSessionToken: boolean;
    compiledInputSchema: StandardSchemaWithJSON;
    /** The author's schema, with optional `confirm` or `sessionToken` fields added when required. */
    wireJsonSchema: McpJsonSchema;
    /** Compiled validator for the declared output schema, if any. */
    compiledOutputSchema?: StandardSchemaWithJSON;
}

/**
 * @description
 * A tool as handed to the per-request transport for registration: only the fields the SDK's
 * registration call needs. Real tools satisfy it as-is. The discovery meta-tools (`search_tools` /
 * `execute_tool`) share this shape too, since they have no handler of their own. They're routed
 * by name in `callTool` and belong to no single toolset.
 */
export type McpExposedTool = Pick<
    McpRegisteredTool,
    'name' | 'title' | 'description' | 'compiledInputSchema' | 'annotations'
>;
