import type { CommandEnvelope, CommandEvent, ToolBehavior } from '@vendure/common/lib/command';
import { MergedManifestCommand } from '@vendure/common/lib/command/manifest';
import readline from 'node:readline';
import type { Readable, Writable } from 'node:stream';

import { ADMIN_TOOL_PREFIX, AdminProxy, AdminTool, toolResult, withDeveloperMcpCall } from './admin-proxy.js';
import { runToolInChild } from './run-tool-in-child.js';

const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

/** The log levels of MCP, from the least to the most severe. */
const LOG_LEVELS = ['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency'];
type LogLevel = 'debug' | 'info' | 'warning';

export type McpToolMode = 'discovery' | 'direct';

export type RunTool = (
    path: string[],
    input: Record<string, unknown>,
    hooks: { signal: AbortSignal; onEvent(event: CommandEvent): void; onLog(line: string): void },
) => Promise<CommandEnvelope>;

export interface McpServerOptions {
    commands: MergedManifestCommand[];
    mode: McpToolMode;
    input: Readable;
    output: Writable;
    version: string;
    /** Runs one tool call. Defaults to a new child process of the CLI. */
    runTool?: RunTool;
    cliBin?: string;
    /** The project directory the child processes start in. */
    cwd?: string;
    /** The Store MCP's admin tools of the running dev server, offered as `admin_*`. */
    adminTools?: AdminProxy;
}

interface JsonRpcMessage {
    jsonrpc: '2.0';
    id?: string | number;
    method?: string;
    params?: any;
}

interface SearchEntry {
    name: string;
    description: string;
    behavior: string;
    keywords: string[];
    inputSchema: unknown;
}

/** Runs one job at a time, in the order they arrive. */
class SerialQueue {
    private tail: Promise<unknown> = Promise.resolve();
    run<T>(job: () => Promise<T>): Promise<T> {
        const result = this.tail.then(job, job);
        this.tail = result.catch(() => undefined);
        return result;
    }
}

const EXECUTORS: Record<string, ToolBehavior> = {
    execute_readonly: 'readonly',
    execute_mutating: 'mutating',
    execute_destructive: 'destructive',
};

export function toolName(command: { path: string[] }): string {
    return command.path.join('_');
}

/** Whether a command is offered as a tool. */
export function isExposed(command: MergedManifestCommand): boolean {
    return command.behavior !== 'service' && command.expose.mcp;
}

/**
 * A stdio MCP server whose tools come from the command manifest. It runs no command code in its
 * own process: every tool call is `vendure <path> --json --input -` in a child process.
 *
 * Mutating and destructive calls run one at a time, since two of them can change the same files.
 * Read-only calls run in parallel.
 */
export class McpServer {
    private readonly commands: MergedManifestCommand[];
    private readonly byName = new Map<string, MergedManifestCommand>();
    private readonly inFlight = new Map<string | number, AbortController>();
    private readonly writes = new SerialQueue();
    private readonly runTool: RunTool;
    /** The least severe level the client wants, set with `logging/setLevel`. */
    private minLogLevel = 0;

    constructor(private readonly options: McpServerOptions) {
        this.commands = options.commands.filter(isExposed);
        for (const command of this.commands) {
            this.byName.set(toolName(command), command);
        }
        this.runTool =
            options.runTool ??
            ((path, input, hooks) =>
                runToolInChild(path, input, {
                    cliBin: options.cliBin ?? process.argv[1],
                    cwd: options.cwd ?? process.cwd(),
                    ...hooks,
                }));
    }

    /** Reads messages until the input ends, then waits for the calls still running. */
    async serve(): Promise<void> {
        const adminTools = this.options.adminTools;
        adminTools?.onListChanged(() =>
            this.send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' }),
        );
        adminTools?.watch();
        const pending = new Set<Promise<void>>();
        const lines = readline.createInterface({ input: this.options.input });
        lines.on('line', line => {
            if (!line.trim()) {
                return;
            }
            let message: JsonRpcMessage;
            try {
                message = JSON.parse(line) as JsonRpcMessage;
            } catch {
                this.send({
                    jsonrpc: '2.0',
                    id: null as any,
                    error: { code: -32700, message: 'Parse error' },
                });
                return;
            }
            const job = this.handle(message).catch(() => undefined);
            pending.add(job);
            void job.finally(() => pending.delete(job));
        });
        await new Promise<void>(resolve => lines.on('close', resolve));
        // The client has gone, so stop what is still running.
        for (const controller of this.inFlight.values()) {
            controller.abort();
        }
        await Promise.all(pending);
        adminTools?.close();
    }

    private send(message: object): void {
        this.options.output.write(`${JSON.stringify(message)}\n`);
    }

    private reply(id: string | number | undefined, result: unknown): void {
        if (id !== undefined) {
            this.send({ jsonrpc: '2.0', id, result });
        }
    }

    private replyError(id: string | number | undefined, code: number, message: string): void {
        if (id !== undefined) {
            this.send({ jsonrpc: '2.0', id, error: { code, message } });
        }
    }

    private async handle(message: JsonRpcMessage): Promise<void> {
        const { id, method, params } = message;
        switch (method) {
            case 'initialize': {
                const requested = params?.protocolVersion as string | undefined;
                this.reply(id, {
                    protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested ?? '')
                        ? requested
                        : SUPPORTED_PROTOCOL_VERSIONS[0],
                    // The admin tools come and go with the dev server.
                    capabilities: { tools: { listChanged: !!this.options.adminTools }, logging: {} },
                    serverInfo: { name: 'vendure-developer-mcp', version: this.options.version },
                    instructions:
                        'The Developer MCP runs the commands of the Vendure CLI for the current project. ' +
                        (this.options.mode === 'discovery'
                            ? 'Use search_tools to find a command, then run it with the executor that matches its behavior.'
                            : 'Each command is a tool.') +
                        (this.options.adminTools
                            ? ' Tools named admin_* are the Store MCP admin tools of the running dev server.' +
                              ' They act on the store as the superadmin, and are listed while the dev server is ready.'
                            : ''),
                });
                return;
            }
            case 'ping':
                this.reply(id, {});
                return;
            case 'logging/setLevel': {
                const level = LOG_LEVELS.indexOf(String(params?.level));
                if (level === -1) {
                    this.replyError(id, -32602, `Unknown log level "${String(params?.level)}"`);
                    return;
                }
                this.minLogLevel = level;
                this.reply(id, {});
                return;
            }
            case 'tools/list':
                this.reply(id, { tools: await this.listTools() });
                return;
            case 'tools/call':
                await this.callTool(id, params);
                return;
            case 'notifications/cancelled':
                this.inFlight.get(params?.requestId)?.abort();
                return;
            default:
                if (id !== undefined && method !== undefined) {
                    this.replyError(id, -32601, `Method not found: ${method}`);
                }
        }
    }

    private async listTools(): Promise<object[]> {
        if (this.options.mode === 'direct') {
            const adminTools = await this.listAdminTools();
            return [
                ...this.commands.map(command => ({
                    name: toolName(command),
                    description: command.description,
                    inputSchema: command.input,
                    annotations: {
                        readOnlyHint: command.behavior === 'readonly',
                        destructiveHint: command.behavior === 'destructive',
                    },
                })),
                ...adminTools.map(tool => ({
                    name: tool.name,
                    ...(tool.title ? { title: tool.title } : {}),
                    description: tool.description,
                    inputSchema: tool.inputSchema,
                    annotations: tool.annotations,
                })),
            ];
        }
        const executorSchema = {
            type: 'object',
            properties: {
                tool: { type: 'string', description: 'The tool name, from search_tools' },
                input: { type: 'object', description: 'The input of the tool, as search_tools shows it' },
            },
            required: ['tool'],
        };
        return [
            {
                name: 'search_tools',
                description:
                    'Search the commands of this project, and the admin_* tools of its running dev server, by name, ' +
                    'description or keyword. Returns each match with its behavior and input schema.',
                inputSchema: {
                    type: 'object',
                    properties: { query: { type: 'string' }, limit: { type: 'number' } },
                    required: ['query'],
                },
                annotations: { readOnlyHint: true },
            },
            ...Object.entries(EXECUTORS).map(([name, behavior]) => ({
                name,
                description: `Run a ${behavior} tool found with search_tools.`,
                inputSchema: executorSchema,
                annotations: {
                    readOnlyHint: behavior === 'readonly',
                    destructiveHint: behavior === 'destructive',
                },
            })),
        ];
    }

    private async search(query: string, limit: number): Promise<object[]> {
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        const adminTools = await this.listAdminTools();
        const entries: SearchEntry[] = [
            ...this.commands.map(command => ({
                name: toolName(command),
                description: command.description,
                behavior: command.behavior,
                keywords: command.keywords,
                inputSchema: command.input,
            })),
            ...adminTools.map(tool => ({
                name: tool.name,
                description: tool.description,
                behavior: tool.behavior,
                keywords: tool.keywords,
                inputSchema: tool.inputSchema,
            })),
        ];
        const scored = entries
            .map(entry => {
                const haystack = [entry.name, entry.description, ...entry.keywords].join(' ').toLowerCase();
                const score = words.filter(word => haystack.includes(word)).length;
                return { entry, score };
            })
            .filter(item => words.length === 0 || item.score > 0)
            .sort((a, b) => b.score - a.score);
        return scored.slice(0, limit).map(({ entry }) => ({
            name: entry.name,
            description: entry.description,
            behavior: entry.behavior,
            inputSchema: entry.inputSchema,
        }));
    }

    private toolError(message: string) {
        return { isError: true, content: [{ type: 'text', text: message }] };
    }

    private async callTool(id: string | number | undefined, params: any): Promise<void> {
        const name = params?.name as string;
        const args = (params?.arguments ?? {}) as Record<string, unknown>;
        const progressToken = params?._meta?.progressToken as string | number | undefined;

        let command: MergedManifestCommand | undefined;
        let input: Record<string, unknown> = args;
        if (this.options.mode === 'discovery') {
            if (name === 'search_tools') {
                const limit = typeof args.limit === 'number' ? args.limit : 10;
                const matches = await this.search(typeof args.query === 'string' ? args.query : '', limit);
                // Tell the agent why no admin_* tool matched, and how to fix it.
                const adminTools = this.options.adminTools?.unavailable();
                const structuredContent = { tools: matches, ...(adminTools ? { adminTools } : {}) };
                this.reply(id, {
                    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
                    structuredContent,
                });
                return;
            }
            const behavior = EXECUTORS[name];
            if (!behavior) {
                this.reply(id, this.toolError(`Unknown tool "${name}"`));
                return;
            }
            input = (args.input ?? {}) as Record<string, unknown>;
            if (this.isAdminToolName(args.tool)) {
                await this.callAdminTool(id, String(args.tool), input, behavior);
                return;
            }
            command = this.byName.get(String(args.tool));
            if (!command) {
                this.reply(id, this.toolError(`Unknown tool "${String(args.tool)}". Use search_tools.`));
                return;
            }
            if (command.behavior !== behavior) {
                this.reply(
                    id,
                    this.toolError(
                        `"${toolName(command)}" is ${command.behavior}. Run it with execute_${command.behavior}.`,
                    ),
                );
                return;
            }
        } else {
            if (this.isAdminToolName(name)) {
                await this.callAdminTool(id, name, input);
                return;
            }
            command = this.byName.get(name);
            if (!command) {
                this.replyError(id, -32602, `Unknown tool "${name}"`);
                return;
            }
        }

        const controller = new AbortController();
        if (id !== undefined) {
            this.inFlight.set(id, controller);
        }
        const target = command;
        // Progress must increase with each notification for one request.
        let progress = 0;
        const execute = async (): Promise<CommandEnvelope | undefined> => {
            if (controller.signal.aborted) {
                return undefined;
            }
            return this.runTool(target.path, input, {
                signal: controller.signal,
                onEvent: event => {
                    if (event.type === 'progress' && progressToken !== undefined) {
                        const current = typeof event.current === 'number' ? event.current : undefined;
                        progress = current !== undefined && current > progress ? current : progress + 1;
                        this.sendProgress(progressToken, progress, event);
                        return;
                    }
                    this.forwardEvent(toolName(target), event);
                },
                onLog: line => this.log('debug', toolName(target), line),
            });
        };
        try {
            const envelope = await (target.behavior === 'readonly' ? execute() : this.writes.run(execute));
            // A cancelled request gets no response.
            if (controller.signal.aborted) {
                return;
            }
            if (!envelope) {
                return;
            }
            this.reply(id, {
                content: [{ type: 'text', text: JSON.stringify(envelope) }],
                structuredContent: envelope,
                // `incomplete` is a normal result: the caller supplies the needs and runs again.
                isError: envelope.status === 'error' || envelope.status === 'failed',
            });
        } finally {
            if (id !== undefined) {
                this.inFlight.delete(id);
            }
        }
    }

    /** The admin tools of the dev server, without those whose name a command already has. */
    private async listAdminTools(): Promise<AdminTool[]> {
        const tools = (await this.options.adminTools?.tools()) ?? [];
        return tools.filter(tool => !this.byName.has(tool.name));
    }

    /** Whether a tool name is a proxied admin tool. A command of the same name wins. */
    private isAdminToolName(name: unknown): boolean {
        return (
            !!this.options.adminTools &&
            typeof name === 'string' &&
            name.startsWith(ADMIN_TOOL_PREFIX) &&
            !this.byName.has(name)
        );
    }

    /**
     * Calls a Store MCP admin tool and passes its result through unchanged. In discovery mode the
     * executor must match the tool's behavior. Mutating and destructive calls wait for the other
     * writes of this project, like commands.
     */
    private async callAdminTool(
        id: string | number | undefined,
        name: string,
        input: Record<string, unknown>,
        executorBehavior?: ToolBehavior,
    ): Promise<void> {
        const proxy = this.options.adminTools as AdminProxy;
        const controller = new AbortController();
        if (id !== undefined) {
            this.inFlight.set(id, controller);
        }
        try {
            const tool = await proxy.find(name, controller.signal);
            if (!tool) {
                // While the tools cannot be called, the call returns why, with a fix.
                const reason = proxy.unavailable();
                this.reply(
                    id,
                    reason ? toolResult(reason) : this.toolError(`Unknown tool "${name}". Use search_tools.`),
                );
                return;
            }
            if (executorBehavior && tool.behavior !== executorBehavior) {
                this.reply(
                    id,
                    this.toolError(
                        `"${tool.name}" is ${tool.behavior}. Run it with execute_${tool.behavior}.`,
                    ),
                );
                return;
            }
            const execute = () =>
                proxy.call(name, input, controller.signal, { readonly: tool.behavior === 'readonly' });
            const result = await (tool.behavior === 'readonly' ? execute() : this.writes.run(execute));
            if (!controller.signal.aborted) {
                this.reply(
                    id,
                    withDeveloperMcpCall(result, name, executorBehavior && `execute_${executorBehavior}`),
                );
            }
        } catch (e) {
            if (!controller.signal.aborted) {
                this.reply(id, this.toolError(`The admin tool "${name}" failed: ${(e as Error).message}`));
            }
        } finally {
            if (id !== undefined) {
                this.inFlight.delete(id);
            }
        }
    }

    private sendProgress(token: string | number, progress: number, event: CommandEvent): void {
        this.send({
            jsonrpc: '2.0',
            method: 'notifications/progress',
            params: {
                progressToken: token,
                progress,
                ...(typeof event.total === 'number' ? { total: event.total } : {}),
                message: typeof event.message === 'string' ? event.message : '',
            },
        });
    }

    private forwardEvent(tool: string, event: CommandEvent): void {
        if (event.type === 'notice') {
            this.log(event.level === 'warning' ? 'warning' : 'info', tool, String(event.message));
            return;
        }
        this.log('info', tool, event);
    }

    private log(level: LogLevel, logger: string, data: unknown): void {
        if (LOG_LEVELS.indexOf(level) < this.minLogLevel) {
            return;
        }
        this.send({ jsonrpc: '2.0', method: 'notifications/message', params: { level, logger, data } });
    }
}
