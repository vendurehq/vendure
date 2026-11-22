import {
    CommandContext,
    CommandDefinition,
    isErrorResult,
    isFailedResult,
} from '@vendure/common/lib/command';
import { LOCAL_TRUST_SECRET_ENV_VAR } from '@vendure/common/lib/local-trust';
import { LogLine } from '@vendure/common/lib/log';
import { ChildProcess, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { z } from 'zod';

import { runCommandInHarness } from '../../command-host/__tests__/command-harness.js';
import { createSpawn } from '../../command-host/spawn.js';
import { DEVSERVER_DETACHED_ENV_VAR } from '../dev/dev-run.js';
import {
    DevServerState,
    DevServerStateFile,
    DevServerStatusReport,
    isProcessAlive,
    readDevServerState,
} from '../dev/state-file.js';

import {
    devServerLogsDefinition,
    devServerStartDefinition,
    devServerStatusDefinition,
    devServerStopDefinition,
    devServerWaitDefinition,
} from './devserver.command.js';
import * as schemas from './devserver.schema.js';
import { MAX_LOG_LINES } from './log-reader.js';
import { run as startRun } from './start.js';

// The runs in these tests started now, after this test process did, like a real run.
const NOW = new Date().toISOString();

const DEAD_PID = 2 ** 22 + 12345;
const directories: string[] = [];
const children: ChildProcess[] = [];

afterEach(() => {
    for (const child of children.splice(0)) {
        child.kill('SIGKILL');
    }
    for (const dir of directories.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

function createProject() {
    const projectDir = mkdtempSync(path.join(tmpdir(), 'vendure-cli-devserver-'));
    directories.push(projectDir);
    writeFileSync(
        path.join(projectDir, 'package.json'),
        JSON.stringify({ name: 'shop', dependencies: { '@vendure/core': '4.0.0' } }),
    );
    return projectDir;
}

/** Runs a command through the host with the working directory set to the project. */
async function runInProject(projectDir: string, def: CommandDefinition, input: Record<string, unknown>) {
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(projectDir);
    try {
        return await runCommandInHarness(def, input);
    } finally {
        cwd.mockRestore();
    }
}

function writeState(projectDir: string, state: Partial<DevServerState> = {}) {
    const { secret = 'run-secret', ...rest } = state;
    new DevServerStateFile(projectDir, secret).write({
        status: 'ready',
        urls: { admin: 'http://localhost:3000/admin-api' },
        startedAt: NOW,
        restarts: 0,
        lastError: null,
        pid: process.pid,
        ...rest,
    });
}

function writeLog(projectDir: string, lines: Array<Partial<LogLine>>) {
    const directory = path.join(projectDir, '.vendure', 'logs');
    mkdirSync(directory, { recursive: true });
    const toText = (items: Array<Partial<LogLine>>) =>
        items.map(line => JSON.stringify({ level: 'info', process: 'server', ...line })).join('\n') + '\n';
    // The first line sits in a rotated file, to check that the files are read oldest first.
    writeFileSync(path.join(directory, 'dev.1.jsonl'), toText(lines.slice(0, 1)));
    writeFileSync(path.join(directory, 'dev.jsonl'), toText(lines.slice(1)) + '{"cut off');
}

describe('devserver command schemas', () => {
    it('declares output schemas that match the TypeScript types', () => {
        expectTypeOf<z.infer<typeof schemas.status.output>>().toEqualTypeOf<DevServerStatusReport>();
        expectTypeOf<z.infer<typeof schemas.logs.output>['lines'][number]>().toEqualTypeOf<LogLine>();
    });
});

describe('devserver status', () => {
    it('reports stopped when no run serves the project', async () => {
        const result = await runInProject(createProject(), devServerStatusDefinition, {});

        expect(result.envelope).toMatchObject({
            status: 'ok',
            output: { status: 'stopped', urls: {}, startedAt: null, restarts: 0, lastError: null },
        });
    });

    it('reports the state of a live run without its secret or pid', async () => {
        const projectDir = createProject();
        writeState(projectDir, { status: 'ready', restarts: 2 });

        const result = await runInProject(projectDir, devServerStatusDefinition, {});

        expect(result.envelope.output).toEqual({
            status: 'ready',
            urls: { admin: 'http://localhost:3000/admin-api' },
            startedAt: NOW,
            restarts: 2,
            lastError: null,
        });
        expect(JSON.stringify(result.envelope)).not.toContain('run-secret');
    });

    it('reports stopped when the run that wrote the file is gone', async () => {
        const projectDir = createProject();
        writeState(projectDir, { pid: DEAD_PID });

        const result = await runInProject(projectDir, devServerStatusDefinition, {});

        expect(result.envelope.output).toMatchObject({ status: 'stopped', restarts: 0 });
    });

    it('reports a project directory that is not a Vendure project as a coded error', async () => {
        const emptyDir = mkdtempSync(path.join(tmpdir(), 'vendure-cli-devserver-empty-'));
        directories.push(emptyDir);
        const result = await runInProject(emptyDir, devServerStatusDefinition, {});

        expect(result.envelope.error?.code).toBe('devserver.project-not-found');
    });
});

describe('devserver wait', () => {
    it('returns at once when the run is ready', async () => {
        const projectDir = createProject();
        writeState(projectDir, { status: 'ready' });

        const result = await runInProject(projectDir, devServerWaitDefinition, {
            timeout: 5,
        });

        expect(result.envelope).toMatchObject({ status: 'ok', output: { status: 'ready', timedOut: false } });
        expect(result.exitCode).toBe(0);
    });

    it('returns failed at once, with the diagnostics, when a restart failed', async () => {
        const projectDir = createProject();
        const lastError = {
            process: 'server',
            message: 'The server failed to compile: 1 compile error',
            diagnostics: [{ file: 'src/index.ts', line: 1, column: 7, code: 'TS2322', message: 'Bad' }],
        };
        writeState(projectDir, { status: 'failed', restarts: 1, lastError });
        const started = Date.now();

        const result = await runInProject(projectDir, devServerWaitDefinition, {
            timeout: 30,
        });

        expect(Date.now() - started).toBeLessThan(5000);
        expect(result.envelope).toMatchObject({
            status: 'failed',
            output: { status: 'failed', timedOut: false, lastError },
        });
        expect(result.exitCode).toBe(1);
    });

    it('returns when a starting run becomes ready', async () => {
        const projectDir = createProject();
        writeState(projectDir, { status: 'starting' });
        setTimeout(() => writeState(projectDir, { status: 'ready' }), 400);

        const result = await runInProject(projectDir, devServerWaitDefinition, {
            timeout: 10,
        });

        expect(result.envelope.output).toMatchObject({ status: 'ready', timedOut: false });
    });

    it('returns the current status when the timeout passes', async () => {
        const projectDir = createProject();
        writeState(projectDir, { status: 'restarting' });

        const result = await runInProject(projectDir, devServerWaitDefinition, {
            timeout: 0.3,
        });

        expect(result.envelope).toMatchObject({
            status: 'failed',
            output: { status: 'restarting', timedOut: true },
        });
    });

    it('returns stopped when the state file it saw is deleted, as when the run ends', async () => {
        const projectDir = createProject();
        writeState(projectDir, { status: 'starting', restarts: 2 });
        setTimeout(() => rmSync(path.join(projectDir, '.vendure', 'devserver.json')), 400);
        const started = Date.now();

        const result = await runInProject(projectDir, devServerWaitDefinition, { timeout: 30 });

        expect(Date.now() - started).toBeLessThan(5000);
        expect(result.envelope.output).toMatchObject({ status: 'stopped', restarts: 2, timedOut: false });
    });

    it('waits for the restart an edit causes with afterRestarts', async () => {
        const projectDir = createProject();
        writeState(projectDir, { status: 'ready', restarts: 3 });
        setTimeout(() => writeState(projectDir, { status: 'failed', restarts: 4 }), 400);

        const result = await runInProject(projectDir, devServerWaitDefinition, {
            timeout: 10,
            afterRestarts: 4,
        });

        expect(result.envelope.output).toMatchObject({ status: 'failed', restarts: 4 });
    });

    it('returns stopped after a short grace when no run has written a state file', async () => {
        const started = Date.now();

        const result = await runInProject(createProject(), devServerWaitDefinition, { timeout: 60 });

        expect(Date.now() - started).toBeLessThan(10000);
        expect(result.envelope.output).toMatchObject({ status: 'stopped', timedOut: false });
    }, 20000);

    it('returns stopped at once for a run that is gone', async () => {
        const projectDir = createProject();
        writeState(projectDir, { status: 'starting', pid: DEAD_PID });

        const result = await runInProject(projectDir, devServerWaitDefinition, {
            timeout: 30,
        });

        expect(result.envelope.output).toMatchObject({ status: 'stopped', timedOut: false });
    });
});

describe('devserver logs', () => {
    const lines: Array<Partial<LogLine>> = [
        { ts: '2020-01-01T10:00:00.000Z', level: 'info', msg: 'Bootstrapping' },
        { ts: '2020-01-01T10:01:00.000Z', level: 'warn', msg: 'Slow query', requestId: 'req-1' },
        {
            ts: '2020-01-01T10:02:00.000Z',
            level: 'error',
            msg: 'Job failed',
            requestId: 'req-1',
            process: 'worker',
        },
        { ts: '2020-01-01T10:03:00.000Z', level: 'debug', msg: 'Cache hit', requestId: 'req-2' },
    ];

    async function readLogs(input: Record<string, unknown>) {
        const projectDir = createProject();
        writeLog(projectDir, lines);
        const result = await runInProject(projectDir, devServerLogsDefinition, { ...input });
        return result;
    }

    it('returns every line, oldest first, and skips a line cut off mid-write', async () => {
        const result = await readLogs({});

        expect((result.envelope.output as { lines: LogLine[] }).lines.map(line => line.msg)).toEqual([
            'Bootstrapping',
            'Slow query',
            'Job failed',
            'Cache hit',
        ]);
    });

    it('filters by request, across the server and the worker', async () => {
        const result = await readLogs({ request: 'req-1' });

        expect((result.envelope.output as { lines: LogLine[] }).lines).toEqual([
            { ...lines[1], process: 'server' },
            { ...lines[2], process: 'worker' },
        ]);
    });

    it('filters by minimum severity', async () => {
        const result = await readLogs({ minSeverity: 'warn' });

        expect((result.envelope.output as { lines: LogLine[] }).lines.map(line => line.level)).toEqual([
            'warn',
            'error',
        ]);
    });

    it('filters by an instant or a duration', async () => {
        const byInstant = await readLogs({ since: '2020-01-01T10:01:30Z' });
        expect((byInstant.envelope.output as { lines: LogLine[] }).lines.map(line => line.msg)).toEqual([
            'Job failed',
            'Cache hit',
        ]);

        const byDuration = await readLogs({ since: '15m' });
        expect((byDuration.envelope.output as { lines: LogLine[] }).lines).toEqual([]);
    });

    it('returns the newest lines only, and says how many it left out', async () => {
        const projectDir = createProject();
        const many = Array.from({ length: MAX_LOG_LINES + 5 }, (_, index) => ({
            ts: new Date(Date.UTC(2020, 0, 1, 0, 0, index)).toISOString(),
            level: 'info' as const,
            msg: `line ${index}`,
        }));
        writeLog(projectDir, many);

        const result = await runInProject(projectDir, devServerLogsDefinition, {});
        const output = result.envelope.output as { lines: LogLine[]; omitted: number };

        expect(output.omitted).toBe(5);
        expect(output.lines).toHaveLength(MAX_LOG_LINES);
        expect(output.lines[0].msg).toBe('line 5');
        expect(result.envelope.notices[0].message).toContain('Left out the 5 oldest lines');
    });

    it('refuses a --since value it cannot read', async () => {
        const result = await readLogs({ since: 'yesterday-ish' });

        expect(result.envelope.error?.code).toBe('devserver.invalid-since');
    });
});

describe('devserver stop', () => {
    it('reports that nothing was running', async () => {
        const result = await runInProject(createProject(), devServerStopDefinition, {});

        expect(result.envelope.output).toEqual({ wasRunning: false, stopped: true });
    });

    it('sends SIGTERM to the run and waits until it has exited', async () => {
        const projectDir = createProject();
        const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
        children.push(child);
        // The run's start time is after its process started, as it is for a real run.
        writeState(projectDir, { pid: child.pid, startedAt: new Date().toISOString() });

        const result = await runInProject(projectDir, devServerStopDefinition, {});

        expect(result.envelope.output).toEqual({ wasRunning: true, stopped: true });
        expect(isProcessAlive(child.pid as number)).toBe(false);
        // The process did not delete its state file, so stop did.
        expect(readDevServerState(projectDir)).toBeUndefined();
    });
});

describe('devserver start', () => {
    // Stands in for `vendure dev`: it writes a state file for its own process, records whether it
    // was given a local-trust secret and the detached flag, and deletes the file when it is
    // stopped. It ends in the status named in a `final-status` file, or `ready`.
    const fakeDevScript = `
const fs = require('node:fs');
const path = require('node:path');
const projectDir = process.argv[process.argv.indexOf('--project') + 1];
const file = path.join(projectDir, '.vendure', 'devserver.json');
const write = status => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify({
        status, urls: {}, startedAt: new Date().toISOString(), restarts: 0, lastError: null,
        pid: process.pid, secret: 'fake', target: process.argv[2] === 'dev' ? process.argv[3] : undefined,
        inheritedSecret: process.env.${LOCAL_TRUST_SECRET_ENV_VAR} ?? null,
        detached: process.env.${DEVSERVER_DETACHED_ENV_VAR} ?? null,
    }), { mode: 0o600 });
    fs.renameSync(file + '.tmp', file);
};
write('starting');
const finalStatusFile = path.join(projectDir, 'final-status');
setTimeout(() => write(fs.existsSync(finalStatusFile) ? fs.readFileSync(finalStatusFile, 'utf-8') : 'ready'), 300);
process.on('SIGTERM', () => { fs.rmSync(file, { force: true }); process.exit(0); });
setInterval(() => {}, 1000);
`;

    // What the launcher forwards to the caller's stdout. It must stay empty.
    let forwardedStdout = '';

    function createContext(projectDir: string, mcp = false): CommandContext {
        const controller = new AbortController();
        forwardedStdout = '';
        return {
            cwd: projectDir,
            signal: controller.signal,
            mcp,
            notice: vi.fn(),
            progress: vi.fn(),
            event: vi.fn(),
            spawn: createSpawn(projectDir, controller.signal, text => (forwardedStdout += text)),
        };
    }

    function createFakeCli(projectDir: string) {
        const cliPath = path.join(projectDir, 'fake-cli.cjs');
        writeFileSync(cliPath, fakeDevScript);
        return cliPath;
    }

    function stopFakeRun(projectDir: string) {
        const pid = readDevServerState(projectDir)?.pid;
        if (pid && isProcessAlive(pid)) {
            process.kill(pid, 'SIGKILL');
        }
    }

    it('starts vendure dev in the background, without a secret from the environment, and waits for ready', async () => {
        const projectDir = createProject();
        const cliPath = createFakeCli(projectDir);
        vi.stubEnv(LOCAL_TRUST_SECRET_ENV_VAR, 'from-the-shell');
        try {
            const result = await startRun(
                { target: 'server', wait: true, timeout: 10 },
                createContext(projectDir),
                cliPath,
            );

            // Nothing reaches the person's terminal, or the event lines under --json.
            expect(forwardedStdout).toBe('');

            expect(result).toMatchObject({ status: 'ready' });
            const state = readDevServerState(projectDir) as DevServerState & Record<string, unknown>;
            expect(state.target).toBe('server');
            expect(state.inheritedSecret).toBeNull();
            expect(state.detached).toBe('1');
            expect(state.pid).not.toBe(process.pid);
            expect(isProcessAlive(state.pid)).toBe(true);
        } finally {
            vi.unstubAllEnvs();
            stopFakeRun(projectDir);
        }
    }, 20000);

    it.each([
        ['waits by default for a person or a --json caller', {}, false, 'ready'],
        ['returns once the state file exists by default for an MCP tool call', {}, true, 'starting'],
        ['returns once the state file exists with wait: false', { wait: false }, false, 'starting'],
        ['waits under MCP with wait: true', { wait: true }, true, 'ready'],
    ] as const)(
        '%s',
        async (_name, input, mcp, status) => {
            const projectDir = createProject();
            const cliPath = createFakeCli(projectDir);
            try {
                const result = await startRun(
                    { ...input, timeout: 10 },
                    createContext(projectDir, mcp),
                    cliPath,
                );

                expect(result).toMatchObject({ status });
            } finally {
                stopFakeRun(projectDir);
            }
        },
        20000,
    );

    it('is a failed result when it waited and the run failed', async () => {
        const projectDir = createProject();
        const cliPath = createFakeCli(projectDir);
        writeFileSync(path.join(projectDir, 'final-status'), 'failed');
        try {
            const result = await startRun({ timeout: 10 }, createContext(projectDir), cliPath);

            expect(isFailedResult(result) && result.output).toMatchObject({ status: 'failed' });
        } finally {
            stopFakeRun(projectDir);
        }
    }, 20000);

    it('fails at once, without waiting for the timeout, when the run exits before its state file', async () => {
        const projectDir = createProject();
        const cliPath = path.join(projectDir, 'quiet-exit.cjs');
        writeFileSync(cliPath, 'process.exit(0);');
        const started = Date.now();

        const result = await startRun({ timeout: 30 }, createContext(projectDir), cliPath);

        expect(Date.now() - started).toBeLessThan(10000);
        expect(isErrorResult(result) && result.code).toBe('devserver.start-failed');
    }, 20000);

    it('only offers the targets that start the server, so the run can be waited for and stopped', async () => {
        const result = await runInProject(createProject(), devServerStartDefinition, { target: 'worker' });

        expect(result.envelope.error).toMatchObject({ code: 'input.invalid' });
        expect(result.envelope.error?.message).toContain('target');
    });

    it('refuses to start while another run serves the project', async () => {
        const projectDir = createProject();
        writeState(projectDir, { pid: process.pid });

        const result = await startRun({}, createContext(projectDir), '/nonexistent/cli.js');

        expect(isErrorResult(result) && result.code).toBe('devserver.already-running');
    });

    it('reports the output of a run that exits before it writes its state file', async () => {
        const projectDir = createProject();
        const cliPath = path.join(projectDir, 'crash.cjs');
        writeFileSync(cliPath, 'console.error("Could not find ./src/index.ts"); process.exit(1);');

        const result = await startRun({}, createContext(projectDir), cliPath);

        expect(isErrorResult(result) && result.code).toBe('devserver.start-failed');
        expect(isErrorResult(result) && (result.details as { message: string }).message).toContain(
            'Could not find ./src/index.ts',
        );
    }, 20000);
});
