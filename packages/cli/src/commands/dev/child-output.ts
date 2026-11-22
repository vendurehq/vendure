import { LOG_LEVEL_NAMES, LogLevelName, LogLine } from '@vendure/common/lib/log';
import pc from 'picocolors';

import { stripAnsi } from '../../shared/strip-ansi.js';

import { DevServerError, DevServerUrls } from './state-file.js';

/**
 * The startup-error event line which `bootstrap()` and `bootstrapWorker()` of `@vendure/core`
 * write to stderr when the server or worker fails to start.
 */
export interface StartupErrorEvent {
    vendure: 'event';
    event: 'startup-error';
    code: string;
    message: string;
    fix: Array<{ description: string }>;
}

/** What one line of a child's output is. */
export type ChildOutputLine =
    /** `json` is true when the child wrote the line as a JSON log line. */
    | { kind: 'log'; line: LogLine; json: boolean }
    | { kind: 'startup-error'; event: StartupErrorEvent; line: LogLine };

/**
 * Reads one line of a child's output. A JSON log line written by the `json` format of the
 * `DefaultLogger` is kept as it is. A startup-error event becomes an error line with the event's
 * code. Any other line is wrapped as a log line, `info` from stdout and `error` from stderr, so the
 * dev log is always valid JSONL. ANSI colours are removed from the wrapped text.
 */
export function readChildOutputLine(
    raw: string,
    stream: 'stdout' | 'stderr',
    processName: string,
    now: () => Date = () => new Date(),
): ChildOutputLine {
    const parsed = raw.startsWith('{') ? parseJson(raw) : undefined;
    if (isStartupErrorEvent(parsed)) {
        return {
            kind: 'startup-error',
            event: parsed,
            line: {
                ts: now().toISOString(),
                level: 'error',
                ctx: 'StartupError',
                msg: parsed.message,
                process: processName,
                code: parsed.code,
            },
        };
    }
    if (isLogLine(parsed)) {
        return { kind: 'log', line: { ...parsed, process: parsed.process ?? processName }, json: true };
    }
    return {
        kind: 'log',
        line: {
            ts: now().toISOString(),
            level: stream === 'stderr' ? 'error' : 'info',
            msg: stripAnsi(raw),
            process: processName,
        },
        json: false,
    };
}

function parseJson(raw: string): unknown {
    try {
        return JSON.parse(raw);
    } catch {
        return undefined;
    }
}

/**
 * Whether a parsed JSON value is a {@link LogLine}: it has a time, a known level and a message.
 */
export function isLogLine(value: unknown): value is LogLine {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const line = value as Record<string, unknown>;
    return (
        typeof line.ts === 'string' &&
        typeof line.msg === 'string' &&
        LOG_LEVEL_NAMES.includes(line.level as LogLevelName)
    );
}

function isStartupErrorEvent(value: unknown): value is StartupErrorEvent {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const event = value as Record<string, unknown>;
    return (
        event.vendure === 'event' &&
        event.event === 'startup-error' &&
        typeof event.code === 'string' &&
        typeof event.message === 'string'
    );
}

/**
 * The `lastError` for a startup-error event.
 */
export function startupErrorToDevServerError(event: StartupErrorEvent, processName: string): DevServerError {
    const fix = Array.isArray(event.fix)
        ? event.fix.filter(f => typeof f?.description === 'string').map(f => ({ description: f.description }))
        : [];
    return {
        process: processName,
        code: event.code,
        message: event.message,
        ...(fix.length ? { fix } : {}),
    };
}

const LEVEL_COLORS: Record<LogLevelName, (text: string) => string> = {
    error: pc.red,
    warn: pc.yellow,
    info: pc.blue,
    verbose: pc.magenta,
    debug: pc.magenta,
};

/**
 * Formats a log line as readable text for the terminal, like the `text` format of the
 * `DefaultLogger`: level, time, context and message, with the stack below an error.
 */
export function formatLogLineAsText(line: LogLine): string {
    const color = LEVEL_COLORS[line.level] ?? ((text: string) => text);
    const isHighlighted = line.level === 'error' || line.level === 'warn';
    const time = new Date(line.ts);
    const message = line.stack ? `${line.msg}\n${line.stack}` : line.msg;
    return [
        color(line.level),
        Number.isNaN(time.getTime()) ? undefined : pc.gray(`${time.toLocaleTimeString()} -`),
        line.ctx ? pc.cyan(`[${line.ctx}]`) : undefined,
        line.code ? pc.gray(`(${line.code})`) : undefined,
        isHighlighted ? color(message) : message,
    ]
        .filter(part => part !== undefined)
        .join(' ');
}

// `Vendure server (v4.0.0) now running on port 3000`, from `bootstrap()`.
const serverReadyPattern = /Vendure server \(v[^)]*\) now running on port \d+/;
// From `bootstrapWorker()`.
const workerReadyPattern = /Vendure Worker is ready/;
// `VITE v6.0.0  ready in 512 ms`, from the Vite dev server.
const dashboardReadyPattern = /\bready in [\d.]+ ?m?s\b/;
// `Shop API:     http://localhost:3000/shop-api`, from the server's welcome message.
const serverUrlPattern = /^([A-Za-z][\w ]*?):\s+(https?:\/\/\S+)$/;
// `➜  Local:   http://localhost:5173/dashboard/`, from the Vite dev server.
const viteLocalUrlPattern = /Local:\s+(https?:\/\/\S+)/;
// `Store MCP admin endpoint: http://localhost:3000/mcp/admin`, which the McpPlugin logs when the
// server starts. The plugin is optional, so the line may never come.
const mcpEndpointPattern = /^Store MCP admin endpoint: (https?:\/\/\S+)$/;
// The line of `=` that closes the server's welcome message, after its URLs.
const welcomeEndPattern = /^=+$/;

/**
 * Whether a line tells that the process is ready: the server is listening, the worker is
 * processing jobs, or the Dashboard's Vite server is serving.
 */
export function isReadyLine(target: string, line: LogLine): boolean {
    switch (target) {
        case 'server':
            return serverReadyPattern.test(line.msg);
        case 'worker':
            return workerReadyPattern.test(line.msg);
        case 'dashboard':
            return dashboardReadyPattern.test(line.msg);
        default:
            return false;
    }
}

/**
 * Whether a line closes the server's welcome message.
 */
export function isWelcomeEndLine(line: LogLine): boolean {
    return welcomeEndPattern.test(line.msg.trim());
}

/**
 * The URLs a line names. The server's welcome message names the Shop API, the Admin API and the
 * routes plugins register, such as `Dashboard UI`, and the McpPlugin logs its admin endpoint. The
 * Dashboard's Vite server names its local URL.
 */
export function readUrls(target: string, line: LogLine): DevServerUrls {
    if (target === 'dashboard') {
        const viteMatch = viteLocalUrlPattern.exec(line.msg);
        return viteMatch ? { dashboard: viteMatch[1] } : {};
    }
    if (target !== 'server') {
        return {};
    }
    const mcpMatch = mcpEndpointPattern.exec(line.msg.trim());
    if (mcpMatch) {
        return { mcp: mcpMatch[1] };
    }
    const match = serverUrlPattern.exec(line.msg.trim());
    if (!match) {
        return {};
    }
    const label = match[1].trim().toLowerCase();
    const url = match[2];
    if (label === 'shop api') {
        return { shop: url };
    }
    if (label === 'admin api') {
        return { admin: url };
    }
    if (label.startsWith('dashboard')) {
        return { dashboard: url };
    }
    return {};
}
