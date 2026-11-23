import { CommandContext, failed } from '@vendure/common/lib/command';

import {
    defaultTimeoutSeconds,
    projectResolutionFailure,
    renderStatusReport,
    resolveDevServerStateProject,
    waitForDevServer,
    WaitResult,
} from './devserver.js';

/**
 * Waits until the run serving the project is ready. It returns at once when the run failed, so a
 * restart that fails is reported without waiting for the timeout. Any result other than `ready`
 * is a failed result.
 */
export async function run(
    input: { until?: 'ready'; timeout?: number; afterRestarts?: number },
    ctx: CommandContext,
) {
    let projectDir: string;
    try {
        projectDir = resolveDevServerStateProject(ctx);
    } catch (e) {
        return projectResolutionFailure(e);
    }
    const result = await waitForDevServer(projectDir, {
        timeoutMs: defaultTimeoutSeconds(ctx, input.timeout) * 1000,
        signal: ctx.signal,
        afterRestarts: input.afterRestarts,
    });
    return result.status === 'ready' ? result : failed(result);
}

export function render(result: WaitResult): string {
    const report = renderStatusReport(result);
    return result.timedOut ? `${report}\nTimed out before the server was ready.` : report;
}
