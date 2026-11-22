import { CommandContext, fail, failed } from '@vendure/common/lib/command';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { DevServerStateFile, isProcessAlive } from '../dev/state-file.js';

import {
    devServerErrors,
    POLL_INTERVAL_MS,
    readLiveDevServerState,
    resolveDevServerProject,
    sleep,
} from './devserver.js';

/** How long to wait for the run to stop. The run gives its processes 5 seconds to shut down. */
const STOP_TIMEOUT_MS = 20_000;

interface StopResult {
    wasRunning: boolean;
    stopped: boolean;
}

/**
 * Stops the run serving the project: sends it SIGTERM and waits until its process has exited.
 * The run then deletes its state file.
 */
export async function run(_input: Record<string, never>, ctx: CommandContext) {
    let projectDir: string;
    try {
        projectDir = resolveDevServerProject(ctx);
    } catch (e) {
        return fail(devServerErrors.projectNotFound, { message: (e as Error).message });
    }
    const state = readLiveDevServerState(projectDir);
    if (!state) {
        return { wasRunning: false, stopped: true };
    }
    ctx.progress(`Stopping vendure dev (process ${state.pid})`);
    signalRun(state.pid);
    const deadline = Date.now() + STOP_TIMEOUT_MS;
    while (isProcessAlive(state.pid)) {
        if (Date.now() >= deadline || ctx.signal.aborted) {
            return failed<StopResult>({ wasRunning: true, stopped: false });
        }
        await sleep(POLL_INTERVAL_MS);
    }
    // The run deletes its state file when it stops. A run killed without that chance, as on
    // Windows, leaves it, so it is removed here while it still holds that run's secret.
    new DevServerStateFile(projectDir, state.secret).remove();
    return { wasRunning: true, stopped: true };
}

/**
 * Asks the run to stop. On POSIX, SIGTERM lets the run stop its processes and clean up. On
 * Windows a signal ends the process at once and leaves its children running, so the whole process
 * tree is ended instead.
 */
function signalRun(pid: number) {
    if (process.platform === 'win32') {
        try {
            // By absolute path, so that no directory on the PATH can stand in for it.
            const taskkill = path.win32.join(
                process.env.SystemRoot ?? 'C:\\Windows',
                'System32',
                'taskkill.exe',
            );
            execFileSync(taskkill, ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore' });
        } catch {
            // The process has already exited.
        }
        return;
    }
    try {
        process.kill(pid, 'SIGTERM');
    } catch (e: unknown) {
        if ((e as NodeJS.ErrnoException).code !== 'ESRCH') {
            throw e;
        }
    }
}

export function render(result: StopResult): string {
    if (!result.wasRunning) {
        return 'vendure dev was not running.';
    }
    return result.stopped ? 'Stopped vendure dev.' : 'vendure dev did not stop in time.';
}
