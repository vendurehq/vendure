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
import {
    EntityNotFoundError,
    ForbiddenError,
    IllegalOperationError,
    Instrument,
    Logger,
    Permission,
    RequestContext,
    SettingsStoreService,
    UnauthorizedError,
    UserInputError,
} from '@vendure/core';
import {
    McpCallerInfo,
    McpJsonSchema,
    McpStandardSchema,
    McpTool,
    McpToolBehavior,
    McpToolHandler,
    McpToolMetadata,
    McpToolSchema,
    McpToolset,
} from '@vendure/mcp-sdk';

import { loggerCtx, MCP_PLUGIN_OPTIONS, MCP_TOOL_TOGGLES_STORE_KEY } from '../constants';
import { McpExecutionContext, ResolvedMcpPluginOptions } from '../internal-types';
import { McpToolCallLogService } from '../logging/mcp-tool-call-log.service';
import { McpRateLimiterService, McpRateLimitExceededError } from '../rate-limit/mcp-rate-limiter.service';
import { McpToolSummary } from '../types';

import { Bm25Index } from './bm25';
import { McpExposedTool, McpRegisteredTool } from './registry-types';

/** Discovery meta-tool names — reserved so user tools cannot collide with them. */
const SEARCH_TOOLS = 'search_tools';
const EXECUTE_TOOL = 'execute_tool';
const RESERVED_META_TOOL_NAMES: readonly string[] = [SEARCH_TOOLS, EXECUTE_TOOL];
const NO_ARGS_SCHEMA: McpJsonSchema = { type: 'object', properties: {}, additionalProperties: false };
const ALL_TOOLSETS: readonly McpToolset[] = ['shop', 'admin'];
// How many tools search_tools returns. Enforced in searchTools and stated in both the
// no-results hint and the meta-tool's own schema description, so all three stay in step.
const SEARCH_DEFAULT_LIMIT = 10;
const SEARCH_MAX_LIMIT = 50;
// Error types a tool throws on purpose, with a message meant to be read by the caller. Anything
// else is treated as an internal failure: logged server-side, genericized for the caller.
const CALLER_SAFE_ERROR_TYPES = [
    UserInputError,
    IllegalOperationError,
    EntityNotFoundError,
    ForbiddenError,
    UnauthorizedError,
] as const;
const GENERIC_TOOL_ERROR_MESSAGE = 'The tool failed unexpectedly';

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
    // Not readonly: a toggle write must be visible to every live RequestContext, not just the one
    // that made the write, so `setToolEnabled` replaces this whole map rather than patching one entry.
    private toggleCache = new WeakMap<RequestContext, Record<string, boolean>>();

    constructor(
        private discoveryService: DiscoveryService,
        private settingsStoreService: SettingsStoreService,
        private rateLimiter: McpRateLimiterService,
        private toolCallLog: McpToolCallLogService,
        @Inject(MCP_PLUGIN_OPTIONS) private options: ResolvedMcpPluginOptions,
    ) {}

    onApplicationBootstrap(): void {
        this.discoverTools();
        this.discoveryMetaTools = this.buildDiscoveryMetaTools();
        this.bm25 = this.buildSearchIndexes();
    }

    // ---------------------------------------------------------------------------------------------
    // Public surface (nine members)
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
        return this.visibleTools(executionContext.ctx, toolset, toggles);
    }

    /**
     * The only public execution entry, called by the per-request transport for every tool
     * invocation. Which names can arrive is decided by the exposure mode, not here:
     *
     * - `direct` (default): only real tool names. The two meta-tool names are refused as real
     *   tool names at startup and never registered, so the SDK rejects them before this runs.
     * - `discovery`: only `search_tools` and `execute_tool`. Real tool names are never
     *   registered, so the SDK rejects them before this runs.
     *
     * For a direct call the SDK has already validated `input` against the registered schema;
     * for an `execute_tool` call the funnel validates the inner arguments itself.
     */
    async callTool(
        executionContext: McpExecutionContext,
        toolset: McpToolset,
        name: string,
        input: unknown,
    ): Promise<CallToolResult> {
        if (this.options.toolExposure === 'discovery') {
            if (name === SEARCH_TOOLS) {
                return this.searchTools(executionContext, toolset, input);
            }
            if (name === EXECUTE_TOOL) {
                return this.callToolFromEnvelope(executionContext, toolset, input);
            }
        }
        // The SDK already validated `input` against the registered wire schema.
        return this.callRegisteredTool(executionContext, toolset, name, input, false);
    }

    /**
     * The tools an in-process caller may run: the toolset's tools, minus disabled ones, minus those
     * the context has no permission for. Unlike {@link getExposedTools} this ignores `toolExposure`,
     * because the discovery meta-tools exist to keep a remote agent's tool list small and give an
     * in-process caller nothing.
     */
    async getCallableTools(ctx: RequestContext, toolset: McpToolset): Promise<McpToolSummary[]> {
        const toggles = await this.getToolToggles(ctx);
        return this.visibleTools(ctx, toolset, toggles).map(tool => this.toolSummary(tool));
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

    /**
     * Reads the tool-enablement map from the settings store (empty when unset). Cached per
     * RequestContext, so one request reads the settings store once; `setToolEnabled` refreshes
     * the cache.
     */
    async getToolToggles(ctx: RequestContext): Promise<Record<string, boolean>> {
        const cached = this.toggleCache.get(ctx);
        if (cached) {
            return cached;
        }
        const toggles =
            (await this.settingsStoreService.get<Record<string, boolean>>(ctx, MCP_TOOL_TOGGLES_STORE_KEY)) ??
            {};
        this.toggleCache.set(ctx, toggles);
        return toggles;
    }

    /** A tool is enabled unless explicitly disabled. One canonical key: `${toolset}:${name}`. */
    isToolEnabled(
        tool: Pick<McpRegisteredTool, 'toolset' | 'name'>,
        toggles: Record<string, boolean>,
    ): boolean {
        return toggles[this.toolKey(tool.toolset, tool.name)] !== false;
    }

    /** Enables or disables a tool. Writes the one canonical key. */
    async setToolEnabled(
        ctx: RequestContext,
        toolset: McpToolset,
        name: string,
        enabled: boolean,
    ): Promise<void> {
        const toggles = await this.getToolToggles(ctx);
        toggles[this.toolKey(toolset, name)] = enabled;
        await this.settingsStoreService.set(ctx, MCP_TOOL_TOGGLES_STORE_KEY, toggles);
        this.toggleCache = new WeakMap();
        this.toggleCache.set(ctx, toggles);
    }

    /**
     * Canonical `${toolset}:${name}` key. Used both as the in-memory registry key and as the
     * PERSISTED key in the tool-toggle settings map — changing the format orphans stored toggles.
     */
    toolKey(toolset: McpToolset, name: string): string {
        return `${toolset}:${name}`;
    }

    // ---------------------------------------------------------------------------------------------
    // Discovery + bootstrap schema gate
    // ---------------------------------------------------------------------------------------------

    private discoverTools(): void {
        this.tools.clear();
        for (const wrapper of this.discoveryService.getProviders()) {
            const metadata = this.discoveryService.getMetadataByDecorator(McpTool, wrapper);
            const instance = wrapper.instance as unknown;
            if (!metadata || !instance) {
                continue;
            }
            if (!this.isToolHandler(instance)) {
                throw new Error(
                    `MCP tool provider ${String(wrapper.name ?? metadata.name)} must implement execute()`,
                );
            }
            const entry = this.buildRegisteredTool(metadata, instance, this.getPluginSource(wrapper));
            this.registerTool(entry);
        }
        Logger.info(`Discovered ${this.tools.size} MCP tools`, loggerCtx);
    }

    private isToolHandler(instance: unknown): instance is McpToolHandler {
        return typeof (instance as Partial<McpToolHandler>)?.execute === 'function';
    }

    /**
     * Builds one registered tool, applying the bootstrap schema gate: reject non-JSON schemas,
     * default a missing input schema, assert destructive tools don't declare their own `confirm`,
     * and compile the wire input (and any output) schema once — a throw here aborts boot.
     */
    private buildRegisteredTool(
        metadata: McpToolMetadata,
        handler: McpToolHandler,
        pluginSource: string,
    ): McpRegisteredTool {
        const resolvedInput = this.resolveAuthorSchema(
            metadata.inputSchema,
            `${metadata.name} inputSchema`,
            pluginSource,
            'input',
        );
        const resolvedOutput = this.resolveAuthorSchema(
            metadata.outputSchema,
            `${metadata.name} outputSchema`,
            pluginSource,
            'output',
        );
        if (metadata.toolset === 'admin' && (metadata.permissions?.length ?? 0) === 0) {
            throw new Error(
                `Admin MCP tool "${metadata.name}" declares no permissions. Declare the permissions ` +
                    `required to call it, e.g. permissions: [Permission.Authenticated] if any administrator ` +
                    `may call it.`,
            );
        }
        const resolvedBehavior = metadata.behavior ?? 'mutating';
        const jsonInputSchema = resolvedInput?.json ?? NO_ARGS_SCHEMA;
        if (resolvedBehavior === 'destructive' && jsonInputSchema.properties?.confirm !== undefined) {
            throw new Error(
                `MCP tool "${metadata.name}" (${pluginSource}) is destructive and must not declare its own ` +
                    `"confirm" property — the registry injects it.`,
            );
        }
        const wireJsonSchema = this.wireInputSchema(resolvedBehavior, jsonInputSchema);
        const compiledInputSchema = resolvedInput?.standard
            ? this.toRegisteredStandardSchema(
                  resolvedInput.standard,
                  wireJsonSchema,
                  resolvedBehavior === 'destructive',
              )
            : this.compileSchema(wireJsonSchema, `${metadata.name} inputSchema`, pluginSource);
        const compiledOutputSchema = resolvedOutput
            ? this.compileSchema(resolvedOutput.json, `${metadata.name} outputSchema`, pluginSource)
            : undefined;
        return {
            ...metadata,
            handler,
            pluginSource,
            resolvedBehavior,
            annotations: this.deriveAnnotations(metadata, resolvedBehavior),
            jsonInputSchema,
            compiledInputSchema,
            wireJsonSchema,
            compiledOutputSchema,
        };
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
        if (RESERVED_META_TOOL_NAMES.includes(tool.name)) {
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
        validateInput: boolean,
    ): Promise<CallToolResult> {
        const ctx = executionContext.ctx;
        // Rate limit first — the controller pre-check skips tools/call, so this is the only gate.
        // A direct call naming a tool outside the caller's visible set never reaches here: the SDK
        // rejects it earlier, uncharged. Accepted, because that caller holds a token and anonymous
        // traffic is IP-limited in the controller. Exceedance flattens to isError here (only the
        // pre-check carries -31029 + data).
        const rateLimited = await this.enforceRateLimitOrError(executionContext, toolset, name);
        if (rateLimited) {
            return rateLimited;
        }
        const tool = this.tools.get(this.toolKey(toolset, name));
        if (!tool) {
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
            const output = await tool.handler.execute(ctx, toolInput, this.toCallerInfo(executionContext));
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
            const callerSafe = this.isCallerSafeError(e);
            if (!callerSafe) {
                Logger.error(
                    `MCP tool "${tool.name}" failed: ${message}`,
                    loggerCtx,
                    e instanceof Error ? e.stack : undefined,
                );
            }
            await this.toolCallLog.logToolCall({
                executionContext,
                tool,
                input: toolInput,
                // The real message always goes into the log row — it's operator-only data, only
                // ever persisted when the operator opts into `capture: 'full'`.
                output: { message },
                durationMs: Date.now() - startedAt,
                status: 'error',
            });
            return this.errorResult(callerSafe ? message : GENERIC_TOOL_ERROR_MESSAGE);
        }
    }

    /**
     * Unwraps an `execute_tool` envelope and routes through the shared funnel with inner-argument
     * validation enabled: the funnel rate-limits FIRST (so an unknown name or invalid arguments still
     * consumes the shared buckets — the discovery path must not be a rate-limit-free hammer) and then
     * re-validates the inner arguments against the target tool's wire schema (the SDK validated only
     * the `execute_tool` envelope). No early returns here would bypass that gate.
     */
    private async callToolFromEnvelope(
        executionContext: McpExecutionContext,
        toolset: McpToolset,
        input: unknown,
    ): Promise<CallToolResult> {
        const { name, arguments: args } = input as { name: string; arguments?: Record<string, unknown> };
        return this.callRegisteredTool(executionContext, toolset, name, args ?? {}, true);
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
        const limit = Math.min(
            Math.max(typeof params.limit === 'number' ? params.limit : SEARCH_DEFAULT_LIMIT, 1),
            SEARCH_MAX_LIMIT,
        );
        const toggles = await this.getToolToggles(executionContext.ctx);
        const tools = this.visibleTools(executionContext.ctx, toolset, toggles);
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
                    `(capped at limit — default ${SEARCH_DEFAULT_LIMIT}, maximum ${SEARCH_MAX_LIMIT}, ` +
                    `so raise limit to see more).`,
            });
        }
        return this.successResult({ tools: matches });
    }

    /**
     * A concise tool summary for search results and in-process tool listings — carries the
     * WIRE input schema — the one the call must satisfy, including the injected `confirm` on
     * destructive tools.
     */
    private toolSummary(tool: McpRegisteredTool): McpToolSummary {
        return {
            name: tool.name,
            title: tool.title,
            description: tool.description,
            toolset: tool.toolset,
            behavior: tool.resolvedBehavior,
            annotations: tool.annotations,
            inputSchema: tool.wireJsonSchema,
        };
    }

    private buildSearchIndexes(): Map<McpToolset, Bm25Index> {
        const indexes = new Map<McpToolset, Bm25Index>();
        for (const toolset of ALL_TOOLSETS) {
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
                limit: {
                    type: 'number',
                    description: `Maximum number of results (1-${SEARCH_MAX_LIMIT}, default ${SEARCH_DEFAULT_LIMIT}).`,
                },
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
        ctx: RequestContext,
        toolset: McpToolset,
        toggles: Record<string, boolean>,
    ): McpRegisteredTool[] {
        return [...this.tools.values()]
            .filter(tool => tool.toolset === toolset)
            .filter(tool => this.isToolEnabled(tool, toggles))
            .filter(tool => this.hasPermissions(ctx, tool.permissions ?? [Permission.Public]));
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
    private wireInputSchema(
        resolvedBehavior: McpToolBehavior,
        jsonInputSchema: McpJsonSchema,
    ): McpJsonSchema {
        if (resolvedBehavior !== 'destructive') {
            return jsonInputSchema;
        }
        const wire = structuredClone(jsonInputSchema);
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
     * Maps the server-internal call state to the plain-data `McpCallerInfo` a tool actually
     * receives. This is the one place the `McpOauthGrant` entity crosses into a tool's `execute` —
     * every other consumer of this call state keeps using the entity directly.
     */
    private toCallerInfo(state: McpExecutionContext): McpCallerInfo {
        return {
            grant: state.grant ? { id: state.grant.id, oauthClientId: state.grant.oauthClientId } : undefined,
            clientIp: state.clientIp,
        };
    }

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

    private isMcpJsonSchema(value: unknown): value is McpJsonSchema {
        return typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'object';
    }

    private standardProps(value: unknown): Record<string, unknown> | undefined {
        if (typeof value !== 'object' || value === null) {
            return undefined;
        }
        const std = (value as Record<string, unknown>)['~standard'];
        return typeof std === 'object' && std !== null ? (std as Record<string, unknown>) : undefined;
    }

    private isStandardSchema(value: unknown): value is McpStandardSchema {
        const std = this.standardProps(value);
        return (
            typeof std?.validate === 'function' &&
            typeof (std.jsonSchema as { input?: unknown } | undefined)?.input === 'function'
        );
    }

    private deriveJsonSchema(
        schema: McpStandardSchema,
        label: string,
        pluginSource: string,
        direction: 'input' | 'output',
    ): McpJsonSchema {
        let json: Record<string, unknown>;
        try {
            json = schema['~standard'].jsonSchema[direction]({ target: 'draft-2020-12' });
        } catch (e) {
            throw new Error(
                `MCP tool ${label} (${pluginSource}): the Standard Schema could not be converted to ` +
                    `JSON Schema: ${e instanceof Error ? e.message : String(e)}`,
            );
        }
        // Converters commonly stamp a $schema key; fromJsonSchema rejects it.
        delete json.$schema;
        if (!this.isMcpJsonSchema(json)) {
            throw new Error(
                `MCP tool ${label} (${pluginSource}): the Standard Schema must describe an object at the ` +
                    `top level (the converted JSON Schema has type "${String((json as { type?: unknown }).type)}").`,
            );
        }
        return json;
    }

    private toRegisteredStandardSchema(
        schema: McpStandardSchema,
        wireJsonSchema: McpJsonSchema,
        destructive: boolean,
    ): StandardSchemaWithJSON {
        const std = schema['~standard'];
        const validate = destructive
            ? async (value: unknown) => {
                  // The wire schema advertises the registry-owned `confirm` flag, which the
                  // author's schema does not know about: validate the rest, then re-attach it.
                  const { confirm, ...rest } = (value ?? {}) as Record<string, unknown>;
                  if (confirm !== undefined && typeof confirm !== 'boolean') {
                      return { issues: [{ message: '"confirm" must be a boolean', path: ['confirm'] }] };
                  }
                  const result = await std.validate(rest);
                  if (result.issues) {
                      return result;
                  }
                  const parsed = result.value;
                  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                      return {
                          issues: [
                              { message: "a destructive tool's input schema must parse to a plain object" },
                          ],
                      };
                  }
                  return {
                      value: confirm === undefined ? parsed : { ...parsed, confirm },
                  };
              }
            : (value: unknown) => std.validate(value);
        return {
            '~standard': {
                version: 1,
                vendor: 'vendure-mcp',
                validate,
                jsonSchema: {
                    input: () => wireJsonSchema as Record<string, unknown>,
                    output: () => wireJsonSchema as Record<string, unknown>,
                },
            },
        } as StandardSchemaWithJSON;
    }

    private resolveAuthorSchema(
        raw: McpToolSchema | undefined,
        label: string,
        pluginSource: string,
        direction: 'input' | 'output',
    ): { json: McpJsonSchema; standard?: McpStandardSchema } | undefined {
        if (raw === undefined) {
            return undefined;
        }
        // Checked before isMcpJsonSchema: some Standard Schema objects (e.g. Valibot's)
        // also carry a top-level `type: 'object'` property.
        if (this.isStandardSchema(raw)) {
            return { json: this.deriveJsonSchema(raw, label, pluginSource, direction), standard: raw };
        }
        if (typeof this.standardProps(raw)?.validate === 'function') {
            throw new Error(
                `MCP tool ${label} (${pluginSource}): the schema implements Standard Schema validation but ` +
                    `cannot emit JSON Schema. Use a library version with JSON Schema conversion ` +
                    `(e.g. zod v4), or author the schema as plain JSON Schema.`,
            );
        }
        if (this.isMcpJsonSchema(raw)) {
            return { json: raw };
        }
        throw new Error(
            `MCP tool ${label} (${pluginSource}): the schema must be a plain JSON Schema object ` +
                `({ type: 'object', ... }) or a Standard Schema with JSON conversion (e.g. a zod v4 schema).`,
        );
    }

    /** Whether a thrown error is one a tool raises on purpose with a message meant for the caller. */
    private isCallerSafeError(e: unknown): boolean {
        return CALLER_SAFE_ERROR_TYPES.some(ErrorType => e instanceof ErrorType);
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
