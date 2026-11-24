import { LOCAL_TRUST_SECRET_ENV_VAR } from '@vendure/common/lib/local-trust';
import { INCLUDE_STACK_IN_ERRORS_ENV_VAR } from '@vendure/common/lib/shared-constants';
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { readDevServerLogs } from '../devserver/log-reader.js';

import { DEVSERVER_DETACHED_ENV_VAR, DevRun } from './dev-run.js';
import { DevRunAlreadyRunningError, DevServerStateFile, readDevServerState } from './state-file.js';

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

function createProjectDir() {
    const projectDir = mkdtempSync(path.join(tmpdir(), 'vendure-cli-run-'));
    directories.push(projectDir);
    return projectDir;
}

function createRun(options: { targets?: string[]; writeState?: boolean; projectDir?: string } = {}) {
    const projectDir = options.projectDir ?? createProjectDir();
    const print = vi.fn();
    const warn = vi.fn();
    const run = new DevRun({
        projectDir,
        targets: options.targets ?? ['server'],
        writeState: options.writeState ?? true,
        print,
        warn,
        secret: 'run-secret',
    });
    runs.push(run);
    return { run, projectDir, print, warn };
}

// As `logWelcomeMessage()` in core writes it: a line of `=` both opens and closes it.
const welcome = [
    '===============================================',
    'Vendure server (v4.0.0) now running on port 3000',
    '-----------------------------------------------',
    'Shop API:     http://localhost:3000/shop-api',
    'Admin API:    http://localhost:3000/admin-api',
    '===============================================',
];

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

    it('gives the secret and error stacks to the server only, and the json log format to the server and the worker', () => {
        const { run } = createRun({ targets: ['server', 'worker', 'dashboard'] });
        const shell = { PATH: '/usr/bin', [LOCAL_TRUST_SECRET_ENV_VAR]: 'from-the-shell' };

        expect(run.childEnv('server', shell)).toEqual({
            PATH: '/usr/bin',
            VENDURE_PROCESS: 'server',
            VENDURE_LOG_FORMAT: 'json',
            [INCLUDE_STACK_IN_ERRORS_ENV_VAR]: 'true',
            [LOCAL_TRUST_SECRET_ENV_VAR]: 'run-secret',
        });
        expect(run.childEnv('worker', shell)).toEqual({
            PATH: '/usr/bin',
            VENDURE_PROCESS: 'worker',
            VENDURE_LOG_FORMAT: 'json',
        });
        expect(run.childEnv('dashboard', shell)).toEqual({ PATH: '/usr/bin', VENDURE_PROCESS: 'dashboard' });
    });

    it('keeps the detached flag of devserver start away from the processes', () => {
        const { run } = createRun();

        expect(run.childEnv('server', { [DEVSERVER_DETACHED_ENV_VAR]: '1' })).not.toHaveProperty(
            DEVSERVER_DETACHED_ENV_VAR,
        );
    });

    it('sets failed as soon as a startup error is reported, while the process is still running', () => {
        const { run, projectDir } = createRun();
        const monitor = run.monitor('server');
        monitor.onSpawn(false);
        monitor.onOutput(
            'stderr',
            JSON.stringify({
                vendure: 'event',
                event: 'startup-error',
                code: 'core.unexpected',
                message: 'listen EADDRINUSE: address already in use :::3000',
                fix: [],
            }),
        );

        expect(monitor.hasStartupError()).toBe(true);
        expect(readDevServerState(projectDir)).toMatchObject({
            status: 'failed',
            lastError: { process: 'server', code: 'core.unexpected' },
        });
        monitor.onSpawn(true);
        expect(monitor.hasStartupError()).toBe(false);
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

        for (const msg of welcome) {
            monitor.onOutput('stdout', json({ ctx: 'Vendure Server', msg }));
        }
        expect(readDevServerState(projectDir)).toMatchObject({
            status: 'ready',
            restarts: 1,
            lastError: null,
            urls: { shop: 'http://localhost:3000/shop-api', admin: 'http://localhost:3000/admin-api' },
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

describe('DevRun readiness and URLs', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('marks the server ready only once its welcome message, with the URLs, is complete', () => {
        const { run, projectDir } = createRun();
        const monitor = run.monitor('server');
        monitor.onSpawn(false);

        // The line of `=` that opens the message does not count, nor does the title before the URLs.
        monitor.onOutput('stdout', json({ msg: welcome[0] }));
        monitor.onOutput('stdout', json({ msg: welcome[1] }));
        expect(readDevServerState(projectDir)?.status).toBe('starting');
        for (const msg of welcome.slice(2)) {
            monitor.onOutput('stdout', json({ msg }));
        }

        expect(readDevServerState(projectDir)).toMatchObject({
            status: 'ready',
            urls: { shop: 'http://localhost:3000/shop-api', admin: 'http://localhost:3000/admin-api' },
        });
    });

    it('marks the server ready a second after its "now running" line when the welcome message does not close', () => {
        vi.useFakeTimers();
        const { run, projectDir } = createRun();
        const monitor = run.monitor('server');
        monitor.onSpawn(false);
        monitor.onOutput('stdout', json({ msg: welcome[0] }));
        monitor.onOutput('stdout', json({ msg: welcome[1] }));

        vi.advanceTimersByTime(999);
        expect(readDevServerState(projectDir)?.status).toBe('starting');
        vi.advanceTimersByTime(1);
        expect(readDevServerState(projectDir)?.status).toBe('ready');
    });

    it('takes the Dashboard URL from the server, not from Vite, when the run includes the server', () => {
        const { run, projectDir } = createRun({ targets: ['server', 'dashboard'] });
        run.monitor('dashboard').onOutput('stdout', '  ➜  Local:   http://localhost:5173/dashboard/');
        run.monitor('server').onOutput(
            'stdout',
            json({ msg: 'Dashboard UI: http://localhost:3000/dashboard' }),
        );
        run.monitor('dashboard').onOutput('stdout', '  ➜  Local:   http://localhost:5173/dashboard/');

        expect(readDevServerState(projectDir)?.urls).toEqual({
            dashboard: 'http://localhost:3000/dashboard',
        });
    });

    it('fails instead of running without the state file when it is required', () => {
        const projectDir = createProjectDir();
        writeFileSync(path.join(projectDir, '.vendure'), '');

        expect(
            () =>
                new DevRun({
                    projectDir,
                    targets: ['server'],
                    writeState: true,
                    requireStateFile: true,
                    print: vi.fn(),
                }),
        ).toThrow();
    });

    it('reads the MCP URL from the line the McpPlugin logs', () => {
        const { run, projectDir } = createRun();
        run.monitor('server').onOutput(
            'stdout',
            json({ ctx: 'McpPlugin', msg: 'Store MCP admin endpoint: http://localhost:3000/mcp/admin' }),
        );

        expect(readDevServerState(projectDir)?.urls).toEqual({ mcp: 'http://localhost:3000/mcp/admin' });
    });

    it('reports restarting as soon as a change is seen, before the old process has stopped', () => {
        const { run, projectDir } = createRun();
        const monitor = run.monitor('server');
        monitor.onSpawn(false);
        for (const msg of welcome) {
            monitor.onOutput('stdout', json({ msg }));
        }

        monitor.onChangeDetected();
        expect(readDevServerState(projectDir)).toMatchObject({ status: 'restarting', restarts: 1 });
        monitor.onSpawn(true);
        expect(readDevServerState(projectDir)).toMatchObject({ status: 'restarting', restarts: 1 });
    });
});

describe('DevRun state file ownership', () => {
    it('refuses to start while another live run holds the state file', () => {
        const projectDir = createProjectDir();
        new DevServerStateFile(projectDir, 'other-secret').write({
            status: 'ready',
            urls: {},
            startedAt: new Date().toISOString(),
            restarts: 0,
            lastError: null,
            // The parent process of the test runner is alive and started before now.
            pid: process.ppid,
        });

        expect(() => createRun({ projectDir })).toThrow(DevRunAlreadyRunningError);
        expect(() => createRun({ projectDir })).toThrow(`(process ${process.ppid})`);
    });

    it('writes neither the state file nor the dev log for a run without the server', () => {
        const { run, projectDir } = createRun({ targets: ['dashboard'], writeState: false });
        run.monitor('dashboard').onOutput('stdout', 'VITE ready in 300 ms');
        run.end();

        expect(readdirSync(projectDir)).toEqual([]);
    });

    it('starts without a state file or a secret, with a warning, when the file cannot be created', () => {
        const projectDir = createProjectDir();
        // A file where the .vendure directory should be makes every write fail.
        writeFileSync(path.join(projectDir, '.vendure'), '');
        const { run, warn } = createRun({ projectDir });

        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('Could not create the dev server state file'),
        );
        expect(run.childEnv('server', {})).not.toHaveProperty(LOCAL_TRUST_SECRET_ENV_VAR);
        expect(() => run.monitor('server').onRecoverableExit(1)).not.toThrow();
    });

    // The state file lives in %LOCALAPPDATA% on Windows. Faking the platform is safe here, because
    // the path cannot be built, so nothing touches the file system.
    it('starts without a state file or a secret, with a warning, on Windows without LOCALAPPDATA', () => {
        const platform = Object.getOwnPropertyDescriptor(process, 'platform');
        const localAppData = process.env.LOCALAPPDATA;
        Object.defineProperty(process, 'platform', { value: 'win32' });
        delete process.env.LOCALAPPDATA;
        try {
            const { run, warn, projectDir } = createRun();

            expect(warn).toHaveBeenCalledWith(expect.stringContaining('LOCALAPPDATA is not set'));
            expect(run.childEnv('server', {})).not.toHaveProperty(LOCAL_TRUST_SECRET_ENV_VAR);
            // On the file system, since readDevServerState has no path to read on fake Windows.
            expect(existsSync(path.join(projectDir, '.vendure', 'devserver.json'))).toBe(false);
        } finally {
            if (platform) {
                Object.defineProperty(process, 'platform', platform);
            }
            if (localAppData !== undefined) {
                process.env.LOCALAPPDATA = localAppData;
            }
        }
    });

    it('keeps running and warns once when the state file cannot be written', () => {
        const { run, projectDir, warn } = createRun();
        chmodSync(path.join(projectDir, '.vendure'), 0o500);
        try {
            const monitor = run.monitor('server');
            expect(() => monitor.onRecoverableExit(1)).not.toThrow();
            expect(() => monitor.onSpawn(true)).not.toThrow();

            expect(warn).toHaveBeenCalledTimes(1);
            expect(warn.mock.calls[0][0]).toContain('Could not write the dev server state file');
        } finally {
            chmodSync(path.join(projectDir, '.vendure'), 0o700);
        }
    });
});
