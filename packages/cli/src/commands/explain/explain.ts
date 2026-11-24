import { CommandContext, fail } from '@vendure/common/lib/command';
import { LogLine } from '@vendure/common/lib/log';
import pc from 'picocolors';

import { devServerErrors, resolveDevServerProject } from '../devserver/devserver.js';
import { formatDevLogLine, MAX_LOG_LINES, readDevServerLogs } from '../devserver/log-reader.js';

export interface ExplainInput {
    requestId: string;
}

/** The coded error of a request, as `vendure explain` reports it. */
export interface ExplainError {
    /** The namespaced code, for example `core.entity-with-id-not-found`. */
    code: string;
    /**
     * The message as the server logged it. For a core error it is the coarse code and the message
     * key, for example `FORBIDDEN: error.forbidden`: the server logs it before it is translated.
     */
    message: string;
    /** The values for the placeholders of the message key, when the server logged them. */
    variables?: Record<string, unknown>;
    stack?: string;
    process?: string;
    ts: string;
}

export interface ExplainOutput {
    requestId: string;
    found: boolean;
    error: ExplainError | null;
    logs: LogLine[];
    omitted: number;
}

/**
 * Collects the error of one request from the dev log, with its stack and every line of the request.
 * It adds no explanation of its own: the code, the message and the lines are the answer.
 */
export function run(input: ExplainInput, ctx: CommandContext) {
    let projectDir: string;
    try {
        projectDir = resolveDevServerProject(ctx);
    } catch (e) {
        return Promise.resolve(fail(devServerErrors.projectNotFound, { message: (e as Error).message }));
    }
    return Promise.resolve(explainRequest(projectDir, input.requestId));
}

export function explainRequest(projectDir: string, requestId: string): ExplainOutput {
    const lines = readDevServerLogs(projectDir, { requestId });
    const omitted = Math.max(lines.length - MAX_LOG_LINES, 0);
    return {
        requestId,
        found: lines.length > 0,
        error: findRequestError(lines),
        logs: lines.slice(omitted),
        omitted,
    };
}

/**
 * The error of a request: its first error line that has a code, or failing that its first warning
 * that has one. Core logs a thrown `I18nError` at the level the error declares, which is `warn`
 * for most client errors.
 */
export function findRequestError(lines: LogLine[]): ExplainError | null {
    const line =
        lines.find(l => l.level === 'error' && l.code) ?? lines.find(l => l.level === 'warn' && l.code);
    if (!line?.code) {
        return null;
    }
    const { message, variables } = readLoggedMessage(line.msg);
    return {
        code: line.code,
        message,
        ...(variables ? { variables } : {}),
        ...(line.stack ? { stack: line.stack } : {}),
        ...(line.process ? { process: line.process } : {}),
        ts: line.ts,
    };
}

/**
 * Core logs an error-level `I18nError` as JSON, `{"message": ..., "variables": {...}}`, so that the
 * variables of the message are not lost. Any other message is returned as it is.
 */
function readLoggedMessage(msg: string): { message: string; variables?: Record<string, unknown> } {
    if (!msg.trimStart().startsWith('{')) {
        return { message: msg };
    }
    try {
        const parsed = JSON.parse(msg);
        if (typeof parsed?.message === 'string') {
            const variables =
                typeof parsed.variables === 'object' &&
                parsed.variables !== null &&
                Object.keys(parsed.variables).length > 0
                    ? (parsed.variables as Record<string, unknown>)
                    : undefined;
            return variables ? { message: parsed.message, variables } : { message: parsed.message };
        }
    } catch {
        // Not JSON: the message as it is.
    }
    return { message: msg };
}

export function render(output: ExplainOutput): string {
    if (!output.found) {
        return `No line of the dev log (.vendure/logs/dev.jsonl) has the request ID ${output.requestId}.`;
    }
    const lines: string[] = [];
    if (output.error) {
        lines.push(`${pc.red('error')} ${pc.gray(`(${output.error.code})`)} ${output.error.message}`);
        if (output.error.variables) {
            lines.push(pc.gray(`variables: ${JSON.stringify(output.error.variables)}`));
        }
        // The stack shows below the error's own line in the log lines.
    } else {
        lines.push(`No coded error or warning was logged for request ${output.requestId}.`);
    }
    lines.push('', pc.bold(`Log lines of request ${output.requestId}:`));
    if (output.omitted > 0) {
        lines.push(pc.gray(`(${output.omitted} older lines left out)`));
    }
    for (const line of output.logs) {
        lines.push(formatDevLogLine(line));
    }
    return lines.join('\n');
}
