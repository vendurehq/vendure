import { CommandContext, fail } from '@vendure/common/lib/command';
import { LogLevelName, LogLine } from '@vendure/common/lib/log';

import { formatLogLineAsText } from '../dev/child-output.js';

import { devServerErrors, resolveDevServerProject } from './devserver.js';
import { parseSince, readDevServerLogs } from './log-reader.js';

/**
 * Reads the dev log of the project, filtered like `vendure cloud logs`.
 */
export function run(input: LogsInput, ctx: CommandContext) {
    return Promise.resolve(readLogs(input, ctx));
}

interface LogsInput {
    since?: string;
    request?: string;
    minSeverity?: LogLevelName;
}

function readLogs(input: LogsInput, ctx: CommandContext) {
    let projectDir: string;
    try {
        projectDir = resolveDevServerProject(ctx);
    } catch (e) {
        return fail(devServerErrors.projectNotFound, { message: (e as Error).message });
    }
    let since: Date | undefined;
    if (input.since !== undefined) {
        since = parseSince(input.since);
        if (!since) {
            return fail(devServerErrors.invalidSince, { since: input.since });
        }
    }
    const lines = readDevServerLogs(projectDir, {
        since,
        requestId: input.request,
        minSeverity: input.minSeverity,
    });
    return { lines };
}

export function render(output: { lines: LogLine[] }): string {
    return output.lines
        .map(line => `${line.process ? `[${line.process}] ` : ''}${formatLogLineAsText(line)}`)
        .join('\n');
}
