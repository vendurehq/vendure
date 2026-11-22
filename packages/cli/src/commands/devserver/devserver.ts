import { CommandContext, defineError } from '@vendure/common/lib/command';
import pc from 'picocolors';

import { resolveCoreProjectDirectory } from '../../utilities/monorepo-utils.js';
import {
    DevServerState,
    DevServerStatusReport,
    isDevRunAlive,
    readDevServerState,
    toStatusReport,
} from '../dev/state-file.js';

/** How often the state file is read while waiting. */
export const POLL_INTERVAL_MS = 250;
const DEFAULT_TIMEOUT_SECONDS = 120;
const DEFAULT_MCP_TIMEOUT_SECONDS = 30;

export const devServerErrors = {
    alreadyRunning: defineError<{ pid: number }>({
        code: 'devserver.already-running',
        exit: 1,
        message: ({ pid }) => `vendure dev is already running for this project (process ${pid}).`,
        fix: () => [
            { path: ['devserver', 'status'], input: {}, description: 'See the status of the running server' },
            { path: ['devserver', 'stop'], input: {}, description: 'Stop the running server' },
        ],
    }),
    startFailed: defineError<{ message: string }>({
        code: 'devserver.start-failed',
        exit: 1,
        message: ({ message }) => `vendure dev did not start: ${message}`,
    }),
    invalidSince: defineError<{ since: string }>({
        code: 'devserver.invalid-since',
        exit: 2,
        message: ({ since }) =>
            `"${since}" is not a duration such as 15m or 2h, or an ISO 8601 instant such as 2026-11-20T10:00:00Z.`,
    }),
    projectNotFound: defineError<{ message: string }>({
        code: 'devserver.project-not-found',
        exit: 1,
        message: ({ message }) => message,
    }),
};

/**
 * The project directory of a `devserver` command, found from the working directory the same way
 * as `vendure dev` finds it: the directory itself, or the one Vendure project of a workspace.
 */
export function resolveDevServerProject(ctx: CommandContext): string {
    return resolveCoreProjectDirectory(ctx.cwd);
}

export function defaultTimeoutSeconds(ctx: CommandContext, timeout?: number): number {
    return timeout ?? (ctx.mcp ? DEFAULT_MCP_TIMEOUT_SECONDS : DEFAULT_TIMEOUT_SECONDS);
}

/** The state of the run serving the project, or `undefined` when no live run is. */
export function readLiveDevServerState(projectDir: string): DevServerState | undefined {
    const state = readDevServerState(projectDir);
    return state && isDevRunAlive(state) ? state : undefined;
}

export interface WaitResult extends DevServerStatusReport {
    timedOut: boolean;
}

/**
 * Reads the state file until the run is ready, until it failed, or until the timeout passes.
 *
 * It does not return early while there is no state file, because a run that was just started
 * has not written one yet. It does return when the file names a run that is no longer running.
 */
export async function waitForDevServer(
    projectDir: string,
    options: { timeoutMs: number; signal?: AbortSignal; pollIntervalMs?: number },
): Promise<WaitResult> {
    const deadline = Date.now() + options.timeoutMs;
    for (;;) {
        const state = readDevServerState(projectDir);
        const report = toStatusReport(state);
        if (
            report.status === 'ready' ||
            report.status === 'failed' ||
            (state && report.status === 'stopped')
        ) {
            return { ...report, timedOut: false };
        }
        if (Date.now() >= deadline || options.signal?.aborted) {
            return { ...report, timedOut: Date.now() >= deadline };
        }
        await sleep(Math.min(options.pollIntervalMs ?? POLL_INTERVAL_MS, Math.max(deadline - Date.now(), 0)));
    }
}

export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const statusColors: Record<string, (text: string) => string> = {
    ready: pc.green,
    failed: pc.red,
    starting: pc.yellow,
    restarting: pc.yellow,
    stopped: pc.gray,
};

/** The readable form of a status report. */
export function renderStatusReport(report: DevServerStatusReport): string {
    const lines = [`Status:   ${(statusColors[report.status] ?? pc.white)(report.status)}`];
    if (report.startedAt) {
        lines.push(`Started:  ${new Date(report.startedAt).toLocaleString()}`);
    }
    lines.push(`Restarts: ${report.restarts}`);
    const urls = Object.entries(report.urls).filter(([, url]) => url);
    if (urls.length) {
        lines.push('URLs:');
        for (const [name, url] of urls) {
            lines.push(`  ${`${name}:`.padEnd(11)}${url}`);
        }
    }
    const error = report.lastError;
    if (error) {
        lines.push(
            `Error:    ${pc.red(error.message)}${error.code ? pc.gray(` (${error.code})`) : ''} [${error.process}]`,
        );
        for (const diagnostic of error.diagnostics ?? []) {
            const location = `${diagnostic.file}:${diagnostic.line}${diagnostic.column ? `:${diagnostic.column}` : ''}`;
            lines.push(
                `  ${pc.cyan(location)} ${diagnostic.code ? pc.gray(`${diagnostic.code} `) : ''}${diagnostic.message}`,
            );
        }
        for (const fix of error.fix ?? []) {
            lines.push(`  ${pc.green('fix:')} ${fix.description}`);
        }
    }
    return lines.join('\n');
}
