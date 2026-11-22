import { CommandContext, fail, failed } from '@vendure/common/lib/command';

import { isProcessAlive } from '../dev/state-file.js';

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
    try {
        process.kill(state.pid, 'SIGTERM');
    } catch (e: unknown) {
        if ((e as NodeJS.ErrnoException).code !== 'ESRCH') {
            throw e;
        }
    }
    const deadline = Date.now() + STOP_TIMEOUT_MS;
    while (isProcessAlive(state.pid)) {
        if (Date.now() >= deadline || ctx.signal.aborted) {
            return failed<StopResult>({ wasRunning: true, stopped: false });
        }
        await sleep(POLL_INTERVAL_MS);
    }
    return { wasRunning: true, stopped: true };
}

export function render(result: StopResult): string {
    if (!result.wasRunning) {
        return 'vendure dev was not running.';
    }
    return result.stopped ? 'Stopped vendure dev.' : 'vendure dev did not stop in time.';
}
