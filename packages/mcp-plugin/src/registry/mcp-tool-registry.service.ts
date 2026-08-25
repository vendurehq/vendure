import { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/server';
import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import {
    EntityNotFoundError,
    ForbiddenError,
    GraphQLErrorResult,
    I18nError,
    IllegalOperationError,
    Instrument,
    isGraphQlErrorResult,
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
    McpTool,
    McpToolBehavior,
    McpToolHandler,
    McpToolMetadata,
    McpToolset,
} from '@vendure/mcp-sdk';

import { loggerCtx, MCP_PLUGIN_OPTIONS, MCP_TOOL_TOGGLES_STORE_KEY } from '../constants';
import { McpExecutionContext, ResolvedMcpPluginOptions } from '../internal-types';
import { McpToolCallLogService } from '../logging/mcp-tool-call-log.service';
import { McpRateLimiterService, McpRateLimitExceededError } from '../rate-limit/mcp-rate-limiter.service';
import { McpShopSessionService } from '../shop-session/mcp-shop-session.service';
import { McpToolSummary } from '../types';

import { Bm25Index } from './bm25';
import { McpToolSchemaService } from './mcp-tool-schema.service';
import { McpExposedTool, McpRegisteredTool } from './registry-types';

/** Discovery meta-tool names — reserved so user tools cannot collide with them. */
const SEARCH_TOOLS = 'search_tools';
const EXECUTE_TOOL = 'execute_tool';
const RESERVED_META_TOOL_NAMES: readonly string[] = [SEARCH_TOOLS, EXECUTE_TOOL];
const ALL_TOOLSETS: readonly McpToolset[] = ['shop', 'admin'];
// These limits are also stated in the no-results hint and the meta-tool's own schema
// description, so changing them means changing all three places.
const SEARCH_DEFAULT_LIMIT = 10;
const SEARCH_MAX_LIMIT = 50;
// Error types a tool throws on purpose, with a message meant to be read by the caller. Anything
// else is treated as an internal failure: logged server-side, and the caller gets a generic
// message instead.
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
        private toolSchema: McpToolSchemaService,
        private shopSession: McpShopSessionService,
        @Inject(MCP_PLUGIN_OPTIONS) private options: ResolvedMcpPluginOptions,
    ) {}

    onApplicationBootstrap(): void {
        this.discoverTools();
        this.discoveryMetaTools = this.buildDiscoveryMetaTools();
        this.bm25 = this.buildSearchIndexes();
    }

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
     * Builds a registered tool and prepares its schemas. Rejects unsupported schemas, adds a default
     * input schema when needed, ensures registry-managed fields are not declared by the tool itself,
     * and compiles the input and output schemas once at startup. Errors here prevent startup.
     */
    private buildRegisteredTool(
        metadata: McpToolMetadata,
        handler: McpToolHandler,
        pluginSource: string,
    ): McpRegisteredTool {
        if (metadata.usesActiveOrder && metadata.toolset !== 'shop') {
            throw new Error(
                `MCP tool "${metadata.name}" usesActiveOrder, which is only valid on a shop tool.`,
            );
        }
        if (metadata.toolset === 'admin' && (metadata.permissions?.length ?? 0) === 0) {
            throw new Error(
                `Admin MCP tool "${metadata.name}" declares no permissions. Declare the permissions ` +
                    `required to call it, e.g. permissions: [Permission.Authenticated] if any administrator ` +
                    `may call it.`,
            );
        }
        const resolvedBehavior = metadata.behavior ?? 'mutating';
        const schemas = this.toolSchema.prepareToolSchemas({
            toolName: metadata.name,
            pluginSource,
            inputSchema: metadata.inputSchema,
            outputSchema: metadata.outputSchema,
            injectedFields: {
                confirm: resolvedBehavior === 'destructive',
                sessionToken: this.acceptsSessionToken(metadata),
            },
        });
        return {
            ...metadata,
            handler,
            pluginSource,
            resolvedBehavior,
            annotations: this.deriveAnnotations(metadata, resolvedBehavior),
            ...schemas,
        };
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

    private async callRegisteredTool(
        executionContext: McpExecutionContext,
        toolset: McpToolset,
        name: string,
        input: unknown,
        validateInput: boolean,
    ): Promise<CallToolResult> {
        const ctx = executionContext.ctx;
        // Rate-limit first: the controller's pre-check skips tools/call requests, so this is the
        // only place a tool call is counted. A direct call naming a tool outside the caller's
        // visible set never reaches here (the SDK rejects it first) and so is never counted.
        // That is acceptable because such a caller holds a token, and anonymous traffic is
        // IP-limited in the controller. A limit hit here becomes a plain isError result; only the
        // controller pre-check returns the -31029 code with retry data.
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
            const validated = await this.toolSchema.validate(tool.compiledInputSchema, toolInput);
            if (!validated.ok) {
                return this.errorResult(`Invalid arguments for tool "${name}": ${validated.message}`);
            }
            toolInput = (validated.value ?? {}) as Record<string, unknown>;
        }
        // A destructive tool called without `confirm: true` only describes what it would do.
        const isConfirmationPreview = tool.resolvedBehavior === 'destructive' && toolInput.confirm !== true;

        // Active-order tools exchange the registry-owned sessionToken argument for the context the
        // handler acts on. The prepared input no longer contains the credential, so logs do not either.
        let sessionTokenForResult: string | undefined;
        if (this.acceptsSessionToken(tool)) {
            const prepared = await this.shopSession.prepareToolCall({
                ctx: executionContext.ctx,
                input: toolInput,
                isOAuthCall: executionContext.grant != null,
                // A preview runs no handler, so it must not start a cart of its own.
                createSessionIfMissing: tool.resolvedBehavior !== 'readonly' && !isConfirmationPreview,
            });
            if (prepared.kind === 'refused') {
                return this.errorResult(prepared.message);
            }
            toolInput = prepared.input;
            executionContext.ctx = prepared.ctx;
            sessionTokenForResult = prepared.sessionToken;
        }
        // The preview carries the token too, so the confirming call can act on the same cart.
        if (isConfirmationPreview) {
            return this.confirmationRequiredResult(tool, sessionTokenForResult);
        }
        if (tool.resolvedBehavior === 'destructive') {
            const { confirm, ...rest } = toolInput;
            toolInput = rest;
        }
        const startedAt = Date.now();
        try {
            const output = await tool.handler.execute(
                executionContext.ctx,
                toolInput,
                this.toCallerInfo(executionContext),
            );

            if (isGraphQlErrorResult(output as GraphQLErrorResult | undefined)) {
                const errorResult = { ...(output as GraphQLErrorResult) };
                await this.toolCallLog.logToolCall({
                    executionContext,
                    tool,
                    input: toolInput,
                    output: errorResult,
                    durationMs: Date.now() - startedAt,
                    status: 'error',
                });

                const messageKey = `errorResult.${errorResult.message}`;
                const translated = this.translateForCaller(
                    executionContext.ctx,
                    messageKey,
                    errorResult as unknown as Record<string, unknown>,
                );
                const translatedResult = {
                    ...errorResult,
                    message: translated === messageKey ? errorResult.message : translated,
                };
                return this.vendureErrorResult(
                    this.shopSession.addSessionTokenToResult(translatedResult, sessionTokenForResult),
                );
            }
            if (tool.compiledOutputSchema) {
                const validated = await this.toolSchema.validate(tool.compiledOutputSchema, output);
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
            return this.successResult(
                this.shopSession.addSessionTokenToResult(output, sessionTokenForResult),
            );
        } catch (e) {
            const message = e instanceof Error ? e.message : 'MCP tool failed';
            const callerSafe = this.isCallerSafeError(e);
            const callerMessage =
                callerSafe && e instanceof I18nError
                    ? this.translateForCaller(executionContext.ctx, e.message, e.variables)
                    : message;
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
            return this.errorResult(
                callerSafe ? callerMessage : GENERIC_TOOL_ERROR_MESSAGE,
                sessionTokenForResult,
            );
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
     * A concise tool summary used in search results and tool listings. Includes the final input
     * schema that callers must satisfy, including any registry-added fields such as `confirm`
     * or `sessionToken`.
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
                compiledInputSchema: this.toolSchema.compileJsonSchema(
                    searchSchema,
                    SEARCH_TOOLS,
                    'McpPlugin',
                ),
            },
            {
                name: EXECUTE_TOOL,
                description:
                    'Execute a Vendure MCP tool found via search_tools. Provide the tool name and its arguments.',
                annotations: {},
                compiledInputSchema: this.toolSchema.compileJsonSchema(
                    executeSchema,
                    EXECUTE_TOOL,
                    'McpPlugin',
                ),
            },
        ];
    }

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
     * sole declared permission; any other list goes to `ctx.userHasPermissions`, which is false for
     * a caller with no user.
     */
    private hasPermissions(ctx: RequestContext, permissions: Permission[]): boolean {
        if (this.isPubliclyCallable(permissions)) {
            return true;
        }
        if (permissions.length === 1 && permissions[0] === Permission.Authenticated) {
            return !!ctx.activeUserId;
        }
        return ctx.userHasPermissions(permissions);
    }

    /**
     * Empty, or exactly `[Permission.Public]`: anyone may call the tool, signed in or not. The empty
     * case is spelled out because `ctx.userHasPermissions([])` returns false.
     */
    private isPubliclyCallable(permissions: Permission[]): boolean {
        return permissions.length === 0 || (permissions.length === 1 && permissions[0] === Permission.Public);
    }

    /** Public shop tools that use the active order exchange the optional `sessionToken`. */
    private acceptsSessionToken(
        tool: Pick<McpRegisteredTool, 'toolset' | 'permissions' | 'usesActiveOrder'>,
    ): boolean {
        return (
            tool.toolset === 'shop' &&
            tool.usesActiveOrder === true &&
            this.isPubliclyCallable(tool.permissions ?? [])
        );
    }

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

    private getPluginSource(wrapper: {
        host?: { metatype?: { name?: string } };
        name?: string | symbol;
    }): string {
        return wrapper.host?.metatype?.name ?? String(wrapper.name ?? 'unknown');
    }

    /** Whether a thrown error is one a tool raises on purpose with a message meant for the caller. */
    private isCallerSafeError(e: unknown): boolean {
        return CALLER_SAFE_ERROR_TYPES.some(ErrorType => e instanceof ErrorType);
    }

    /**
     * Translates an i18n key using the request's language. Returns the original text when translation
     * is unavailable or fails.
     */
    private translateForCaller(
        ctx: RequestContext,
        key: string,
        variables?: Record<string, unknown>,
    ): string {
        const req = ctx.req;
        if (!req || !('t' in req) || typeof req.t !== 'function') {
            return key;
        }
        try {
            const translated: unknown = req.t(key, variables);
            return typeof translated === 'string' && translated !== key ? translated : key;
        } catch {
            return key;
        }
    }

    private successResult(output: unknown): CallToolResult {
        return {
            content: [{ type: 'text', text: JSON.stringify(output ?? null, null, 2) }],
            structuredContent: output,
        };
    }

    private errorResult(message: string, sessionToken?: string): CallToolResult {
        return {
            isError: true,
            content: [{ type: 'text', text: message }],
            // A failed call may still have resolved or created a session; handing its token back
            // lets the caller keep the same cart on retry instead of leaving an orphan row.
            ...(sessionToken !== undefined ? { structuredContent: { sessionToken } } : {}),
        };
    }

    /**
     * A failed call whose reason is a Vendure error result. Unlike `errorResult`, the whole object
     * is kept: the text shows it, and the structured content is the object itself, so a caller can
     * act on `errorCode` rather than parse a sentence.
     */
    private vendureErrorResult(output: unknown): CallToolResult {
        return {
            isError: true,
            content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
            structuredContent: output as Record<string, unknown>,
        };
    }

    private confirmationRequiredResult(tool: McpRegisteredTool, sessionToken?: string): CallToolResult {
        return {
            content: [
                {
                    type: 'text',
                    text:
                        `This is a destructive action: ${tool.description} ` +
                        `Re-call "${tool.name}" with "confirm": true to proceed.`,
                },
            ],
            structuredContent: {
                status: 'confirmation_required',
                confirmed: false,
                ...(sessionToken !== undefined ? { sessionToken } : {}),
            },
        };
    }
}
