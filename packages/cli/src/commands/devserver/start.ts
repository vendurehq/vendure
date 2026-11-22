import { CommandContext, fail, failed } from '@vendure/common/lib/command';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEVSERVER_DETACHED_ENV_VAR } from '../dev/dev-run.js';
import { DEV_LOG_DIRECTORY } from '../dev/log-writer.js';
import {
    DevServerStatusReport,
    isProcessAlive,
    readDevServerState,
    toStatusReport,
} from '../dev/state-file.js';

import {
    defaultTimeoutSeconds,
    devServerErrors,
    POLL_INTERVAL_MS,
    readLiveDevServerState,
    renderStatusReport,
    resolveDevServerProject,
    sleep,
    waitForDevServer,
} from './devserver.js';

/** The file the terminal output of a run started by `devserver start` goes to. */
export const DEVSERVER_START_LOG_FILE_NAME = 'devserver.log';
/** How long the run has to write its state file after it was started. */
const STATE_FILE_TIMEOUT_MS = 30_000;
const START_LOG_TAIL_LINES = 20;

/**
 * A script for `node -e` which starts `vendure dev` detached from the caller, with its terminal
 * output in a file, writes the run's process ID to a file, and exits. `ctx.spawn` waits for this
 * script only, so the run outlives the command. The script prints nothing, so nothing reaches the
 * caller's terminal or the event lines of `--json`.
 *
 * Commands start processes through `ctx.spawn` only, which waits for its process to exit. That is
 * why the detached run is started by this short-lived script, and not by the command itself.
 *
 * Arguments: the output file, the pid file, the working directory, then the arguments of `node`.
 */
const LAUNCH_SCRIPT = `
const { spawn } = require('node:child_process');
const { openSync, writeFileSync } = require('node:fs');
const [outputFile, pidFile, cwd, ...args] = process.argv.slice(1);
const output = openSync(outputFile, 'w', 0o600);
const env = { ...process.env, ${DEVSERVER_DETACHED_ENV_VAR}: '1' };
const child = spawn(process.execPath, args, { cwd, env, detached: true, stdio: ['ignore', output, output], windowsHide: true });
child.unref();
writeFileSync(pidFile, String(child.pid), { mode: 0o600 });
`;

export interface StartInput {
    /**
     * Only runs that start the server write the state file, so `worker` and `dashboard` are not
     * offered: a run without the state file could not be waited for or stopped.
     */
    target?: 'all' | 'server';
    wait?: boolean;
    timeout?: number;
}

/** The path of the CLI entry point, which the detached run is started with. */
export function getCliEntryPath(): string {
    return fileURLToPath(new URL('../../cli.js', import.meta.url));
}

/**
 * Starts `vendure dev` in the background, and returns once it has written its state file. With
 * `wait`, it then waits until the run is ready or failed. `wait` defaults to true, and to false
 * for an MCP tool call, which should not block for a whole start. It refuses to start while another
 * run serves the project.
 */
export async function run(input: StartInput, ctx: CommandContext, cliEntryPath = getCliEntryPath()) {
    let projectDir: string;
    try {
        projectDir = resolveDevServerProject(ctx);
    } catch (e) {
        return fail(devServerErrors.projectNotFound, { message: (e as Error).message });
    }
    const running = readLiveDevServerState(projectDir);
    if (running) {
        return fail(devServerErrors.alreadyRunning, { pid: running.pid });
    }

    const outputFile = path.join(projectDir, DEV_LOG_DIRECTORY, DEVSERVER_START_LOG_FILE_NAME);
    mkdirSync(path.dirname(outputFile), { recursive: true });
    const devArgs = [cliEntryPath, 'dev', input.target ?? 'all', '--project', projectDir];
    ctx.progress('Starting vendure dev');
    // `ctx.spawn` removes a local-trust secret inherited from the shell, and the detached run
    // inherits the launcher's environment.
    const pidFile = path.join(path.dirname(outputFile), `devserver-start.${process.pid}.pid`);
    const launch = await ctx.spawn(
        process.execPath,
        ['-e', LAUNCH_SCRIPT, outputFile, pidFile, projectDir, ...devArgs],
        {
            cwd: projectDir,
        },
    );
    const pid = readLaunchedPid(pidFile);
    if (launch.exitCode !== 0 || pid === undefined) {
        return fail(devServerErrors.startFailed, {
            message: launch.stderr.trim() || `the launcher exited with code ${String(launch.exitCode)}`,
        });
    }

    const deadline = Date.now() + STATE_FILE_TIMEOUT_MS;
    while (readDevServerState(projectDir)?.pid !== pid) {
        if (!isProcessAlive(pid)) {
            return fail(devServerErrors.startFailed, { message: describeEarlyExit(outputFile) });
        }
        if (Date.now() >= deadline || ctx.signal.aborted) {
            return fail(devServerErrors.startFailed, {
                message: 'it did not write its state file in time. See .vendure/logs/devserver.log',
            });
        }
        await sleep(POLL_INTERVAL_MS);
    }

    if (!(input.wait ?? !ctx.mcp)) {
        return toStatusReport(readDevServerState(projectDir));
    }
    const { timedOut, ...report } = await waitForDevServer(projectDir, {
        timeoutMs: defaultTimeoutSeconds(ctx, input.timeout) * 1000,
        signal: ctx.signal,
        pid,
    });
    if (timedOut) {
        ctx.notice('warning', 'vendure dev started, but was not ready before the timeout.');
    }
    // As for `vendure devserver wait`, a run that is not ready is a failed result.
    return report.status === 'ready' ? report : failed(report);
}

function readLaunchedPid(pidFile: string): number | undefined {
    try {
        const pid = Number(readFileSync(pidFile, 'utf-8').trim());
        return Number.isInteger(pid) && pid > 0 ? pid : undefined;
    } catch {
        return undefined;
    } finally {
        rmSync(pidFile, { force: true });
    }
}

function describeEarlyExit(outputFile: string): string {
    let output = '';
    try {
        output = readFileSync(outputFile, 'utf-8');
    } catch {
        // No output to show.
    }
    const tail = output.trim().split('\n').slice(-START_LOG_TAIL_LINES).join('\n');
    return tail
        ? `it exited before it wrote its state file:\n${tail}`
        : 'it exited before it wrote its state file.';
}

export function render(report: DevServerStatusReport): string {
    const hint =
        report.status === 'starting' || report.status === 'restarting'
            ? '\nRun "vendure devserver wait" to wait until it is ready.'
            : '';
    return `${renderStatusReport(report)}${hint}`;
}
