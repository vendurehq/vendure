import {
    CallToolResult,
    fromJsonSchema,
    JsonSchemaType,
    StandardSchemaV1,
    StandardSchemaWithJSON,
    ToolAnnotations,
} from '@modelcontextprotocol/server';
import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { Instrument, Logger, Permission, RequestContext, SettingsStoreService } from '@vendure/core';
import { McpJsonSchema, McpTool, McpToolBehavior, McpToolMetadata, McpToolset } from '@vendure/mcp-sdk';

import { loggerCtx, MCP_PLUGIN_OPTIONS, MCP_TOOL_TOGGLES_STORE_KEY } from '../constants';
import { McpToolCallLogService } from '../logging/mcp-tool-call-log.service';
import { McpRateLimiterService, McpRateLimitExceededError } from '../rate-limit/mcp-rate-limiter.service';
import {
    McpExecutionContext,
    McpExposedTool,
    McpPluginOptions,
    McpPluginToolHandler,
    McpRegisteredTool,
    McpToolSummary,
} from '../types';

import { Bm25Index } from './bm25';

/** Discovery meta-tool names — reserved so user tools cannot collide with them. */
const SEARCH_TOOLS = 'search_tools';
const EXECUTE_TOOL = 'execute_tool';
const RESERVED_META_TOOL_NAMES: readonly string[] = [SEARCH_TOOLS, EXECUTE_TOOL];
const NO_ARGS_SCHEMA: McpJsonSchema = { type: 'object', properties: {}, additionalProperties: false };

/**
 * @description
 * Single source of truth for discovered `@McpTool` providers. It discovers tools at bootstrap,
 * compiles their schemas once, and owns visibility, toggles, behavior,
 * permissions, and execution.
 */
@Injectable()
@Instrument()
export class McpToolRegistryService implements OnApplicationBootstrap {
    private readonly tools = new Map<string, McpRegisteredTool>();
    private discoveryMetaTools: McpExposedTool[] = [];
    private bm25 = new Map<McpToolset, Bm25Index>();

    constructor(
        private discoveryService: DiscoveryService,
        private settingsStoreService: SettingsStoreService,
        private rateLimiter: McpRateLimiterService,
        private toolCallLog: McpToolCallLogService,
        @Inject(MCP_PLUGIN_OPTIONS) private options: McpPluginOptions,
    ) {}

    onApplicationBootstrap(): void {
        this.discoverTools();
        this.discoveryMetaTools = this.buildDiscoveryMetaTools();
        this.bm25 = this.buildSearchIndexes();
    }

    // ---------------------------------------------------------------------------------------------
    // Public surface (eight members)
    // ---------------------------------------------------------------------------------------------

    /** Every registered tool. Consumed by the admin API. */
    getRegistrySnapshot(): McpRegisteredTool[] {
        return [...this.tools.values()];
    }

    /**
     * The tools to register with the per-request MCP server. In `direct` mode: the caller's permitted,
     * enabled tools for the toolset. In `discovery` mode: the two meta-tools (`search_tools` +
     * `execute_tool`).
     */
    async getExposedTools(
        executionContext: McpExecutionContext,
        toolset: McpToolset,
    ): Promise<McpExposedTool[]> {
        if (this.options.toolExposure === 'discovery') {
            return this.discoveryMetaTools;
        }
        const toggles = await this.getToolToggles(executionContext.ctx);
        return this.visibleTools(executionContext, toolset, toggles);
    }

    /**
     * The only public execution entry. Routes discovery meta-tools; everything else runs the shared
     * funnel. For a direct call the SDK has already validated `input` against the registered schema;
     * for an `execute_tool` call the funnel validates the inner arguments itself.
     */
    async callTool(
        executionContext: McpExecutionContext,
        toolset: McpToolset,
        name: string,
        input: unknown,
    ): Promise<CallToolResult> {
        if (name === SEARCH_TOOLS) {
            return this.searchTools(executionContext, toolset, input);
        }
        if (name === EXECUTE_TOOL) {
            return this.executeToolViaDiscovery(executionContext, toolset, input);
        }
        return this.callRegisteredTool(executionContext, toolset, name, input);
    }

    /**
     * The tools an in-process caller may run: the toolset's tools, minus disabled ones, minus those
     * the context has no permission for. Unlike {@link getExposedTools} this ignores `toolExposure`,
     * because the discovery meta-tools exist to keep a remote agent's tool list small and give an
     * in-process caller nothing.
     */
    async getCallableTools(ctx: RequestContext, toolset: McpToolset): Promise<McpToolSummary[]> {
        const toggles = await this.getToolToggles(ctx);
        return this.visibleTools({ ctx }, toolset, toggles).map(tool => this.toolSummary(tool));
    }

    /**
     * Runs one named tool through the shared funnel, validating its input. Skips the meta-tool
     * routing in {@link callTool}, so `search_tools` and `execute_tool` are unknown names here —
     * a caller using this already knows which tool it wants.
     */
    callToolDirect(
        executionContext: McpExecutionContext,
        toolset: McpToolset,
        name: string,
        input: unknown,
    ): Promise<CallToolResult> {
        return this.callRegisteredTool(executionContext, toolset, name, input, true);
    }

    /** Reads the tool-enablement map from the settings store (empty when unset). */
    async getToolToggles(ctx: RequestContext): Promise<Record<string, boolean>> {
        return (
            (await this.settingsStoreService.get<Record<string, boolean>>(ctx, MCP_TOOL_TOGGLES_STORE_KEY)) ??
            {}
        );
    }

    /** A tool is enabled unless explicitly disabled. One canonical key: `${toolset}:${name}`. */
    isToolEnabled(
        tool: Pick<McpRegisteredTool, 'toolset' | 'name'>,
        toggles: Record<string, boolean>,
    ): boolean {
        return toggles[this.toolToggleKey(tool.toolset, tool.name)] !== false;
    }

    /** Enables or disables a tool. Writes the one canonical key. */
    async setToolEnabled(
        ctx: RequestContext,
        toolset: McpToolset,
        name: string,
        enabled: boolean,
    ): Promise<void> {
        const toggles = await this.getToolToggles(ctx);
        toggles[this.toolToggleKey(toolset, name)] = enabled;
        await this.settingsStoreService.set(ctx, MCP_TOOL_TOGGLES_STORE_KEY, toggles);
    }

    // ---------------------------------------------------------------------------------------------
    // Discovery + bootstrap schema gate
    // ---------------------------------------------------------------------------------------------

    private discoverTools(): void {
        this.tools.clear();
        for (const wrapper of this.discoveryService.getProviders()) {
            const metadata = this.discoveryService.getMetadataByDecorator(McpTool, wrapper);
            const instance = wrapper.instance as Partial<McpPluginToolHandler> | undefined;
            if (!metadata || !instance) {
                continue;
            }
            if (typeof instance.execute !== 'function') {
                throw new Error(
                    `MCP tool provider ${String(wrapper.name ?? metadata.name)} must implement execute()`,
                );
            }
            const entry = this.buildRegisteredTool(
                metadata,
                instance as McpPluginToolHandler,
                this.getPluginSource(wrapper),
            );
            this.registerTool(entry);
        }
        Logger.info(`Discovered ${this.tools.size} MCP tools`, loggerCtx);
    }

    /**
     * Builds one registered tool, applying the bootstrap schema gate: reject non-JSON schemas,
     * default a missing input schema, assert destructive tools don't declare their own `confirm`,
     * and compile the wire input (and any output) schema once — a throw here aborts boot.
     */
    private buildRegisteredTool(
        metadata: McpToolMetadata,
        handler: McpPluginToolHandler,
        pluginSource: string,
    ): McpRegisteredTool {
        if (metadata.inputSchema !== undefined && !this.isMcpJsonSchema(metadata.inputSchema)) {
            throw new Error(
                `MCP tool "${metadata.name}" (${pluginSource}): inputSchema must be a plain JSON Schema ` +
                    `object ({ type: 'object', ... }). JSON Schema or bust.`,
            );
        }
        if (metadata.outputSchema !== undefined && !this.isMcpJsonSchema(metadata.outputSchema)) {
            throw new Error(
                `MCP tool "${metadata.name}" (${pluginSource}): outputSchema must be a plain JSON Schema object.`,
            );
        }
        const resolvedBehavior = this.getToolBehavior(metadata);
        const jsonInputSchema = metadata.inputSchema ?? NO_ARGS_SCHEMA;
        if (resolvedBehavior === 'destructive' && jsonInputSchema.properties?.confirm !== undefined) {
            throw new Error(
                `MCP tool "${metadata.name}" (${pluginSource}) is destructive and must not declare its own ` +
                    `"confirm" property — the registry injects it.`,
            );
        }
        const entry: McpRegisteredTool = {
            ...metadata,
            handler,
            pluginSource,
            resolvedBehavior,
            annotations: this.deriveAnnotations(metadata, resolvedBehavior),
            jsonInputSchema,
            jsonOutputSchema: metadata.outputSchema,
            compiledInputSchema: undefined as unknown as StandardSchemaWithJSON,
        };
        entry.compiledInputSchema = this.compileSchema(
            this.wireInputSchema(entry),
            `${metadata.name} inputSchema`,
            pluginSource,
        );
        if (entry.jsonOutputSchema) {
            entry.compiledOutputSchema = this.compileSchema(
                entry.jsonOutputSchema,
                `${metadata.name} outputSchema`,
                pluginSource,
            );
        }
        return entry;
    }

    private compileSchema(
        schema: McpJsonSchema,
        label: string,
        pluginSource: string,
    ): StandardSchemaWithJSON {
        try {
            return fromJsonSchema(schema as unknown as JsonSchemaType);
        } catch (e) {
            throw new Error(
                `MCP tool ${label} (${pluginSource}) failed to compile: ${e instanceof Error ? e.message : String(e)}. ` +
                    `Author schemas as JSON Schema 2020-12 without a "$schema" key.`,
            );
        }
    }

    private registerTool(tool: McpRegisteredTool): void {
        if (this.isReservedMetaToolName(tool.name)) {
            throw new Error(`MCP tool name "${tool.name}" is reserved for discovery`);
        }
        const key = this.toolKey(tool.toolset, tool.name);
        const existing = this.tools.get(key);
        if (existing) {
            throw new Error(
                `Duplicate MCP tool name "${tool.name}" (toolset "${tool.toolset}") from ` +
                    `${existing.pluginSource} and ${tool.pluginSource}`,
            );
        }
        this.tools.set(key, tool);
    }

    // ---------------------------------------------------------------------------------------------
    // Execution funnel (shared by direct + discovery)
    // ---------------------------------------------------------------------------------------------

    private async callRegisteredTool(
        executionContext: McpExecutionContext,
        toolset: McpToolset,
        name: string,
        input: unknown,
        validateInput = false,
    ): Promise<CallToolResult> {
        const ctx = executionContext.ctx;
        // Rate limit FIRST. This is the only rate gate for tools/call (the controller handshake
        // pre-check deliberately skips tools/call), so unknown/disabled/permission-denied calls — on
        // BOTH the direct and discovery paths — must still consume the shared buckets, otherwise they
        // are a free hammer on the anonymous surface. Exceedance flattens to isError here (only the
        // pre-check carries -31029 + data).
        const rateLimited = await this.enforceRateLimitOrError(executionContext, toolset, name);
        if (rateLimited) {
            return rateLimited;
        }
        const tool = this.tools.get(this.toolKey(toolset, name));
        if (!tool || tool.toolset !== toolset) {
            return this.errorResult(`Unknown MCP tool: ${name}`);
        }
        const toggles = await this.getToolToggles(ctx);
        if (!this.isToolEnabled(tool, toggles)) {
            return this.errorResult(`MCP tool is disabled: ${name}`);
        }
        if (!this.hasPermissions(ctx, tool.permissions ?? [Permission.Public])) {
            return this.errorResult(`You do not have permission to call MCP tool: ${name}`);
        }
        let toolInput: Record<string, unknown> = (input ?? {}) as Record<string, unknown>;
        if (validateInput) {
            const validated = await this.validateAgainst(tool.compiledInputSchema, toolInput);
            if (!validated.ok) {
                return this.errorResult(`Invalid arguments for tool "${name}": ${validated.message}`);
            }
            toolInput = (validated.value ?? {}) as Record<string, unknown>;
        }
        // Destructive-confirmation gate: require confirm:true, then strip it before executing.
        if (tool.resolvedBehavior === 'destructive') {
            if (toolInput.confirm !== true) {
                return this.confirmationRequiredResult(tool);
            }
            const { confirm, ...rest } = toolInput;
            toolInput = rest;
        }
        const startedAt = Date.now();
        try {
            const output = await tool.handler.execute(ctx, toolInput, executionContext);
            if (tool.compiledOutputSchema) {
                const validated = await this.validateAgainst(tool.compiledOutputSchema, output);
                if (!validated.ok) {
                    Logger.warn(
                        `MCP tool "${tool.name}" returned output that does not match its schema: ${validated.message}`,
                        loggerCtx,
                    );
                }
            }
            await this.toolCallLog.logToolCall({
                executionContext,
                tool,
                input: toolInput,
                output,
                durationMs: Date.now() - startedAt,
                status: 'success',
            });
            return this.successResult(output);
        } catch (e) {
            const message = e instanceof Error ? e.message : 'MCP tool failed';
            await this.toolCallLog.logToolCall({
                executionContext,
                tool,
                input: toolInput,
                output: { message },
                durationMs: Date.now() - startedAt,
                status: 'error',
            });
            return this.errorResult(message);
        }
    }

    /**
     * Discovery-path execution. Routes through the shared funnel with inner-argument validation
     * enabled: the funnel rate-limits FIRST (so an unknown name or invalid arguments still consumes
     * the shared buckets — the discovery path must not be a rate-limit-free hammer) and then
     * re-validates the inner arguments against the target tool's wire schema (the SDK validated only
     * the `execute_tool` envelope). No early returns here would bypass that gate.
     */
    private async executeToolViaDiscovery(
        executionContext: McpExecutionContext,
        toolset: McpToolset,
        input: unknown,
    ): Promise<CallToolResult> {
        const params = (input ?? {}) as { name?: unknown; arguments?: unknown };
        const name = typeof params.name === 'string' ? params.name : '';
        return this.callRegisteredTool(executionContext, toolset, name, params.arguments ?? {}, true);
    }

    // ---------------------------------------------------------------------------------------------
    // Discovery meta-tools
    // ---------------------------------------------------------------------------------------------

    private async searchTools(
        executionContext: McpExecutionContext,
        toolset: McpToolset,
        input: unknown,
    ): Promise<CallToolResult> {
        // search_tools has no target tool to rate-limit downstream (unlike execute_tool, which
        // funnels through callRegisteredTool), so gate it here against the shared buckets.
        const rateLimited = await this.enforceRateLimitOrError(executionContext, toolset, SEARCH_TOOLS);
        if (rateLimited) {
            return rateLimited;
        }
        const params = (input ?? {}) as { query?: unknown; limit?: unknown };
        const query = typeof params.query === 'string' ? params.query.toLowerCase() : '';
        const limit = Math.min(Math.max(typeof params.limit === 'number' ? params.limit : 10, 1), 50);
        const toggles = await this.getToolToggles(executionContext.ctx);
        const tools = this.visibleTools(executionContext, toolset, toggles);
        const index = this.bm25.get(toolset);
        const matches = tools
            .map(tool => ({
                tool,
                score: query.length === 0 ? 1 : (index?.score(tool.name, query) ?? 0),
            }))
            .filter(item => query.length === 0 || item.score > 0)
            .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
            .slice(0, limit)
            .map(item => this.toolSummary(item.tool));
        if (matches.length === 0) {
            // Zero-result fallback hint rather than a dead-end empty list.
            return this.successResult({
                tools: [],
                hint:
                    `No ${toolset} tools matched "${query}". ` +
                    `Try a broader query, or call search_tools with an empty query to list tools by name ` +
                    `(capped at limit — default 10, maximum 50, so raise limit to see more).`,
            });
        }
        return this.successResult({ tools: matches });
    }

    /**
     * A concise tool summary for search results and in-process tool listings — carries the
     * ORIGINAL input schema (no injected confirm).
     */
    private toolSummary(tool: McpRegisteredTool): McpToolSummary {
        return {
            name: tool.name,
            title: tool.title,
            description: tool.description,
            toolset: tool.toolset,
            behavior: tool.resolvedBehavior,
            annotations: tool.annotations,
            inputSchema: tool.jsonInputSchema,
        };
    }

    private buildSearchIndexes(): Map<McpToolset, Bm25Index> {
        const indexes = new Map<McpToolset, Bm25Index>();
        for (const toolset of ['shop', 'admin'] as McpToolset[]) {
            const entries = [...this.tools.values()]
                .filter(tool => tool.toolset === toolset)
                .map(tool => ({ id: tool.name, text: this.searchDocText(tool) }));
            indexes.set(toolset, new Bm25Index(entries));
        }
        return indexes;
    }

    private searchDocText(tool: McpRegisteredTool): string {
        return [tool.name, tool.title ?? '', tool.description, ...(tool.keywords ?? [])].join(' ');
    }

    private buildDiscoveryMetaTools(): McpExposedTool[] {
        const searchSchema: McpJsonSchema = {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Keywords to match against tool names and descriptions.',
                },
                limit: { type: 'number', description: 'Maximum number of results (1-50, default 10).' },
            },
            required: ['query'],
            additionalProperties: false,
        };
        const executeSchema: McpJsonSchema = {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'The name of the tool to execute (from search_tools).' },
                arguments: { type: 'object', description: 'Arguments to pass to the tool.' },
            },
            required: ['name'],
            additionalProperties: false,
        };
        return [
            {
                name: SEARCH_TOOLS,
                description:
                    'Search for available Vendure MCP tools by keyword. Returns matching tools with their ' +
                    'input schemas so you can then run one via execute_tool.',
                annotations: { readOnlyHint: true, idempotentHint: true },
                compiledInputSchema: this.compileSchema(searchSchema, SEARCH_TOOLS, 'McpPlugin'),
            },
            {
                name: EXECUTE_TOOL,
                description:
                    'Execute a Vendure MCP tool found via search_tools. Provide the tool name and its arguments.',
                annotations: {},
                compiledInputSchema: this.compileSchema(executeSchema, EXECUTE_TOOL, 'McpPlugin'),
            },
        ];
    }

    // ---------------------------------------------------------------------------------------------
    // Filtering, behavior, permissions
    // ---------------------------------------------------------------------------------------------

    private visibleTools(
        executionContext: McpExecutionContext,
        toolset: McpToolset,
        toggles: Record<string, boolean>,
    ): McpRegisteredTool[] {
        return [...this.tools.values()]
            .filter(tool => tool.toolset === toolset)
            .filter(tool => this.isToolEnabled(tool, toggles))
            .filter(tool =>
                this.hasPermissions(executionContext.ctx, tool.permissions ?? [Permission.Public]),
            );
    }

    private getToolBehavior(tool: McpToolMetadata): McpToolBehavior {
        if (tool.behavior) {
            return tool.behavior;
        }
        if (tool.requiresConfirmation) {
            return 'destructive';
        }
        if (tool.readOnly) {
            return 'readonly';
        }
        return 'mutating';
    }

    private deriveAnnotations(tool: McpToolMetadata, behavior: McpToolBehavior): ToolAnnotations {
        return {
            title: tool.title,
            readOnlyHint: behavior === 'readonly',
            destructiveHint: behavior === 'destructive',
            idempotentHint: behavior === 'readonly',
        };
    }

    /**
     * OR-semantics permission check. `Public`/`Authenticated` short-circuit ONLY when they are the
     * sole declared permission; an empty list means Public (kept explicitly because
     * `ctx.userHasPermissions([])` returns false).
     */
    private hasPermissions(ctx: RequestContext, permissions: Permission[]): boolean {
        if (permissions.length === 0) {
            return true;
        }
        if (permissions.length === 1) {
            if (permissions[0] === Permission.Public) {
                return true;
            }
            if (permissions[0] === Permission.Authenticated) {
                return !!ctx.activeUserId;
            }
        }
        return ctx.userHasPermissions(permissions);
    }

    /** Augments a destructive tool's WIRE schema with an optional `confirm`, on a clone (never the SSOT). */
    private wireInputSchema(tool: McpRegisteredTool): McpJsonSchema {
        if (tool.resolvedBehavior !== 'destructive') {
            return tool.jsonInputSchema;
        }
        const wire = structuredClone(tool.jsonInputSchema);
        wire.properties = {
            ...(wire.properties ?? {}),
            confirm: {
                type: 'boolean',
                description: 'Set to true to confirm and run this destructive action. Omit to preview it.',
            },
        };
        // Deliberately NOT added to `required` so the first (preview) call may omit it.
        return wire;
    }

    // ---------------------------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------------------------

    /**
     * Enforces the rate limit for `subject` against its per-subject bucket plus the shared
     * session/client/anon-IP buckets. Returns an `isError` result if a bucket is exceeded, or
     * `undefined` to proceed.
     */
    private async enforceRateLimitOrError(
        executionContext: McpExecutionContext,
        toolset: McpToolset,
        subject: string,
    ): Promise<CallToolResult | undefined> {
        try {
            await this.rateLimiter.enforceRateLimit({
                executionContext,
                endpoint: toolset,
                toolNames: [subject],
                subject,
            });
            return undefined;
        } catch (e) {
            if (e instanceof McpRateLimitExceededError) {
                return this.errorResult(e.message);
            }
            throw e;
        }
    }

    private async validateAgainst(
        compiled: StandardSchemaWithJSON,
        value: unknown,
    ): Promise<{ ok: true; value: unknown } | { ok: false; message: string }> {
        const result = await compiled['~standard'].validate(value);
        if (result.issues) {
            const message = result.issues.map(issue => this.formatIssue(issue)).join('; ');
            return { ok: false, message };
        }
        return { ok: true, value: result.value };
    }

    private formatIssue(issue: StandardSchemaV1.Issue): string {
        const path = (issue.path ?? [])
            .map(segment => (typeof segment === 'object' ? String(segment.key) : String(segment)))
            .join('.');
        return path ? `${path}: ${issue.message}` : issue.message;
    }

    private getPluginSource(wrapper: {
        host?: { metatype?: { name?: string } };
        name?: string | symbol;
    }): string {
        return wrapper.host?.metatype?.name ?? String(wrapper.name ?? 'unknown');
    }

    private toolKey(toolset: McpToolset, name: string): string {
        return `${toolset}:${name}`;
    }

    private toolToggleKey(toolset: McpToolset, name: string): string {
        return `${toolset}:${name}`;
    }

    private isReservedMetaToolName(name: string): boolean {
        return RESERVED_META_TOOL_NAMES.includes(name);
    }

    private isMcpJsonSchema(value: unknown): value is McpJsonSchema {
        return typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'object';
    }

    private successResult(output: unknown): CallToolResult {
        return {
            content: [{ type: 'text', text: JSON.stringify(output ?? null, null, 2) }],
            structuredContent: output,
        };
    }

    private errorResult(message: string): CallToolResult {
        return { isError: true, content: [{ type: 'text', text: message }] };
    }

    private confirmationRequiredResult(tool: McpRegisteredTool): CallToolResult {
        return {
            content: [
                {
                    type: 'text',
                    text:
                        `This is a destructive action: ${tool.description} ` +
                        `Re-call "${tool.name}" with "confirm": true to proceed.`,
                },
            ],
            structuredContent: { status: 'confirmation_required', confirmed: false },
        };
    }
}
