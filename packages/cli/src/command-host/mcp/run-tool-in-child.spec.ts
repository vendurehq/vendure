import { CommandEvent } from '@vendure/common/lib/command';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runToolInChild } from './run-tool-in-child.js';

/**
 * A stand-in for `vendure`. It reads the input from stdin like the real host, and acts out the
 * behavior that its first argument names.
 */
const FAKE_CLI = `
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const mode = process.argv[2];
const stdin = fs.readFileSync(0, 'utf-8');
const envelope = (extra) => JSON.stringify({ schemaVersion: 1, status: 'ok', notices: [], ...extra }) + '\\n';
if (mode === 'echo') {
    process.stderr.write(JSON.stringify({ vendure: 'event', type: 'progress', message: 'working' }) + '\\n');
    process.stderr.write('library noise\\n');
    process.stderr.write('{"not":"an event"}\\n');
    process.stdout.write(envelope({ output: { input: JSON.parse(stdin), mcp: process.env.VENDURE_CLI_MCP, args: process.argv.slice(3) } }));
} else if (mode === 'ipc-cancel') {
    process.on('message', (message) => {
        if (message.type === 'cancel') {
            process.stdout.write(envelope({ status: 'error', error: { code: 'cli.cancelled', exit: 130, message: 'cancelled' } }));
            process.exit(130);
        }
    });
    process.stderr.write(JSON.stringify({ vendure: 'event', type: 'notice', message: 'ready' }) + '\\n');
    setTimeout(() => {}, 60000);
} else if (mode === 'group') {
    const grandchild = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
    fs.writeFileSync(JSON.parse(stdin).pidFile, String(grandchild.pid));
    process.on('SIGINT', () => setTimeout(() => process.exit(130), 50));
    process.stderr.write(JSON.stringify({ vendure: 'event', type: 'notice', message: 'ready' }) + '\\n');
    setTimeout(() => {}, 60000);
} else if (mode === 'crash') {
    process.stderr.write('Something broke\\n');
    process.exit(2);
}
`;

const posix = process.platform !== 'win32';

describe('runToolInChild', () => {
    let dir: string;
    let cliBin: string;

    beforeAll(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-mcp-child-'));
        cliBin = path.join(dir, 'fake-cli.js');
        fs.writeFileSync(cliBin, FAKE_CLI);
    });

    afterAll(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const run = (
        commandPath: string[],
        input: Record<string, unknown>,
        signal = new AbortController().signal,
        sigintAfterMs?: number,
    ) => {
        const events: CommandEvent[] = [];
        const logs: string[] = [];
        const result = runToolInChild(commandPath, input, {
            cliBin,
            cwd: dir,
            signal,
            sigintAfterMs,
            onEvent: event => events.push(event),
            onLog: line => logs.push(line),
        });
        return { result, events, logs };
    };

    it('runs the command with --json --input -, puts the input on stdin and marks the call as MCP', async () => {
        const { result, events, logs } = run(['echo', 'sub'], { a: 1 });
        const envelope = await result;
        expect(envelope.output).toEqual({
            input: { a: 1 },
            mcp: '1',
            args: ['sub', '--json', '--input', '-'],
        });
        expect(events).toEqual([{ vendure: 'event', type: 'progress', message: 'working' }]);
        expect(logs).toEqual(['library noise', '{"not":"an event"}']);
    });

    it('returns an error envelope when the child ends without a document', async () => {
        const envelope = await run(['crash'], {}).result;
        expect(envelope.status).toBe('error');
        expect(envelope.error).toMatchObject({ code: 'mcp.child-failed' });
        expect(envelope.error?.message).toContain('exit code 2');
        expect(envelope.error?.message).toContain('Something broke');
    });

    it('cancels over IPC, so the child can end on its own terms', async () => {
        const controller = new AbortController();
        const { result, events } = run(['ipc-cancel'], {}, controller.signal);
        await new Promise<void>(resolve => {
            const timer = setInterval(() => {
                if (events.length > 0) {
                    clearInterval(timer);
                    resolve();
                }
            }, 10);
        });
        controller.abort();
        const envelope = await result;
        expect(envelope.error?.code).toBe('cli.cancelled');
    });

    it.skipIf(!posix)('cancels the whole process group, so grandchildren stop too', async () => {
        const pidFile = path.join(dir, 'grandchild.pid');
        const controller = new AbortController();
        const { result, events } = run(['group'], { pidFile }, controller.signal, 100);
        await new Promise<void>(resolve => {
            const timer = setInterval(() => {
                if (events.length > 0) {
                    clearInterval(timer);
                    resolve();
                }
            }, 10);
        });
        const grandchildPid = Number(fs.readFileSync(pidFile, 'utf-8'));
        expect(() => process.kill(grandchildPid, 0)).not.toThrow();
        controller.abort();
        await result;
        await new Promise(resolve => setTimeout(resolve, 200));
        expect(() => process.kill(grandchildPid, 0)).toThrow();
    });
});
