import { CommandEnvelope } from '@vendure/common/lib/command';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { ManifestCommand, MergedManifestCommand } from '../manifest.js';

import { McpServer, McpToolMode, RunTool } from './server.js';

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

function start(runTool: RunTool, mode: McpToolMode = 'discovery', commands = COMMANDS): Client {
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
    const server = new McpServer({ commands, mode, input, output, version: '1.2.3', runTool });
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
