import { CommandContext } from '@vendure/common/lib/command';

import { DevServerStatusReport, readDevServerState, toStatusReport } from '../dev/state-file.js';

import { projectResolutionFailure, renderStatusReport, resolveDevServerStateProject } from './devserver.js';

/**
 * Reports the state of the run serving the project. A run whose process is gone reports
 * `stopped`. The secret is never in the output.
 */
export function run(_input: Record<string, never>, ctx: CommandContext) {
    let projectDir: string;
    try {
        projectDir = resolveDevServerStateProject(ctx);
    } catch (e) {
        return Promise.resolve(projectResolutionFailure(e));
    }
    return Promise.resolve(toStatusReport(readDevServerState(projectDir)));
}

export function render(report: DevServerStatusReport): string {
    return renderStatusReport(report);
}
