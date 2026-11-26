import { CommandEnvelope } from '@vendure/common/lib/command';
import { ManifestCommand, MergedManifestCommand } from '@vendure/common/lib/command/manifest';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { DevServerState } from '../../commands/dev/state-file.js';

import { AdminProxy, SendToStore } from './admin-proxy.js';
import { CommandChanges, McpServer, McpToolMode, RunTool } from './server.js';

function command(path: string[], overrides: Partial<ManifestCommand> = {}): MergedManifestCommand {
    return {
        path,
        description: `${path.join(' ')} description`,
        keywords: [],
        behavior: 'readonly',
        requires: {},
        consents: {},
        input: { type: 'object', properties: {} },
        cli: {},
        errors: [],
        examples: [],
        expose: { mcp: true },
        hasPlan: false,
        source: '@vendure/cli',
        ...overrides,
    };
}

const COMMANDS = [
    command(['doctor'], { keywords: ['diagnose'] }),
    command(['add', 'codegen'], { behavior: 'mutating' }),
    command(['migrate', 'revert'], { behavior: 'destructive' }),
    command(['dev'], { behavior: 'service' }),
    command(['commands'], { expose: { mcp: false } }),
];

const ok = (output: unknown = {}): CommandEnvelope => ({
    schemaVersion: 1,
    status: 'ok',
    output,
    notices: [],
});

interface Client {
    send(message: object): void;
    next(): Promise<any>;
    all(): any[];
    close(): Promise<void>;
}

function start(
    runTool: RunTool,
    mode: McpToolMode = 'discovery',
    commands = COMMANDS,
    adminTools?: AdminProxy,
    commandChanges?: CommandChanges,
): Client {
    const input = new PassThrough();
    const output = new PassThrough();
    const received: any[] = [];
    const waiting: Array<(message: any) => void> = [];
    output.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString().split('\n').filter(Boolean)) {
            const message = JSON.parse(line);
            const waiter = waiting.shift();
            if (waiter) {
                waiter(message);
            } else {
                received.push(message);
            }
        }
    });
    const server = new McpServer({
        commands,
        mode,
        input,
        output,
        version: '1.2.3',
        runTool,
        adminTools,
        commandChanges,
    });
    const done = server.serve();
    return {
        send: message => input.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`),
        next: () =>
            received.length
                ? Promise.resolve(received.shift())
                : new Promise(resolve => waiting.push(resolve)),
        all: () => received,
        close: async () => {
            input.end();
            await done;
        },
    };
}

const tick = () => new Promise(resolve => setTimeout(resolve, 20));

describe('McpServer', () => {
    it('answers initialize with its version and tool capability', async () => {
        const client = start(async () => ok());
        client.send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
        const reply = await client.next();
        expect(reply.result.protocolVersion).toBe('2025-06-18');
        expect(reply.result.serverInfo.version).toBe('1.2.3');
        expect(reply.result.capabilities.tools).toBeDefined();
        await client.close();
    });

    it('offers search_tools and one executor per behavior in discovery mode', async () => {
        const client = start(async () => ok());
        client.send({ id: 1, method: 'tools/list' });
        const { result } = await client.next();
        expect(result.tools.map((t: any) => t.name)).toEqual([
            'search_tools',
            'execute_readonly',
            'execute_mutating',
            'execute_destructive',
        ]);
        const byName = Object.fromEntries(result.tools.map((t: any) => [t.name, t]));
        expect(byName.execute_destructive.annotations.destructiveHint).toBe(true);
        expect(byName.execute_readonly.annotations.readOnlyHint).toBe(true);
        await client.close();
    });

    it('names tools by joining the path with an underscore and skips service and CLI-only commands', async () => {
        const client = start(async () => ok(), 'direct');
        client.send({ id: 1, method: 'tools/list' });
        const { result } = await client.next();
        expect(result.tools.map((t: any) => t.name)).toEqual(['doctor', 'add_codegen', 'migrate_revert']);
        await client.close();
    });

    it('finds tools by name, description and keyword', async () => {
        const client = start(async () => ok());
        client.send({
            id: 1,
            method: 'tools/call',
            params: { name: 'search_tools', arguments: { query: 'diagnose' } },
        });
        const { result } = await client.next();
        expect(result.structuredContent.tools.map((t: any) => t.name)).toEqual(['doctor']);
        expect(result.structuredContent.tools[0].inputSchema).toBeDefined();
        await client.close();
    });

    it('runs a tool as a child with its path and input', async () => {
        const calls: Array<{ path: string[]; input: unknown }> = [];
        const client = start(async (path, input) => {
            calls.push({ path, input });
            return ok({ fine: true });
        });
        client.send({
            id: 1,
            method: 'tools/call',
            params: { name: 'execute_readonly', arguments: { tool: 'doctor', input: { strict: true } } },
        });
        const { result } = await client.next();
        expect(calls).toEqual([{ path: ['doctor'], input: { strict: true } }]);
        expect(result.structuredContent.output).toEqual({ fine: true });
        expect(result.isError).toBe(false);
        await client.close();
    });

    it('refuses to run a destructive tool through the read-only executor', async () => {
        let ran = false;
        const client = start(async () => {
            ran = true;
            return ok();
        });
        client.send({
            id: 1,
            method: 'tools/call',
            params: { name: 'execute_readonly', arguments: { tool: 'migrate_revert' } },
        });
        const { result } = await client.next();
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('execute_destructive');
        expect(ran).toBe(false);
        await client.close();
    });

    it('returns incomplete as a normal result and failed or error as an error result', async () => {
        const statuses: Array<CommandEnvelope['status']> = ['incomplete', 'failed', 'error'];
        const client = start(async () => ({
            schemaVersion: 1,
            status: statuses.shift() as CommandEnvelope['status'],
            notices: [],
        }));
        const flags: boolean[] = [];
        for (let id = 1; id <= 3; id++) {
            client.send({
                id,
                method: 'tools/call',
                params: { name: 'execute_readonly', arguments: { tool: 'doctor' } },
            });
            flags.push((await client.next()).result.isError);
        }
        expect(flags).toEqual([false, true, true]);
        await client.close();
    });

    it('runs mutating calls one at a time and read-only calls in parallel', async () => {
        const log: string[] = [];
        const releases: Array<() => void> = [];
        const client = start(async path => {
            log.push(`start ${path.join('_')}`);
            await new Promise<void>(resolve => releases.push(resolve));
            log.push(`end ${path.join('_')}`);
            return ok();
        });
        const call = (id: number, name: string, tool: string) =>
            client.send({ id, method: 'tools/call', params: { name, arguments: { tool } } });

        call(1, 'execute_mutating', 'add_codegen');
        call(2, 'execute_destructive', 'migrate_revert');
        await tick();
        expect(log).toEqual(['start add_codegen']);
        releases.shift()?.();
        await tick();
        expect(log).toEqual(['start add_codegen', 'end add_codegen', 'start migrate_revert']);
        releases.shift()?.();
        await client.next();
        await client.next();

        log.length = 0;
        call(3, 'execute_readonly', 'doctor');
        call(4, 'execute_readonly', 'doctor');
        await tick();
        expect(log).toEqual(['start doctor', 'start doctor']);
        releases.splice(0).forEach(release => release());
        await client.next();
        await client.next();
        await client.close();
    });

    it('turns progress events into progress notifications and other events into log notifications', async () => {
        const client = start(async (_path, _input, hooks) => {
            hooks.onEvent({ vendure: 'event', type: 'progress', message: 'half', total: 2 });
            hooks.onEvent({ vendure: 'event', type: 'notice', level: 'warning', message: 'backup 7' });
            hooks.onEvent({ vendure: 'event', type: 'notice', level: 'info', message: 'linked' });
            hooks.onLog('library noise');
            return ok();
        });
        client.send({
            id: 1,
            method: 'tools/call',
            params: {
                name: 'execute_readonly',
                arguments: { tool: 'doctor' },
                _meta: { progressToken: 'tok' },
            },
        });
        const messages = [];
        for (let i = 0; i < 5; i++) {
            messages.push(await client.next());
        }
        const methods = messages.map(m => m.method ?? 'response');
        expect(methods).toEqual([
            'notifications/progress',
            'notifications/message',
            'notifications/message',
            'notifications/message',
            'response',
        ]);
        expect(messages[0].params).toEqual({ progressToken: 'tok', progress: 1, message: 'half', total: 2 });
        expect(messages[1].params).toMatchObject({ level: 'warning', data: 'backup 7' });
        expect(messages[2].params).toMatchObject({ level: 'info', data: 'linked' });
        expect(messages[3].params).toMatchObject({ level: 'debug', data: 'library noise' });
        await client.close();
    });

    it('counts progress per call, and uses the current step of the event when it has one', async () => {
        const client = start(async (_path, _input, hooks) => {
            hooks.onEvent({ vendure: 'event', type: 'progress', message: 'one', current: 1, total: 3 });
            hooks.onEvent({ vendure: 'event', type: 'progress', message: 'three', current: 3, total: 3 });
            hooks.onEvent({ vendure: 'event', type: 'progress', message: 'tidy' });
            return ok();
        });
        const progressOf = async (id: number, token: string) => {
            client.send({
                id,
                method: 'tools/call',
                params: {
                    name: 'execute_readonly',
                    arguments: { tool: 'doctor' },
                    _meta: { progressToken: token },
                },
            });
            const values = [];
            for (let i = 0; i < 3; i++) {
                values.push((await client.next()).params.progress);
            }
            await client.next();
            return values;
        };
        expect(await progressOf(1, 'first')).toEqual([1, 3, 4]);
        // A second call starts again: progress belongs to one request.
        expect(await progressOf(2, 'second')).toEqual([1, 3, 4]);
        await client.close();
    });

    it('sends only the log notifications at or above the level the client set', async () => {
        const client = start(async (_path, _input, hooks) => {
            hooks.onLog('library noise');
            hooks.onEvent({ vendure: 'event', type: 'notice', level: 'info', message: 'linked' });
            hooks.onEvent({ vendure: 'event', type: 'notice', level: 'warning', message: 'backup 7' });
            return ok();
        });
        client.send({ id: 1, method: 'logging/setLevel', params: { level: 'warning' } });
        expect((await client.next()).result).toEqual({});
        client.send({
            id: 2,
            method: 'tools/call',
            params: { name: 'execute_readonly', arguments: { tool: 'doctor' } },
        });
        const log = await client.next();
        expect(log.params).toMatchObject({ level: 'warning', data: 'backup 7' });
        expect((await client.next()).id).toBe(2);
        client.send({ id: 3, method: 'logging/setLevel', params: { level: 'loud' } });
        expect((await client.next()).error.code).toBe(-32602);
        await client.close();
    });

    it('aborts the call and sends no response when the client cancels', async () => {
        let aborted = false;
        const client = start(
            (_path, _input, hooks) =>
                new Promise(resolve => {
                    hooks.signal.addEventListener('abort', () => {
                        aborted = true;
                        resolve(ok());
                    });
                }),
        );
        client.send({
            id: 7,
            method: 'tools/call',
            params: { name: 'execute_readonly', arguments: { tool: 'doctor' } },
        });
        await tick();
        client.send({ method: 'notifications/cancelled', params: { requestId: 7 } });
        await tick();
        expect(aborted).toBe(true);
        expect(client.all()).toEqual([]);
        await client.close();
    });

    it('does not start a queued call that was cancelled while it waited', async () => {
        const started: string[] = [];
        const releases: Array<() => void> = [];
        const client = start(async path => {
            started.push(path.join('_'));
            await new Promise<void>(resolve => releases.push(resolve));
            return ok();
        });
        client.send({
            id: 1,
            method: 'tools/call',
            params: { name: 'execute_mutating', arguments: { tool: 'add_codegen' } },
        });
        client.send({
            id: 2,
            method: 'tools/call',
            params: { name: 'execute_destructive', arguments: { tool: 'migrate_revert' } },
        });
        await tick();
        client.send({ method: 'notifications/cancelled', params: { requestId: 2 } });
        await tick();
        releases.shift()?.();
        await client.next();
        await tick();
        expect(started).toEqual(['add_codegen']);
        await client.close();
    });

    it('answers an unknown method with an error', async () => {
        const client = start(async () => ok());
        client.send({ id: 1, method: 'nope' });
        expect((await client.next()).error.code).toBe(-32601);
        await client.close();
    });
});

const READY_STATE: DevServerState = {
    status: 'ready',
    urls: { mcp: 'http://localhost:3000/mcp/admin' },
    startedAt: '2026-11-24T08:00:00.000Z',
    restarts: 0,
    lastError: null,
    pid: 1,
    secret: 'secret',
};

const STORE_TOOLS = [
    {
        name: 'list_zones',
        description: 'List the zones of the store',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true, destructiveHint: false },
        _meta: { 'vendure.io/keywords': ['regions'] },
    },
    {
        name: 'delete_zone',
        description: 'Delete a zone',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
        annotations: { readOnlyHint: false, destructiveHint: true },
    },
];

function adminProxy(options: { running?: () => boolean; calls?: any[]; result?: unknown } = {}) {
    const send: SendToStore = async (_dir, message: any) => {
        if (message.method === 'tools/list') {
            return { status: 200, body: { jsonrpc: '2.0', id: 1, result: { tools: STORE_TOOLS } } };
        }
        options.calls?.push(message.params);
        return { status: 200, body: { jsonrpc: '2.0', id: 1, result: options.result ?? { content: [] } } };
    };
    const running = options.running ?? (() => true);
    return new AdminProxy({
        projectDir: '/project',
        send,
        readState: () => (running() ? READY_STATE : undefined),
        isAlive: () => true,
    });
}

describe('McpServer with the admin tools of the dev server', () => {
    it('announces that its tool list changes', async () => {
        const client = start(async () => ok(), 'discovery', COMMANDS, adminProxy());
        client.send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
        const reply = await client.next();
        expect(reply.result.capabilities.tools.listChanged).toBe(true);
        expect(reply.result.instructions).toContain('admin_*');
        await client.close();
    });

    it('lists the admin tools after the commands in direct mode', async () => {
        const client = start(async () => ok(), 'direct', COMMANDS, adminProxy());
        client.send({ id: 1, method: 'tools/list' });
        const { result } = await client.next();
        expect(result.tools.map((t: any) => t.name)).toEqual([
            'doctor',
            'add_codegen',
            'migrate_revert',
            'admin_list_zones',
            'admin_delete_zone',
        ]);
        expect(result.tools[4].annotations.destructiveHint).toBe(true);
        await client.close();
    });

    it('finds admin tools by keyword in discovery mode', async () => {
        const client = start(async () => ok(), 'discovery', COMMANDS, adminProxy());
        client.send({
            id: 1,
            method: 'tools/call',
            params: { name: 'search_tools', arguments: { query: 'regions' } },
        });
        const { result } = await client.next();
        expect(result.structuredContent.tools).toEqual([
            {
                name: 'admin_list_zones',
                description: 'List the zones of the store',
                behavior: 'readonly',
                inputSchema: STORE_TOOLS[0].inputSchema,
            },
        ]);
        expect(result.structuredContent.adminTools).toBeUndefined();
        await client.close();
    });

    it('says in search results why there are no admin tools, with a fix', async () => {
        const client = start(async () => ok(), 'discovery', COMMANDS, adminProxy({ running: () => false }));
        client.send({
            id: 1,
            method: 'tools/call',
            params: { name: 'search_tools', arguments: { query: 'zones' } },
        });
        const { result } = await client.next();
        expect(result.structuredContent.tools).toEqual([]);
        expect(result.structuredContent.adminTools.error.code).toBe('devserver.not-running');
        expect(result.structuredContent.adminTools.error.fixes[0].path).toEqual(['devserver', 'start']);
        await client.close();
    });

    it('runs an admin tool with the executor of its behavior and passes the result through', async () => {
        const calls: any[] = [];
        const incomplete = {
            structuredContent: { status: 'incomplete', needs: [{ kind: 'consent', digest: 'abc' }] },
            content: [],
        };
        const client = start(
            async () => ok(),
            'discovery',
            COMMANDS,
            adminProxy({ calls, result: incomplete }),
        );
        client.send({
            id: 1,
            method: 'tools/call',
            params: {
                name: 'execute_destructive',
                arguments: { tool: 'admin_delete_zone', input: { id: '2' } },
            },
        });
        const { result } = await client.next();
        expect(result.structuredContent).toEqual(incomplete.structuredContent);
        expect(result.content.at(-1).text).toContain('execute_destructive');
        expect(calls).toEqual([{ name: 'delete_zone', arguments: { id: '2' } }]);
        await client.close();
    });

    it('refuses an admin tool run with the executor of another behavior', async () => {
        const calls: any[] = [];
        const client = start(async () => ok(), 'discovery', COMMANDS, adminProxy({ calls }));
        client.send({
            id: 1,
            method: 'tools/call',
            params: {
                name: 'execute_readonly',
                arguments: { tool: 'admin_delete_zone', input: { id: '2' } },
            },
        });
        const { result } = await client.next();
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('execute_destructive');
        expect(calls).toEqual([]);
        await client.close();
    });

    it('calls an admin tool directly in direct mode', async () => {
        const calls: any[] = [];
        const client = start(async () => ok(), 'direct', COMMANDS, adminProxy({ calls }));
        client.send({ id: 1, method: 'tools/call', params: { name: 'admin_list_zones', arguments: {} } });
        await client.next();
        expect(calls).toEqual([{ name: 'list_zones', arguments: {} }]);
        await client.close();
    });

    it('returns why an admin tool cannot run while the dev server is stopped', async () => {
        const client = start(async () => ok(), 'direct', COMMANDS, adminProxy({ running: () => false }));
        client.send({ id: 1, method: 'tools/call', params: { name: 'admin_list_zones', arguments: {} } });
        const { result } = await client.next();
        expect(result.isError).toBe(true);
        expect(result.structuredContent.error.code).toBe('devserver.not-running');
        await client.close();
    });

    it('reports an unknown admin tool while the dev server is running', async () => {
        const client = start(async () => ok(), 'direct', COMMANDS, adminProxy());
        client.send({ id: 1, method: 'tools/call', params: { name: 'admin_nope', arguments: {} } });
        const { result } = await client.next();
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('Unknown tool "admin_nope"');
        await client.close();
    });

    it('sends tools/list_changed when the dev server starts or stops', async () => {
        let running = false;
        const proxy = adminProxy({ running: () => running });
        const client = start(async () => ok(), 'direct', COMMANDS, proxy);
        running = true;
        proxy.checkForChange();
        expect(await client.next()).toEqual({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
        running = false;
        proxy.checkForChange();
        expect(await client.next()).toEqual({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
        await client.close();
    });

    it('queues a mutating admin call behind the running writes of the project', async () => {
        const order: string[] = [];
        let finishCommand: () => void = () => undefined;
        const runTool: RunTool = path =>
            new Promise(resolve => {
                order.push(`start ${path.join(' ')}`);
                finishCommand = () => {
                    order.push(`end ${path.join(' ')}`);
                    resolve(ok());
                };
            });
        const proxy = adminProxy();
        const original = proxy.call.bind(proxy);
        proxy.call = (name, args, signal) => {
            order.push(`call ${name}`);
            return original(name, args, signal);
        };
        const client = start(runTool, 'direct', COMMANDS, proxy);
        client.send({ id: 1, method: 'tools/call', params: { name: 'add_codegen', arguments: {} } });
        await tick();
        client.send({
            id: 2,
            method: 'tools/call',
            params: { name: 'admin_delete_zone', arguments: { id: '2' } },
        });
        await tick();
        expect(order).toEqual(['start add codegen']);
        finishCommand();
        await client.next();
        await client.next();
        expect(order).toEqual(['start add codegen', 'end add codegen', 'call admin_delete_zone']);
        await client.close();
    });

    it('runs a command whose name starts with admin_ as a command', async () => {
        const calls: string[][] = [];
        const commands = [...COMMANDS, command(['admin_sync'])];
        const client = start(
            async path => {
                calls.push(path);
                return ok();
            },
            'direct',
            commands,
            adminProxy(),
        );
        client.send({ id: 1, method: 'tools/call', params: { name: 'admin_sync', arguments: {} } });
        await client.next();
        expect(calls).toEqual([['admin_sync']]);
        await client.close();
    });

    it('lists a command rather than an admin tool of the same name', async () => {
        const commands = [...COMMANDS, command(['admin_list_zones'])];
        const client = start(async () => ok(), 'direct', commands, adminProxy());
        client.send({ id: 1, method: 'tools/list' });
        const { result } = await client.next();
        const names = result.tools.map((t: any) => t.name);
        expect(names.filter((n: string) => n === 'admin_list_zones')).toHaveLength(1);
        expect(names).toContain('admin_delete_zone');
        await client.close();
    });
});

/** Command changes that a test makes happen. */
function commandChanges() {
    const listeners = new Set<(commands: MergedManifestCommand[]) => void>();
    const changes: CommandChanges & { change(commands: MergedManifestCommand[]): void; watching: boolean } = {
        watching: false,
        onChanged: listener => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        watch: () => {
            changes.watching = true;
        },
        close: () => {
            changes.watching = false;
        },
        change: commands => listeners.forEach(listener => listener(commands)),
    };
    return changes;
}

describe('McpServer when the commands of the project change', () => {
    it('announces that its tool list changes in direct mode only', async () => {
        for (const [mode, listChanged] of [
            ['direct', true],
            ['discovery', false],
        ] as const) {
            const client = start(async () => ok(), mode, COMMANDS, undefined, commandChanges());
            client.send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
            expect((await client.next()).result.capabilities.tools.listChanged).toBe(listChanged);
            await client.close();
        }
    });

    it('sends tools/list_changed in direct mode and lists the new commands', async () => {
        const changes = commandChanges();
        const client = start(async () => ok(), 'direct', COMMANDS, undefined, changes);
        await tick();
        expect(changes.watching).toBe(true);
        changes.change([...COMMANDS, command(['example', 'greet'])]);
        expect(await client.next()).toEqual({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
        client.send({ id: 1, method: 'tools/list' });
        const names = (await client.next()).result.tools.map((tool: any) => tool.name);
        expect(names).toContain('example_greet');
        await client.close();
        expect(changes.watching).toBe(false);
    });

    it('finds and runs the new commands in discovery mode, without a notification', async () => {
        const changes = commandChanges();
        const calls: string[][] = [];
        const client = start(
            async toolPath => {
                calls.push(toolPath);
                return ok();
            },
            'discovery',
            COMMANDS,
            undefined,
            changes,
        );
        await tick();
        changes.change([...COMMANDS, command(['example', 'greet'], { keywords: ['hello'] })]);
        client.send({
            id: 1,
            method: 'tools/call',
            params: { name: 'search_tools', arguments: { query: 'hello' } },
        });
        const search = await client.next();
        expect(search.id).toBe(1);
        expect(search.result.structuredContent.tools.map((tool: any) => tool.name)).toEqual([
            'example_greet',
        ]);
        client.send({
            id: 2,
            method: 'tools/call',
            params: { name: 'execute_readonly', arguments: { tool: 'example_greet' } },
        });
        expect((await client.next()).id).toBe(2);
        expect(calls).toEqual([['example', 'greet']]);
        expect(client.all()).toEqual([]);
        await client.close();
    });
});
