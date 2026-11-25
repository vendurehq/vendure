import { CommandContext, fail, failed } from '@vendure/common/lib/command';

import { devErrors } from './dev.errors.js';

import type { DevIo } from './dev.js';

type DevInput = {
    target: 'all' | 'server' | 'worker' | 'dashboard';
    dir?: string;
    serverEntry?: string;
    workerEntry?: string;
    viteConfig?: string;
    inspect?: boolean | string;
    inspectBrk?: boolean | string;
    reload: boolean;
    reloadIgnoredPaths?: string[];
};

/**
 * Runs the dev processes until they end, or until the caller stops the run. Their output and the
 * status lines reach the caller as `output` events, which the host prints for a person as they
 * come, and the run's messages as notices.
 */
export async function run(input: DevInput, ctx: CommandContext) {
    const { runDev } = await import('./dev.js');
    const io: DevIo = {
        write: (stream, text) => ctx.event('output', { stream, text }),
        info: message => ctx.notice('info', message),
        warn: message => ctx.notice('warning', message),
        error: message => ctx.notice('warning', message),
    };
    const { dir, ...options } = input;
    const { startError, ...result } = await runDev(
        input.target,
        { ...options, project: dir },
        { io, signal: ctx.signal },
    );
    if (startError !== undefined) {
        return fail(devErrors.startFailed, { message: startError });
    }
    // A run that a person or a signal stopped ended as it should. One that ended by itself did not.
    return result.exitCode !== 0 && !result.stopped ? failed(result) : result;
}
