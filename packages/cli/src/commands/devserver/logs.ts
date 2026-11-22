import { CommandContext, fail } from '@vendure/common/lib/command';
import { LogLevelName, LogLine } from '@vendure/common/lib/log';

import { formatLogLineAsText } from '../dev/child-output.js';

import { devServerErrors, resolveDevServerProject } from './devserver.js';
import { MAX_LOG_LINES, parseSince, readDevServerLogs } from './log-reader.js';

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
    const omitted = Math.max(lines.length - MAX_LOG_LINES, 0);
    if (omitted > 0) {
        ctx.notice(
            'info',
            `Left out the ${omitted} oldest lines. Narrow the filters, for example with --since, to see them.`,
        );
    }
    return { lines: lines.slice(omitted), omitted };
}

export function render(output: { lines: LogLine[]; omitted: number }): string {
    const lines = output.lines.map(
        line => `${line.process ? `[${line.process}] ` : ''}${formatLogLineAsText(line)}`,
    );
    if (output.omitted > 0) {
        lines.unshift(`(${output.omitted} older lines left out)`);
    }
    return lines.join('\n');
}
