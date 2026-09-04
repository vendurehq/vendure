import { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/server';
import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import {
    ConfigService,
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
    TransactionalConnection,
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
import { McpRateLimiterService } from '../rate-limit/mcp-rate-limiter.service';
import { McpShopSessionService } from '../shop-session/mcp-shop-session.service';
import { McpToolSummary } from '../types';

import { Bm25Index } from './bm25';
import { McpToolSchemaService } from './mcp-tool-schema.service';
import { McpExposedTool, McpRegisteredTool } from './registry-types';

/** Discovery meta-tool names — reserved so user tools cannot collide with them. */
const SEARCH_TOOLS = 'search_tools';
const EXECUTE_TOOL = 'execute_tool';
const RESERVED_META_TOOL_NAMES: ReadonlySet<string> = new Set([SEARCH_TOOLS, EXECUTE_TOOL]);
const ALL_TOOLSETS: readonly McpToolset[] = ['shop', 'admin'];
// Also stated in the no-results hint and the meta-tool's schema description; keep all three in sync.
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
const GENERIC_TOOL_ERROR_MESSAGE =
    'The tool failed unexpectedly. This is a server-side fault, not a problem with your ' +
    'arguments. Do not retry with different arguments; tell the user the operation could not ' +
    'be completed.';
// Largest serialized result text a tool may return, in bytes. 100 KB is roughly 25,000 tokens,
// which is the cap Claude Code applies to a tool response before it truncates the text.
const MAX_RESULT_BYTES = 100_000;
// The arguments a caller can use to ask for less, and how the size error tells them to. Only the
// ones a tool actually declares are mentioned, so the advice is always something they can do.
const NARROWING_ARGUMENT_ADVICE: Record<string, string> = {
    limit: 'lower "limit"',
    offset: 'page with "offset"',
    filter: 'add a "filter"',
    query: 'narrow the "query"',
};
// Enforce SEP-986 because some MCP clients reject non-conforming tool names.
const TOOL_NAME_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

/** What admission decided: either a result to send back unchanged, or the tool and input to run. */
type ToolCallAdmission =
    | { kind: 'refused'; result: CallToolResult }
    | { kind: 'admitted'; tool: McpRegisteredTool; input: Record<string, unknown> };

type ResolvedToolCallSession =
    | { kind: 'refused'; result: CallToolResult }
    | {
          kind: 'ready';
          callContext: McpExecutionContext;
          input: Record<string, unknown>;
          sessionToken: string | undefined;
      };

interface ToolCallOptions {
    /**
     * Whether to validate the arguments against the tool's own schema. The MCP SDK has already
     * done that for a direct `tools/call`, but not for an in-process call or for the inner
     * arguments of an `execute_tool` envelope.
     */
    validateInput: boolean;
}

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
    private knownPermissions?: Set<string>;
    private discoveryMetaTools: McpExposedTool[] = [];
    private bm25 = new Map<McpToolset, Bm25Index>();
    private toggleCache = new WeakMap<RequestContext, Record<string, boolean>>();

    constructor(
        private readonly discoveryService: DiscoveryService,
        private readonly settingsStoreService: SettingsStoreService,
        private readonly rateLimiter: McpRateLimiterService,
        private readonly toolCallLog: McpToolCallLogService,
        private readonly toolSchema: McpToolSchemaService,
        private readonly shopSession: McpShopSessionService,
        private readonly configService: ConfigService,
        private readonly connection: TransactionalConnection,
        @Inject(MCP_PLUGIN_OPTIONS) private readonly options: ResolvedMcpPluginOptions,
    ) {}

    /** @internal */
    onApplicationBootstrap(): void {
        this.discoverTools();
        this.discoveryMetaTools = this.buildDiscoveryMetaTools();
        this.bm25 = this.buildSearchIndexes();
    }

    /**
     * Every registered tool. Consumed by the admin API.
     *
     * @internal
     */
    getRegistrySnapshot(): McpRegisteredTool[] {
        return [...this.tools.values()];
    }

    /** @internal */
    async getExposedTools(
        executionContext: McpExecutionContext,
        toolset: McpToolset,
    ): Promise<McpExposedTool[]> {
        if (this.options.toolExposure === 'discovery') {
            return this.discoveryMetaTools;
        }
        return this.visibleTools(executionContext.ctx, toolset);
    }

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
                // The SDK validated only the envelope, so the tool's own arguments are validated here.
                const { name: innerName, arguments: args } = input as {
                    name: string;
                    arguments?: Record<string, unknown>;
                };
                return this.callRegisteredTool(executionContext, toolset, innerName, args ?? {}, {
                    validateInput: true,
                });
            }
        }
        return this.callRegisteredTool(executionContext, toolset, name, input, { validateInput: false });
    }

    async getCallableTools(ctx: RequestContext, toolset: McpToolset): Promise<McpToolSummary[]> {
        return (await this.visibleTools(ctx, toolset)).map(tool => this.toolSummary(tool));
    }

    /**
     * Skips the meta-tool routing in {@link callTool}, since a caller using this already knows which tool it wants.
     *
     * @internal
     */
    callToolDirect(
        executionContext: McpExecutionContext,
        toolset: McpToolset,
        name: string,
        input: unknown,
    ): Promise<CallToolResult> {
        return this.callRegisteredTool(executionContext, toolset, name, input, { validateInput: true });
    }

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

    /** @internal */
    isToolEnabled(
        tool: Pick<McpRegisteredTool, 'toolset' | 'name'>,
        toggles: Record<string, boolean>,
    ): boolean {
        return toggles[this.toolKey(tool.toolset, tool.name)] !== false;
    }

    async setToolEnabled(
        ctx: RequestContext,
        toolset: McpToolset,
        name: string,
        enabled: boolean,
    ): Promise<void> {
        const key = this.toolKey(toolset, name);
        const current = await this.getToolToggles(ctx);
        // Built as a copy so a refused write leaves the cached toggles as they were.
        const updated = { ...current, [key]: enabled };
        const saved = await this.settingsStoreService.set(ctx, MCP_TOOL_TOGGLES_STORE_KEY, updated);
        if (!saved.result) {
            throw new Error(
                `Could not save the MCP tool toggle for "${key}": ` +
                    `${saved.error ?? 'the settings store refused the write'}`,
            );
        }
        this.toggleCache = new WeakMap();
        this.toggleCache.set(ctx, updated);
    }

    // Also the persisted key in the tool-toggle settings map, so changing the format orphans stored toggles.
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
        return typeof (instance as Partial<McpToolHandler>).execute === 'function';
    }

    private buildRegisteredTool(
        metadata: McpToolMetadata,
        handler: McpToolHandler,
        pluginSource: string,
    ): McpRegisteredTool {
        this.assertValidToolMetadata(metadata);
        const resolvedBehavior = metadata.behavior ?? 'mutating';
        const acceptsSessionToken = this.acceptsSessionToken(metadata);
        const schemas = this.toolSchema.prepareToolSchemas({
            toolName: metadata.name,
            pluginSource,
            inputSchema: metadata.inputSchema,
            outputSchema: metadata.outputSchema,
            injectedFields: {
                confirm: resolvedBehavior === 'destructive',
                sessionToken: acceptsSessionToken,
            },
        });
        return {
            ...metadata,
            handler,
            pluginSource,
            resolvedBehavior,
            acceptsSessionToken,
            annotations: this.deriveAnnotations(metadata, resolvedBehavior),
            ...schemas,
        };
    }

    private assertValidToolMetadata(metadata: McpToolMetadata): void {
        if (typeof metadata.name !== 'string' || !TOOL_NAME_PATTERN.test(metadata.name)) {
            throw new Error(
                `MCP tool name "${String(metadata.name)}" must contain 1–128 letters, digits, ` +
                    `periods, hyphens, or underscores.`,
            );
        }
        for (const permission of metadata.permissions ?? []) {
            if (permission === Permission.Owner) {
                throw new Error(
                    `MCP tool "${metadata.name}" declares Permission.Owner, which no MCP caller can ` +
                        `satisfy. Use Permission.Authenticated and check ownership inside the tool.`,
                );
            }
            if (!this.getKnownPermissions().has(permission)) {
                throw new Error(
                    `MCP tool "${metadata.name}" declares unknown permission "${permission}". ` +
                        `Register it in authOptions.customPermissions.`,
                );
            }
        }
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
    }

    private getKnownPermissions(): Set<string> {
        if (!this.knownPermissions) {
            this.knownPermissions = new Set<string>([
                ...Object.values(Permission),
                ...this.configService.authOptions.customPermissions.flatMap(definition =>
                    definition.getMetadata().map(metadata => metadata.name),
                ),
            ]);
        }
        return this.knownPermissions;
    }

    private registerTool(tool: McpRegisteredTool): void {
        if (RESERVED_META_TOOL_NAMES.has(tool.name)) {
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
        options: ToolCallOptions,
    ): Promise<CallToolResult> {
        const admission = await this.admitToolCall(executionContext, toolset, name, input, options);
        if (admission.kind === 'refused') {
            return admission.result;
        }
        const { tool } = admission;
        // A destructive tool called without `confirm: true` only describes what it would do.
        const isConfirmationPreview =
            tool.resolvedBehavior === 'destructive' && admission.input.confirm !== true;

        const session = await this.resolveShopSession(
            executionContext,
            tool,
            admission.input,
            isConfirmationPreview,
        );
        if (session.kind === 'refused') {
            return session.result;
        }
        const { callContext, sessionToken } = session;
        // The preview carries the token too, so the confirming call can act on the same cart.
        if (isConfirmationPreview) {
            return this.confirmationRequiredResult(tool, sessionToken);
        }
        let toolInput = session.input;
        if (tool.resolvedBehavior === 'destructive') {
            const { confirm, ...rest } = toolInput;
            toolInput = rest;
        }

        const startedAt = Date.now();
        try {
            const output = await this.runToolHandler(tool, callContext, toolInput);
            return await this.buildToolCallResult({
                callContext,
                tool,
                input: toolInput,
                output,
                startedAt,
                sessionToken,
            });
        } catch (e) {
            return await this.handleToolCallError({
                error: e,
                callContext,
                tool,
                input: toolInput,
                startedAt,
                sessionToken,
            });
        }
    }

    // The prepared input no longer contains the sessionToken credential, so logs do not either.
    private async resolveShopSession(
        executionContext: McpExecutionContext,
        tool: McpRegisteredTool,
        input: Record<string, unknown>,
        isConfirmationPreview: boolean,
    ): Promise<ResolvedToolCallSession> {
        if (!tool.acceptsSessionToken) {
            return { kind: 'ready', callContext: executionContext, input, sessionToken: undefined };
        }
        const prepared = await this.shopSession.prepareToolCall({
            ctx: executionContext.ctx,
            input,
            isOAuthCall: executionContext.grant != null,
            // A preview runs no handler, so it must not start a cart of its own.
            toolWritesToCart: tool.resolvedBehavior !== 'readonly' && !isConfirmationPreview,
        });
        if (prepared.kind === 'refused') {
            return { kind: 'refused', result: this.errorResult(prepared.message) };
        }
        return {
            kind: 'ready',
            // A copy, not a write-back, since the transport reuses one execution context across a batch.
            callContext: { ...executionContext, ctx: prepared.ctx },
            input: prepared.input,
            sessionToken: prepared.sessionToken,
        };
    }

    // A writing tool runs in one transaction, so a throw rolls back all its writes.
    private async runToolHandler(
        tool: McpRegisteredTool,
        callContext: McpExecutionContext,
        toolInput: Record<string, unknown>,
    ): Promise<unknown> {
        if (tool.resolvedBehavior === 'readonly') {
            return tool.handler.execute(callContext.ctx, toolInput, this.toCallerInfo(callContext));
        }
        // withTransaction needs a promise; some handlers return a plain value.
        return this.connection.withTransaction(callContext.ctx, txCtx =>
            Promise.resolve(tool.handler.execute(txCtx, toolInput, this.toCallerInfo(callContext))),
        );
    }

    private async handleToolCallError(call: {
        error: unknown;
        callContext: McpExecutionContext;
        tool: McpRegisteredTool;
        input: Record<string, unknown>;
        startedAt: number;
        sessionToken: string | undefined;
    }): Promise<CallToolResult> {
        const { error, callContext, tool, input, startedAt, sessionToken } = call;
        const message = error instanceof Error ? error.message : 'MCP tool failed';
        const callerSafe = CALLER_SAFE_ERROR_TYPES.some(ErrorType => error instanceof ErrorType);
        const callerMessage =
            callerSafe && error instanceof I18nError
                ? callContext.ctx.translate(error.message, error.variables)
                : message;
        if (!callerSafe) {
            Logger.error(
                `MCP tool "${tool.name}" failed: ${message}`,
                loggerCtx,
                error instanceof Error ? error.stack : undefined,
            );
        }
        await this.toolCallLog.logToolCall({
            executionContext: callContext,
            tool,
            input,
            output: { message },
            durationMs: Date.now() - startedAt,
            status: 'error',
        });
        return this.errorResult(callerSafe ? callerMessage : GENERIC_TOOL_ERROR_MESSAGE, sessionToken);
    }

    private async admitToolCall(
        executionContext: McpExecutionContext,
        toolset: McpToolset,
        name: string,
        input: unknown,
        options: ToolCallOptions,
    ): Promise<ToolCallAdmission> {
        const ctx = executionContext.ctx;
        const rateLimited = await this.rateLimiter.checkRateLimit({
            executionContext,
            endpoint: toolset,
            subject: name,
        });
        if (rateLimited) {
            return { kind: 'refused', result: this.errorResult(rateLimited.message) };
        }
        const tool = this.tools.get(this.toolKey(toolset, name));
        if (!tool) {
            return { kind: 'refused', result: this.errorResult(`Unknown MCP tool: ${name}`) };
        }
        const toggles = await this.getToolToggles(ctx);
        if (!this.isToolEnabled(tool, toggles)) {
            return { kind: 'refused', result: this.errorResult(`MCP tool is disabled: ${name}`) };
        }
        if (!this.hasPermissions(ctx, tool)) {
            return {
                kind: 'refused',
                result: this.errorResult(`You do not have permission to call MCP tool: ${name}`),
            };
        }
        let toolInput: Record<string, unknown> = (input ?? {}) as Record<string, unknown>;
        if (options.validateInput) {
            const validated = await this.toolSchema.validate(tool.compiledInputSchema, toolInput);
            if (!validated.ok) {
                return {
                    kind: 'refused',
                    result: this.errorResult(`Invalid arguments for tool "${name}": ${validated.message}`),
                };
            }
            toolInput = (validated.value ?? {}) as Record<string, unknown>;
        }
        return { kind: 'admitted', tool, input: toolInput };
    }

    private async buildToolCallResult(call: {
        callContext: McpExecutionContext;
        tool: McpRegisteredTool;
        input: Record<string, unknown>;
        output: unknown;
        startedAt: number;
        sessionToken: string | undefined;
    }): Promise<CallToolResult> {
        const {
            callContext,
            tool,
            input: toolInput,
            output,
            startedAt,
            sessionToken: sessionTokenForResult,
        } = call;

        if (isGraphQlErrorResult(output as GraphQLErrorResult | undefined)) {
            const errorResult = { ...(output as GraphQLErrorResult) };
            await this.toolCallLog.logToolCall({
                executionContext: callContext,
                tool,
                input: toolInput,
                output: errorResult,
                durationMs: Date.now() - startedAt,
                status: 'error',
            });

            const messageKey = `errorResult.${errorResult.message}`;
            const translated = callContext.ctx.translate(messageKey, errorResult);
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
        // Serializing before the log row is written so an unserializable value is caught as one error row.
        const result = this.shopSession.addSessionTokenToResult(output, sessionTokenForResult);
        const text = JSON.stringify(result ?? null);
        const bytes = Buffer.byteLength(text, 'utf8');
        const overLimit = bytes > MAX_RESULT_BYTES;
        // An oversized read is a failure; an oversized write already changed the data, so only the result is withheld.
        const refuseAsError = overLimit && tool.resolvedBehavior === 'readonly';
        const refusalMessage = refuseAsError ? this.tooLargeMessage(tool, bytes) : undefined;
        await this.toolCallLog.logToolCall({
            executionContext: callContext,
            tool,
            input: toolInput,
            output: refusalMessage !== undefined ? { message: refusalMessage } : output,
            durationMs: Date.now() - startedAt,
            status: refuseAsError ? 'error' : 'success',
        });
        if (refusalMessage !== undefined) {
            return this.errorResult(refusalMessage, sessionTokenForResult);
        }
        if (overLimit) {
            return this.completedTooLargeResult(tool, bytes, sessionTokenForResult);
        }
        return this.successResult(result, text);
    }

    private async searchTools(
        executionContext: McpExecutionContext,
        toolset: McpToolset,
        input: unknown,
    ): Promise<CallToolResult> {
        // Unlike execute_tool, search_tools has no target tool to rate-limit downstream, so it is gated here.
        const rateLimited = await this.rateLimiter.checkRateLimit({
            executionContext,
            endpoint: toolset,
            subject: SEARCH_TOOLS,
        });
        if (rateLimited) {
            return this.errorResult(rateLimited.message);
        }
        const params = (input ?? {}) as { query?: unknown; limit?: unknown };
        const query = typeof params.query === 'string' ? params.query.toLowerCase() : '';
        const limit = Math.min(
            Math.max(typeof params.limit === 'number' ? params.limit : SEARCH_DEFAULT_LIMIT, 1),
            SEARCH_MAX_LIMIT,
        );
        const tools = await this.visibleTools(executionContext.ctx, toolset);
        const index = this.bm25.get(toolset);
        const matches = tools
            .map(tool => ({
                tool,
                score: query.length === 0 ? 1 : (index?.score(tool.name, query) ?? 0),
            }))
            .filter(item => item.score > 0)
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
                .map(tool => ({
                    id: tool.name,
                    text: [tool.name, tool.title ?? '', tool.description, ...(tool.keywords ?? [])].join(' '),
                }));
            indexes.set(toolset, new Bm25Index(entries));
        }
        return indexes;
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
                    `MCP tool "${SEARCH_TOOLS}" (McpPlugin) inputSchema`,
                ),
            },
            {
                name: EXECUTE_TOOL,
                description:
                    'Execute a Vendure MCP tool found via search_tools. Provide the tool name and its arguments.',
                annotations: {},
                compiledInputSchema: this.toolSchema.compileJsonSchema(
                    executeSchema,
                    `MCP tool "${EXECUTE_TOOL}" (McpPlugin) inputSchema`,
                ),
            },
        ];
    }

    private async visibleTools(ctx: RequestContext, toolset: McpToolset): Promise<McpRegisteredTool[]> {
        const toggles = await this.getToolToggles(ctx);
        return [...this.tools.values()]
            .filter(tool => tool.toolset === toolset)
            .filter(tool => this.isToolEnabled(tool, toggles))
            .filter(tool => this.hasPermissions(ctx, tool))
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    private deriveAnnotations(tool: McpToolMetadata, behavior: McpToolBehavior): ToolAnnotations {
        return {
            title: tool.title,
            readOnlyHint: behavior === 'readonly',
            destructiveHint: behavior === 'destructive',
            idempotentHint: behavior === 'readonly',
        };
    }

    private hasPermissions(ctx: RequestContext, tool: Pick<McpRegisteredTool, 'permissions'>): boolean {
        const permissions = tool.permissions ?? [];
        if (this.isPubliclyCallable(permissions)) {
            return true;
        }
        return ctx.userHasPermissions(permissions);
    }

    // Spelled out because `ctx.userHasPermissions([])` returns false, unlike an empty permissions list here.
    private isPubliclyCallable(permissions: Permission[]): boolean {
        return permissions.length === 0 || permissions.includes(Permission.Public);
    }

    private acceptsSessionToken(
        tool: Pick<McpRegisteredTool, 'toolset' | 'permissions' | 'usesActiveOrder'>,
    ): boolean {
        return (
            tool.toolset === 'shop' &&
            tool.usesActiveOrder === true &&
            this.isPubliclyCallable(tool.permissions ?? [])
        );
    }

    private toCallerInfo(state: McpExecutionContext): McpCallerInfo {
        return {
            grant: state.grant ? { id: state.grant.id, oauthClientId: state.grant.oauthClientId } : undefined,
            clientIp: state.clientIp,
        };
    }

    private getPluginSource(wrapper: {
        host?: { metatype?: { name?: string } };
        name?: string | symbol;
    }): string {
        return wrapper.host?.metatype?.name ?? String(wrapper.name ?? 'unknown');
    }

    // The tool path passes the `text` it already built to measure the result, so it is not serialized twice.
    private successResult(output: unknown, text = JSON.stringify(output ?? null)): CallToolResult {
        return {
            content: [{ type: 'text', text }],
            structuredContent: output,
        };
    }

    private tooLargeMessage(tool: McpRegisteredTool, bytes: number): string {
        const declared = tool.wireJsonSchema.properties ?? {};
        const advice = Object.keys(NARROWING_ARGUMENT_ADVICE)
            .filter(argument => argument in declared)
            .map(argument => NARROWING_ARGUMENT_ADVICE[argument]);
        const size =
            `The result of "${tool.name}" is ${bytes.toLocaleString('en-US')} bytes, over the ` +
            `${MAX_RESULT_BYTES.toLocaleString('en-US')}-byte limit for one tool result.`;
        if (advice.length === 0) {
            return `${size} Ask for less at a time.`;
        }
        return `${size} Ask for less at a time: ${this.joinWithOr(advice)}.`;
    }

    // Not an error: the write already saved, so the caller is told to read the outcome back rather than retry.
    private completedTooLargeResult(
        tool: McpRegisteredTool,
        bytes: number,
        sessionToken?: string,
    ): CallToolResult {
        const text =
            `The call to "${tool.name}" completed, but its result was ${bytes.toLocaleString('en-US')} ` +
            `bytes, over the ${MAX_RESULT_BYTES.toLocaleString('en-US')}-byte limit, so it was not ` +
            `returned. Fetch the outcome with a read tool.`;
        return {
            content: [{ type: 'text', text }],
            structuredContent: {
                status: 'completed_result_too_large',
                ...(sessionToken !== undefined ? { sessionToken } : {}),
            },
        };
    }

    /** Reads a list of choices as a sentence does: "a", "a or b", "a, b, or c". */
    private joinWithOr(options: string[]): string {
        if (options.length < 3) {
            return options.join(' or ');
        }
        return `${options.slice(0, -1).join(', ')}, or ${options[options.length - 1]}`;
    }

    private errorResult(message: string, sessionToken?: string): CallToolResult {
        return {
            isError: true,
            content: [{ type: 'text', text: message }],
            // Handing back a session token from a failed call lets the caller keep the same cart on retry.
            ...(sessionToken !== undefined ? { structuredContent: { sessionToken } } : {}),
        };
    }

    // Unlike `errorResult`, the whole object is kept so a caller can act on `errorCode` rather than parse a sentence.
    private vendureErrorResult(output: unknown): CallToolResult {
        return {
            isError: true,
            content: [{ type: 'text', text: JSON.stringify(output) }],
            structuredContent: output as Record<string, unknown>,
        };
    }

    private confirmationRequiredResult(tool: McpRegisteredTool, sessionToken?: string): CallToolResult {
        // Discovery mode never exposes the tool by name, so the retry has to go through the meta-tool instead.
        const howToConfirm =
            this.options.toolExposure === 'discovery'
                ? `Ask the user to approve it, then call "${EXECUTE_TOOL}" again for "${tool.name}" ` +
                  `with "confirm": true added to its arguments.`
                : `Ask the user to approve it, then re-call "${tool.name}" with "confirm": true.`;
        return {
            content: [
                {
                    type: 'text',
                    text: `This is a destructive action: ${tool.description} ${howToConfirm}`,
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
