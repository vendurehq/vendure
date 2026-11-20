import type { CommandEnvelope, CommandEvent, ToolBehavior } from '@vendure/common/lib/command';
import readline from 'node:readline';
import type { Readable, Writable } from 'node:stream';

import { MergedManifestCommand } from '../manifest.js';

import { runToolInChild } from './run-tool-in-child.js';

const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

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
}

interface JsonRpcMessage {
    jsonrpc: '2.0';
    id?: string | number;
    method?: string;
    params?: any;
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
    private progressCounter = 0;

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
                    capabilities: { tools: { listChanged: false }, logging: {} },
                    serverInfo: { name: 'vendure-developer-mcp', version: this.options.version },
                    instructions:
                        'The Developer MCP runs the commands of the Vendure CLI for the current project. ' +
                        (this.options.mode === 'discovery'
                            ? 'Use search_tools to find a command, then run it with the executor that matches its behavior.'
                            : 'Each command is a tool.'),
                });
                return;
            }
            case 'ping':
                this.reply(id, {});
                return;
            case 'logging/setLevel':
                this.reply(id, {});
                return;
            case 'tools/list':
                this.reply(id, { tools: this.listTools() });
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

    private listTools(): object[] {
        if (this.options.mode === 'direct') {
            return this.commands.map(command => ({
                name: toolName(command),
                description: command.description,
                inputSchema: command.input,
                annotations: {
                    readOnlyHint: command.behavior === 'readonly',
                    destructiveHint: command.behavior === 'destructive',
                },
            }));
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
                    'Search the commands of this project by name, description or keyword. Returns each match with its behavior and input schema.',
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

    private search(query: string, limit: number): object[] {
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        const scored = this.commands
            .map(command => {
                const haystack = [toolName(command), command.description, ...command.keywords]
                    .join(' ')
                    .toLowerCase();
                const score = words.filter(word => haystack.includes(word)).length;
                return { command, score };
            })
            .filter(entry => words.length === 0 || entry.score > 0)
            .sort((a, b) => b.score - a.score);
        return scored.slice(0, limit).map(({ command }) => ({
            name: toolName(command),
            description: command.description,
            behavior: command.behavior,
            inputSchema: command.input,
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
                const matches = this.search(String(args.query ?? ''), limit);
                this.reply(id, {
                    content: [{ type: 'text', text: JSON.stringify(matches) }],
                    structuredContent: { tools: matches },
                });
                return;
            }
            const behavior = EXECUTORS[name];
            if (!behavior) {
                this.reply(id, this.toolError(`Unknown tool "${name}"`));
                return;
            }
            command = this.byName.get(String(args.tool));
            input = (args.input ?? {}) as Record<string, unknown>;
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
        const execute = async (): Promise<CommandEnvelope | undefined> => {
            if (controller.signal.aborted) {
                return undefined;
            }
            return this.runTool(target.path, input, {
                signal: controller.signal,
                onEvent: event => this.forwardEvent(toolName(target), event, progressToken),
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

    private forwardEvent(tool: string, event: CommandEvent, progressToken?: string | number): void {
        if (event.type === 'progress' && progressToken !== undefined) {
            this.send({
                jsonrpc: '2.0',
                method: 'notifications/progress',
                params: {
                    progressToken,
                    progress: ++this.progressCounter,
                    ...(typeof event.total === 'number' ? { total: event.total } : {}),
                    message: String(event.message ?? ''),
                },
            });
            return;
        }
        if (event.type === 'notice') {
            this.log(event.level === 'warning' ? 'warning' : 'info', tool, String(event.message));
            return;
        }
        this.log('info', tool, event);
    }

    private log(level: 'debug' | 'info' | 'warning', logger: string, data: unknown): void {
        this.send({ jsonrpc: '2.0', method: 'notifications/message', params: { level, logger, data } });
    }
}
