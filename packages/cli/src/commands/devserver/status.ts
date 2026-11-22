import { CommandContext, fail } from '@vendure/common/lib/command';

import { DevServerStatusReport, readDevServerState, toStatusReport } from '../dev/state-file.js';

import { devServerErrors, renderStatusReport, resolveDevServerProject } from './devserver.js';

/**
 * Reports the state of the run serving the project. A run whose process is gone reports
 * `stopped`. The secret is never in the output.
 */
export function run(_input: Record<string, never>, ctx: CommandContext) {
    let projectDir: string;
    try {
        projectDir = resolveDevServerProject(ctx);
    } catch (e) {
        return Promise.resolve(fail(devServerErrors.projectNotFound, { message: (e as Error).message }));
    }
    return Promise.resolve(toStatusReport(readDevServerState(projectDir)));
}

export function render(report: DevServerStatusReport): string {
    return renderStatusReport(report);
}
