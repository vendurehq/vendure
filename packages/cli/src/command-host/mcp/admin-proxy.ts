import type {
    CommandEnvelope,
    CommandErrorDefinition,
    ErrorResult,
    ToolBehavior,
} from '@vendure/common/lib/command';
import { isErrorResult } from '@vendure/common/lib/command';
import fs from 'node:fs';

import {
    DevServerState,
    getDevServerStateFilePath,
    isDevRunAlive,
    readDevServerState,
} from '../../commands/dev/state-file.js';
import {
    localAdminApiErrorList,
    localAdminApiErrors,
    sendLocalAdminRequest,
} from '../../shared/local-admin-api.js';
import { errorResult } from '../host.js';

import { adminToolsErrors } from './admin-proxy.errors.js';

/** Proxied tools are named after their toolset on the Store MCP. */
export const ADMIN_TOOL_PREFIX = 'admin_';

/**
 * The `_meta` key under which the Store MCP lists a tool's search keywords. It matches
 * `MCP_TOOL_KEYWORDS_META_KEY` in `@vendure/mcp-plugin`, which the CLI does not depend on.
 */
export const STORE_TOOL_KEYWORDS_META_KEY = 'vendure.io/keywords';

/**
 * The header that selects the channel of a Store MCP call, until `set_active_channel` names the
 * one the server reads (`apiOptions.channelTokenKey`).
 */
export const CHANNEL_TOKEN_HEADER = 'vendure-token';

/** How long a check that the dev server's process is alive is reused. It runs `ps`. */
const ALIVE_CHECK_TTL_MS = 1000;

/** How often the state file is checked for a start or stop of the dev server. */
const WATCH_INTERVAL_MS = 1000;

/** How long one call to the Store MCP may take. */
const REQUEST_TIMEOUT_MS = 60_000;

/** The protocol version sent on each stateless request to the Store MCP. */
const STORE_PROTOCOL_VERSION = '2025-11-25';

/** A tool of the Store MCP, as the Developer MCP offers it. */
export interface AdminTool {
    /** The name the Developer MCP lists, `admin_<name>`. */
    name: string;
    /** The name of the tool on the Store MCP. */
    storeName: string;
    description: string;
    behavior: ToolBehavior;
    keywords: string[];
    inputSchema: unknown;
    annotations: Record<string, unknown>;
    title?: string;
}

/** What one JSON-RPC request to the Store MCP returned. */
export interface StoreResponse {
    /** The HTTP status. */
    status: number;
    /** The JSON-RPC response, or undefined when the body held none. */
    body: any;
}

/**
 * Sends one JSON-RPC message to the Store MCP's admin endpoint of the project's running dev
 * server, with the run's local-trust secret as the bearer token and the given extra headers.
 * Returns a coded error when no ready run serves the project or it cannot be reached.
 */
export type SendToStore = (
    projectDir: string,
    message: object,
    headers: Record<string, string>,
    signal: AbortSignal,
) => Promise<StoreResponse | ErrorResult>;

export interface AdminProxyOptions {
    /** The project directory, or undefined outside a Vendure project. */
    projectDir: string | undefined;
    send?: SendToStore;
    /** Reads the state file. Tests pass their own. */
    readState?: () => DevServerState | undefined;
    /** Whether the run that wrote the state is still running. Tests pass their own. */
    isAlive?: (state: DevServerState) => boolean;
    watchIntervalMs?: number;
}

/** Whether the admin tools can be called, and why not. */
type Availability =
    | { available: true; key: string; projectDir: string }
    | { available: false; key: string; error: CommandEnvelope };

/**
 * The `admin_*` tools of the Developer MCP. They are the tools of the Store MCP that the running
 * dev server serves on `POST /mcp/admin`, called over HTTP from the `vendure mcp` process with the
 * local-trust secret of the run.
 *
 * - The state file of the run is read lazily, on each list and call, so a restarted dev server
 *   (a new secret, a new URL) is picked up at once.
 * - The tool list comes from `tools/list` on the Store MCP. A local-trust caller sees every tool
 *   there, whatever the plugin's `toolExposure`.
 * - Results are passed through unchanged, including the `incomplete` result of a destructive tool.
 * - The active channel is kept for this connection and sent in the channel token header.
 *   `set_active_channel` returns the channel's token and the header's name under local trust, and
 *   the server keeps no state.
 * - When the state file appears or disappears, or a call fails, listeners are told that the tool
 *   list changed.
 */
export class AdminProxy {
    private readonly send: SendToStore;
    private readonly readState: () => DevServerState | undefined;
    private readonly isAlive: (state: DevServerState) => boolean;
    private readonly listeners = new Set<() => void>();
    private cached: { key: string; tools: AdminTool[] } | undefined;
    private lastKey: string | undefined;
    private channelToken: string | undefined;
    private channelHeader = CHANNEL_TOKEN_HEADER;
    private aliveCheck: { key: string; until: number; alive: boolean } | undefined;
    /** Why the last `tools/list` failed while the dev server was running. */
    private listError: CommandEnvelope | undefined;
    private watchedPath: string | undefined;

    constructor(private readonly options: AdminProxyOptions) {
        this.send = options.send ?? sendToStore;
        const projectDir = options.projectDir;
        this.readState =
            options.readState ?? (() => (projectDir ? readDevServerState(projectDir) : undefined));
        const isAlive = options.isAlive ?? isDevRunAlive;
        // Each list and call checks the state, so the `ps` behind the check is reused briefly.
        this.isAlive = state => {
            const key = `${state.pid}:${state.startedAt}`;
            const now = Date.now();
            if (this.aliveCheck?.key !== key || this.aliveCheck.until < now) {
                this.aliveCheck = { key, until: now + ALIVE_CHECK_TTL_MS, alive: isAlive(state) };
            }
            return this.aliveCheck.alive;
        };
    }

    /** Calls the listener when the admin tools may have changed. */
    onListChanged(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /** Starts watching the state file, so that a start or stop of the dev server is noticed. */
    watch(): void {
        if (this.watchedPath || !this.options.projectDir) {
            return;
        }
        let statePath: string;
        try {
            statePath = getDevServerStateFilePath(this.options.projectDir);
        } catch {
            // On Windows without LOCALAPPDATA there is no state file to watch, and the tools report why.
            return;
        }
        this.watchedPath = statePath;
        this.lastKey = this.availability().key;
        // Polling, since the file and its directory may not exist yet, which fs.watch cannot follow.
        const watcher = fs.watchFile(
            statePath,
            { interval: this.options.watchIntervalMs ?? WATCH_INTERVAL_MS, persistent: false },
            () => this.checkForChange(),
        );
        watcher.unref?.();
    }

    /** Stops watching the state file. */
    close(): void {
        if (this.watchedPath) {
            fs.unwatchFile(this.watchedPath);
            this.watchedPath = undefined;
        }
        this.listeners.clear();
    }

    /**
     * Tells the listeners when the state of the dev server changed since it was last seen. Also
     * called after a failed call, since a dev server that crashed leaves its state file behind.
     */
    checkForChange(): void {
        // A failed call or a changed file may mean the run has gone, so check its process again.
        this.aliveCheck = undefined;
        const key = this.availability().key;
        if (key === this.lastKey) {
            return;
        }
        this.lastKey = key;
        this.cached = undefined;
        this.listError = undefined;
        this.notify();
    }

    private notify(): void {
        for (const listener of this.listeners) {
            listener();
        }
    }

    /**
     * The coded error that explains why the admin tools cannot be called, or undefined when they
     * can. It does not contact the dev server.
     */
    unavailable(): CommandEnvelope | undefined {
        const availability = this.availability();
        return availability.available ? this.listError : availability.error;
    }

    /**
     * The admin tools of the running dev server. Empty when the dev server is not running, the
     * Store MCP is missing, or the dev server could not be reached.
     */
    async tools(signal: AbortSignal = new AbortController().signal): Promise<AdminTool[]> {
        const availability = this.availability();
        if (!availability.available) {
            return [];
        }
        if (this.cached?.key === availability.key) {
            return this.cached.tools;
        }
        const tools: AdminTool[] = [];
        let cursor: string | undefined;
        do {
            const response = await this.request(
                availability.projectDir,
                'tools/list',
                cursor ? { cursor } : {},
                signal,
            );
            if (!response.ok) {
                this.listError = response.error;
                return [];
            }
            const result = response.result as { tools?: any[]; nextCursor?: string };
            for (const tool of result?.tools ?? []) {
                tools.push(toAdminTool(tool));
            }
            cursor = typeof result?.nextCursor === 'string' ? result.nextCursor : undefined;
        } while (cursor);
        this.cached = { key: availability.key, tools };
        if (this.listError) {
            // The list failed before, so a client may have listed no admin tools.
            this.listError = undefined;
            this.notify();
        }
        return tools;
    }

    /** Finds an admin tool by its `admin_*` name. */
    async find(name: string, signal?: AbortSignal): Promise<AdminTool | undefined> {
        if (!name.startsWith(ADMIN_TOOL_PREFIX)) {
            return undefined;
        }
        return (await this.tools(signal)).find(tool => tool.name === name);
    }

    /**
     * Calls a tool of the Store MCP by its `admin_*` name and returns the MCP tool result as the
     * Store MCP sent it. When the call cannot be made, the result is a coded error with fixes.
     */
    async call(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<object> {
        const availability = this.availability();
        if (!availability.available) {
            return toolResult(availability.error);
        }
        const storeName = name.slice(ADMIN_TOOL_PREFIX.length);
        const response = await this.request(
            availability.projectDir,
            'tools/call',
            { name: storeName, arguments: args },
            signal,
        );
        if (!response.ok) {
            return toolResult(response.error);
        }
        const result = response.result as { structuredContent?: any; isError?: boolean } | undefined;
        this.rememberChannel(storeName, result);
        return result ?? {};
    }

    /** The channel token this connection sends, set by `set_active_channel`. */
    get activeChannelToken(): string | undefined {
        return this.channelToken;
    }

    private rememberChannel(
        storeName: string,
        result: { structuredContent?: any; isError?: boolean } | undefined,
    ) {
        const { channelToken, channelTokenHeader } = result?.structuredContent ?? {};
        if (storeName === 'set_active_channel' && !result?.isError && typeof channelToken === 'string') {
            this.channelToken = channelToken;
            if (typeof channelTokenHeader === 'string' && channelTokenHeader) {
                this.channelHeader = channelTokenHeader;
            }
        }
    }

    private async request(
        projectDir: string,
        method: string,
        params: object,
        signal: AbortSignal,
    ): Promise<{ ok: true; result: unknown } | { ok: false; error: CommandEnvelope }> {
        const headers: Record<string, string> = {};
        if (this.channelToken) {
            headers[this.channelHeader] = this.channelToken;
        }
        const message = { jsonrpc: '2.0', id: 1, method, params };
        let response: StoreResponse | ErrorResult;
        try {
            response = await this.send(projectDir, message, headers, signal);
        } catch (e) {
            if (signal.aborted) {
                throw e;
            }
            this.checkForChange();
            if ((e as Error).name === 'TimeoutError') {
                return {
                    ok: false,
                    error: errorEnvelope(adminToolsErrors.storeTimedOut, {
                        seconds: REQUEST_TIMEOUT_MS / 1000,
                    }),
                };
            }
            return {
                ok: false,
                error: errorEnvelope(adminToolsErrors.storeUnreachable, { reason: (e as Error).message }),
            };
        }
        if (isErrorResult(response)) {
            // The run stopped since the state was read, or the server cannot be reached. A dev
            // server that crashed leaves its state file behind, so look again.
            this.checkForChange();
            return { ok: false, error: envelopeOf(response) };
        }
        if (response.status === 404) {
            return { ok: false, error: errorEnvelope(adminToolsErrors.storeMcpMissing, {}) };
        }
        if (response.status === 401) {
            return {
                ok: false,
                error: errorEnvelope(adminToolsErrors.storeRefused, {
                    message: 'it refused the local-trust secret of this run',
                }),
            };
        }
        if (
            response.status === 400 &&
            this.channelToken &&
            /sales channel/.test(String(response.body?.message ?? ''))
        ) {
            // The server refuses an unknown channel token before the tool runs. The channel was
            // deleted or its token changed, so later calls go to the default channel.
            this.channelToken = undefined;
            return {
                ok: false,
                error: errorEnvelope(adminToolsErrors.channelRefused, {
                    message: String(response.body?.message ?? 'the channel token was refused'),
                }),
            };
        }
        if (response.body?.jsonrpc && response.body.error) {
            const { code, message: text } = response.body.error as { code?: number; message?: string };
            return {
                ok: false,
                error: errorEnvelope(adminToolsErrors.storeRefused, {
                    message: text ?? `JSON-RPC error ${String(code)}`,
                }),
            };
        }
        if (response.status < 200 || response.status >= 300 || !response.body) {
            return {
                ok: false,
                error: errorEnvelope(adminToolsErrors.storeRefused, {
                    message: `HTTP ${response.status}`,
                }),
            };
        }
        return { ok: true, result: response.body.result };
    }

    private availability(): Availability {
        const projectDir = this.options.projectDir;
        if (!projectDir) {
            return unavailable('no-project', adminToolsErrors.noProject, {});
        }
        // The same checks as `resolveLocalAdminTarget`, which each request makes again. The state
        // also gives the key that tells one run, and one restart of it, from another.
        let state: DevServerState | undefined;
        try {
            state = this.readState();
        } catch {
            state = undefined;
        }
        if (!state || state.status === 'stopped' || !this.isAlive(state)) {
            return unavailable('stopped', localAdminApiErrors.notRunning, {});
        }
        if (state.status !== 'ready') {
            return unavailable(
                `${state.status}:${state.startedAt}:${state.restarts}`,
                localAdminApiErrors.notReady,
                {
                    status: state.status,
                },
            );
        }
        if (!state.urls.mcp) {
            // The plugin logs its endpoint only when local trust is on, so this names the fix.
            return unavailable(`no-mcp:${state.startedAt}`, adminToolsErrors.storeMcpMissing, {});
        }
        return {
            available: true,
            key: `ready:${state.startedAt}:${state.restarts}:${state.urls.mcp}`,
            projectDir,
        };
    }
}

function unavailable<Details>(
    key: string,
    error: CommandErrorDefinition<Details>,
    details: Details,
): Availability {
    return { available: false, key: `unavailable:${key}`, error: errorEnvelope(error, details) };
}

function errorEnvelope<Details>(error: CommandErrorDefinition<Details>, details: Details): CommandEnvelope {
    return errorResult(error, details).envelope;
}

/** The envelope of a coded error from the local Admin API helper. */
function envelopeOf(result: ErrorResult): CommandEnvelope {
    const definition = localAdminApiErrorList.find(error => error.code === result.code) as
        | CommandErrorDefinition
        | undefined;
    if (!definition) {
        return errorEnvelope(adminToolsErrors.storeRefused, { message: result.code });
    }
    return errorEnvelope(definition, result.details);
}

/** An MCP tool result for an error envelope, in the shape the CLI's own tools use. */
export function toolResult(envelope: CommandEnvelope): object {
    return {
        content: [{ type: 'text', text: JSON.stringify(envelope) }],
        structuredContent: envelope,
        isError: envelope.status === 'error' || envelope.status === 'failed',
    };
}

function toAdminTool(tool: any): AdminTool {
    const annotations = (tool.annotations ?? {}) as Record<string, unknown>;
    const keywords = tool._meta?.[STORE_TOOL_KEYWORDS_META_KEY];
    return {
        name: `${ADMIN_TOOL_PREFIX}${String(tool.name)}`,
        storeName: String(tool.name),
        description: String(tool.description ?? ''),
        title: typeof tool.title === 'string' ? tool.title : undefined,
        behavior: behaviorOf(annotations),
        keywords: Array.isArray(keywords) ? keywords.filter((k): k is string => typeof k === 'string') : [],
        inputSchema: tool.inputSchema ?? { type: 'object', properties: {} },
        annotations,
    };
}

/**
 * The behavior of a Store MCP tool, from its annotations. MCP treats a tool without
 * `destructiveHint` as destructive, so only an explicit `false` makes it `mutating`.
 */
export function behaviorOf(annotations: Record<string, unknown>): AdminTool['behavior'] {
    if (annotations.readOnlyHint === true) {
        return 'readonly';
    }
    return annotations.destructiveHint === false ? 'mutating' : 'destructive';
}

/**
 * Posts one JSON-RPC message to the Store MCP's admin endpoint through the local Admin API helper,
 * which sends the run's secret. The endpoint is stateless, so no `initialize` comes first.
 */
export const sendToStore: SendToStore = async (projectDir, message, headers, signal) => {
    const response = await sendLocalAdminRequest(projectDir, 'mcp-admin', message, {
        headers: { ...headers, 'mcp-protocol-version': STORE_PROTOCOL_VERSION },
        signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
    });
    if (isErrorResult(response)) {
        return response;
    }
    const text = await response.text();
    return {
        status: response.status,
        body: parseStoreBody(text, response.headers.get('content-type') ?? ''),
    };
};

/** Reads a JSON or server-sent-events body, which holds one JSON-RPC response. */
export function parseStoreBody(text: string, contentType: string): any {
    if (!text) {
        return undefined;
    }
    try {
        if (contentType.includes('text/event-stream')) {
            const data = text
                .split('\n')
                .filter(line => line.startsWith('data:'))
                .map(line => line.slice('data:'.length).trim())
                .filter(Boolean);
            // Progress and log notifications may come first. The response is the frame with an id.
            const frames = data.map(frame => JSON.parse(frame));
            return frames.find(frame => frame && 'id' in frame) ?? frames[frames.length - 1];
        }
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}

/**
 * Adds a note to an `incomplete` result of a Store MCP tool. The Store MCP names its own tool in
 * the result, which the Developer MCP lists as `admin_*`, behind an executor in discovery mode.
 * The result itself is passed through unchanged.
 */
export function withDeveloperMcpCall(result: any, toolName: string, executor: string | undefined): object {
    const consent = result?.structuredContent?.needs?.find((need: any) => need?.kind === 'consent');
    if (result?.structuredContent?.status !== 'incomplete' || !consent) {
        return result;
    }
    const field = JSON.stringify(String(consent.consent ?? 'confirm'));
    const call = executor
        ? `call ${executor} with "tool": "${toolName}" and the same "input" plus ${field}: "<digest>"`
        : `call ${toolName} again with the same arguments plus ${field}: "<digest>"`;
    const note = `In the Developer MCP, to give this consent, ${call}, with the digest from "needs".`;
    return {
        ...result,
        content: [...(Array.isArray(result.content) ? result.content : []), { type: 'text', text: note }],
    };
}
