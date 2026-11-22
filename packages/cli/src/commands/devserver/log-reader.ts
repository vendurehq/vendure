import { LOG_LEVEL_NAMES, LogLevelName, LogLine } from '@vendure/common/lib/log';
import { readFileSync } from 'node:fs';

import { isLogLine } from '../dev/child-output.js';
import { getDevLogFilePaths } from '../dev/log-writer.js';

/** The most lines `vendure devserver logs` returns. Older lines are left out. */
export const MAX_LOG_LINES = 1000;

export interface DevLogFilter {
    /** Only lines written at or after this time. */
    since?: Date;
    /** Only lines written during this request, or while a worker processed a job it added. */
    requestId?: string;
    /** Only lines at this level or a more severe one. */
    minSeverity?: LogLevelName;
}

/**
 * Reads the dev log of a project, `.vendure/logs/dev.jsonl` and its rotated files, oldest line
 * first, and returns the lines that pass the filter. A line that is not a log line is skipped.
 *
 * Every command that reads the dev log, such as `vendure devserver logs`, reads it through this
 * function.
 */
export function readDevServerLogs(projectDir: string, filter: DevLogFilter = {}): LogLine[] {
    const sinceTime = filter.since?.getTime();
    const maxSeverity = filter.minSeverity ? LOG_LEVEL_NAMES.indexOf(filter.minSeverity) : undefined;
    const lines: LogLine[] = [];
    for (const filePath of getDevLogFilePaths(projectDir)) {
        let text: string;
        try {
            text = readFileSync(filePath, 'utf-8');
        } catch {
            continue;
        }
        for (const raw of text.split('\n')) {
            const line = parseLogLine(raw);
            if (!line) {
                continue;
            }
            if (sinceTime !== undefined && !(Date.parse(line.ts) >= sinceTime)) {
                continue;
            }
            if (filter.requestId !== undefined && line.requestId !== filter.requestId) {
                continue;
            }
            if (maxSeverity !== undefined && LOG_LEVEL_NAMES.indexOf(line.level) > maxSeverity) {
                continue;
            }
            lines.push(line);
        }
    }
    return lines;
}

function parseLogLine(raw: string): LogLine | undefined {
    if (!raw.startsWith('{')) {
        return undefined;
    }
    try {
        const value: unknown = JSON.parse(raw);
        return isLogLine(value) ? value : undefined;
    } catch {
        // A line cut off by a crash mid-write is not a log line.
        return undefined;
    }
}

const durationUnits: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
};

/**
 * Reads a `--since` value: a duration back from now, such as `30s`, `15m`, `2h` or `1d`, or an
 * instant, such as `2026-11-20T10:00:00Z`. Returns `undefined` for anything else.
 */
export function parseSince(value: string, now: Date = new Date()): Date | undefined {
    const trimmed = value.trim();
    const duration = /^(\d+(?:\.\d+)?)\s*([smhd])$/i.exec(trimmed);
    if (duration) {
        return new Date(now.getTime() - Number(duration[1]) * durationUnits[duration[2].toLowerCase()]);
    }
    // A bare number is ambiguous between a duration and a timestamp, so it is refused.
    if (/^\d+$/.test(trimmed)) {
        return undefined;
    }
    const instant = Date.parse(trimmed);
    return Number.isNaN(instant) ? undefined : new Date(instant);
}
