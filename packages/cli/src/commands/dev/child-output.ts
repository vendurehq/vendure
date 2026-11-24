import {
    LOG_LEVEL_NAMES,
    LogLevelName,
    LogLine,
    MCP_ADMIN_ENDPOINT_LOG_PREFIX,
    ReadyEvent,
    StartupErrorEvent,
} from '@vendure/common/lib/log';
import pc from 'picocolors';

import { readFixes } from '../../command-host/format-fix.js';
import { stripAnsi } from '../../shared/strip-ansi.js';

import { DevServerError, DevServerUrls } from './state-file.js';

/** What one line of a child's output is. */
export type ChildOutputLine =
    /** `json` is true when the child wrote the line as a JSON log line. */
    | { kind: 'log'; line: LogLine; json: boolean }
    | { kind: 'startup-error'; event: StartupErrorEvent; line: LogLine }
    | { kind: 'ready'; event: ReadyEvent; line: LogLine };

/**
 * Reads one line of a child's output. A JSON log line written by the `json` format of the
 * `DefaultLogger` is kept as it is. A startup-error event becomes an error line with the event's
 * code. A ready event becomes an info line. Any other line is wrapped as a log line, `info` from
 * stdout and `error` from stderr, so the dev log is always valid JSONL. ANSI colours are removed
 * from the wrapped text.
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
    if (isReadyEvent(parsed)) {
        return {
            kind: 'ready',
            event: parsed,
            line: {
                ts: now().toISOString(),
                level: 'info',
                ctx: 'Ready',
                msg: `The ${parsed.process} is ready`,
                process: processName,
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

function isReadyEvent(value: unknown): value is ReadyEvent {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const event = value as Record<string, unknown>;
    return (
        event.vendure === 'event' &&
        event.event === 'ready' &&
        (event.process === 'server' || event.process === 'worker')
    );
}

/**
 * The URLs named by a ready event: the Admin and Shop APIs, and the Dashboard among the routes that
 * plugins register. Values that are not strings are left out.
 */
export function readyEventUrls(event: ReadyEvent): DevServerUrls {
    const urls: DevServerUrls = {};
    if (typeof event.urls?.admin === 'string') {
        urls.admin = event.urls.admin;
    }
    if (typeof event.urls?.shop === 'string') {
        urls.shop = event.urls.shop;
    }
    for (const route of Array.isArray(event.routes) ? event.routes : []) {
        if (
            typeof route?.label === 'string' &&
            typeof route.url === 'string' &&
            isDashboardLabel(route.label)
        ) {
            urls.dashboard ??= route.url;
        }
    }
    return urls;
}

/**
 * The `lastError` for a startup-error event.
 */
export function startupErrorToDevServerError(event: StartupErrorEvent, processName: string): DevServerError {
    const fix = readFixes(event.fix);
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

// The same as in the `DefaultLogger` of `@vendure/core`.
const DEFAULT_CONTEXT = 'Vendure Server';
const LOCALE_STRING_OPTIONS = {
    year: '2-digit',
    hour: 'numeric',
    minute: 'numeric',
    day: 'numeric',
    month: 'numeric',
} as const;

/**
 * Formats a log line as readable text for the terminal. It keeps in step with `formatTextLine()`
 * in `@vendure/core`, which the CLI cannot import: level, date and time, context and message, with
 * the stack below an error. It also shows the line's error code, which the JSON line carries.
 *
 * The time always shows, because a JSON line always has one, even when the project's
 * `DefaultLogger` was set up with `timestamp: false`.
 */
export function formatLogLineAsText(line: LogLine): string {
    const color = LEVEL_COLORS[line.level] ?? ((text: string) => text);
    const isHighlighted = line.level === 'error' || line.level === 'warn';
    const time = new Date(line.ts);
    const message = line.stack ? `${line.msg}\n${line.stack}` : line.msg;
    return [
        color(line.level),
        Number.isNaN(time.getTime())
            ? undefined
            : pc.gray(`${time.toLocaleString(undefined, LOCALE_STRING_OPTIONS)} -`),
        pc.cyan(`[${line.ctx ?? DEFAULT_CONTEXT}]`),
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
const mcpEndpointPattern = new RegExp(`^${escapeRegExp(MCP_ADMIN_ENDPOINT_LOG_PREFIX)}(https?://\\S+)$`);

/**
 * Whether a line tells that the process is ready: the server is listening, the worker is
 * processing jobs, or the Dashboard's Vite server is serving. For the server and the worker this
 * is the fallback for a `@vendure/core` that does not write the ready event.
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
    if (isDashboardLabel(label)) {
        return { dashboard: url };
    }
    return {};
}

/**
 * Whether a route label of the server's welcome message, such as `Dashboard UI`, names the
 * Dashboard.
 */
function isDashboardLabel(label: string): boolean {
    return label.trim().toLowerCase().startsWith('dashboard');
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
