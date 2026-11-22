import { LOCAL_TRUST_SECRET_ENV_VAR } from '@vendure/common/lib/local-trust';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { readDevServerLogs } from '../devserver/log-reader.js';

import { assertNoOtherDevRun, DevRun } from './dev-run.js';
import { DevServerStateFile, readDevServerState } from './state-file.js';

const directories: string[] = [];
const runs: DevRun[] = [];

afterEach(() => {
    for (const run of runs.splice(0)) {
        run.end();
    }
    for (const dir of directories.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

function createRun(options: { targets?: string[]; writeState?: boolean } = {}) {
    const projectDir = mkdtempSync(path.join(tmpdir(), 'vendure-cli-run-'));
    directories.push(projectDir);
    const print = vi.fn();
    const run = new DevRun({
        projectDir,
        targets: options.targets ?? ['server'],
        writeState: options.writeState ?? true,
        print,
        secret: 'run-secret',
    });
    runs.push(run);
    return { run, projectDir, print };
}

const json = (line: Record<string, unknown>) =>
    JSON.stringify({ ts: '2026-11-22T10:00:00.000Z', level: 'info', ...line });

describe('DevRun', () => {
    it('writes a starting state file with this process as the pid', () => {
        const { projectDir } = createRun();

        expect(readDevServerState(projectDir)).toMatchObject({
            status: 'starting',
            pid: process.pid,
            restarts: 0,
            lastError: null,
            secret: 'run-secret',
        });
    });

    it('gives the secret to the server only, and the json log format to the server and the worker', () => {
        const { run } = createRun({ targets: ['server', 'worker', 'dashboard'] });
        const shell = { PATH: '/usr/bin', [LOCAL_TRUST_SECRET_ENV_VAR]: 'from-the-shell' };

        expect(run.childEnv('server', shell)).toEqual({
            PATH: '/usr/bin',
            VENDURE_PROCESS: 'server',
            VENDURE_LOG_FORMAT: 'json',
            [LOCAL_TRUST_SECRET_ENV_VAR]: 'run-secret',
        });
        expect(run.childEnv('worker', shell)).toEqual({
            PATH: '/usr/bin',
            VENDURE_PROCESS: 'worker',
            VENDURE_LOG_FORMAT: 'json',
        });
        expect(run.childEnv('dashboard', shell)).toEqual({ PATH: '/usr/bin', VENDURE_PROCESS: 'dashboard' });
    });

    it('gives no secret to a server it writes no state file for', () => {
        const { run } = createRun({ writeState: false });

        expect(run.childEnv('server', {})).not.toHaveProperty(LOCAL_TRUST_SECRET_ENV_VAR);
    });

    it('goes from failed with diagnostics to ready when a restart compiles', () => {
        const { run, projectDir, print } = createRun();
        const monitor = run.monitor('server');

        monitor.onSpawn(false);
        monitor.onOutput('stderr', 'TSError: ⨯ Unable to compile TypeScript:');
        monitor.onOutput(
            'stderr',
            "src/index.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.",
        );
        const reason = monitor.onRecoverableExit(1);

        expect(reason).toBe('The server failed to compile: 1 compile error');
        expect(readDevServerState(projectDir)).toMatchObject({
            status: 'failed',
            lastError: {
                process: 'server',
                message: 'The server failed to compile: 1 compile error',
                diagnostics: [
                    {
                        file: 'src/index.ts',
                        line: 1,
                        column: 7,
                        code: 'TS2322',
                        message: "Type 'string' is not assignable to type 'number'.",
                    },
                ],
            },
        });

        monitor.onSpawn(true);
        expect(readDevServerState(projectDir)).toMatchObject({ status: 'restarting', restarts: 1 });

        monitor.onOutput(
            'stdout',
            json({ ctx: 'Vendure Server', msg: 'Shop API:  http://localhost:3000/shop-api' }),
        );
        monitor.onOutput(
            'stdout',
            json({ ctx: 'Vendure Server', msg: 'Vendure server (v4.0.0) now running on port 3000' }),
        );
        expect(readDevServerState(projectDir)).toMatchObject({
            status: 'ready',
            restarts: 1,
            lastError: null,
            urls: { shop: 'http://localhost:3000/shop-api' },
        });
        // The terminal shows JSON lines as text, and other lines as they were written.
        expect(print).toHaveBeenCalledWith('server', 'stderr', 'TSError: ⨯ Unable to compile TypeScript:');
        expect(print.mock.calls.some(([, , text]) => String(text).includes('{'))).toBe(false);
    });

    it('takes lastError from the startup-error event, with its code and fixes', () => {
        const { run, projectDir } = createRun();
        const monitor = run.monitor('server');

        monitor.onSpawn(false);
        monitor.onOutput(
            'stderr',
            JSON.stringify({
                vendure: 'event',
                event: 'startup-error',
                code: 'core.config.invalid-custom-fields',
                message: 'The custom field "foo" is invalid',
                fix: [{ description: 'Rename the field' }],
            }),
        );
        monitor.onRecoverableExit(1);

        expect(readDevServerState(projectDir)?.lastError).toEqual({
            process: 'server',
            code: 'core.config.invalid-custom-fields',
            message: 'The custom field "foo" is invalid',
            fix: [{ description: 'Rename the field' }],
        });
    });

    it('writes every line to .vendure/logs/dev.jsonl with its process', () => {
        const { run, projectDir } = createRun({ targets: ['server', 'worker'] });
        run.monitor('server').onOutput('stdout', json({ msg: 'from the server', requestId: 'req-1' }));
        run.monitor('worker').onOutput('stdout', 'plain text from a library');
        run.end();

        expect(readDevServerLogs(projectDir).map(line => [line.process, line.msg])).toEqual([
            ['server', 'from the server'],
            ['worker', 'plain text from a library'],
        ]);
    });

    it('deletes its state file when it ends, and leaves one another run has written', () => {
        const first = createRun();
        first.run.end();
        expect(readDevServerState(first.projectDir)).toBeUndefined();

        const second = createRun();
        new DevServerStateFile(second.projectDir, 'other-secret').write({
            status: 'ready',
            urls: {},
            startedAt: '2026-11-22T10:00:00.000Z',
            restarts: 0,
            lastError: null,
            pid: process.pid,
        });
        second.run.end();
        expect(readDevServerState(second.projectDir)?.secret).toBe('other-secret');
    });
});

describe('assertNoOtherDevRun()', () => {
    it('refuses while another live process holds the state file', () => {
        const projectDir = mkdtempSync(path.join(tmpdir(), 'vendure-cli-run-'));
        directories.push(projectDir);
        const state = {
            status: 'ready' as const,
            urls: {},
            startedAt: '2026-11-22T10:00:00.000Z',
            restarts: 0,
            lastError: null,
        };
        // The parent process of the test runner is alive and is not this process.
        new DevServerStateFile(projectDir, 's').write({ ...state, pid: process.ppid });
        expect(() => assertNoOtherDevRun(projectDir)).toThrow(`(process ${process.ppid})`);

        new DevServerStateFile(projectDir, 's').write({ ...state, pid: 2 ** 22 + 12345 });
        expect(() => assertNoOtherDevRun(projectDir)).not.toThrow();
    });
});
