/**
 * The names of the log levels, from the most severe to the least severe.
 */
export const LOG_LEVEL_NAMES = ['error', 'warn', 'info', 'verbose', 'debug'] as const;

/**
 * The name of a log level, as written in the `level` field of a {@link LogLine}.
 */
export type LogLevelName = (typeof LOG_LEVEL_NAMES)[number];

/**
 * One structured log line, as written by the JSON format of the `DefaultLogger` of
 * `@vendure/core`. Each line of a JSON log is one `LogLine` object.
 *
 * Optional fields are left out of the line when they have no value.
 */
export interface LogLine {
    /**
     * The time the line was written, as an ISO 8601 string in UTC.
     */
    ts: string;
    level: LogLevelName;
    /**
     * The context of the line, usually the name of the class or plugin which wrote it.
     */
    ctx?: string;
    msg: string;
    /**
     * The name of the process which wrote the line, for example `server` or `worker`.
     */
    process?: string;
    /**
     * The ID of the API request during which the line was written. A line written while a
     * worker processes a job carries the ID of the request which added the job.
     */
    requestId?: string;
    /**
     * The code of the error which the line reports.
     */
    code?: string;
    stack?: string;
}

/**
 * The line which `bootstrap()` and `bootstrapWorker()` of `@vendure/core` write to stderr, as one
 * line of JSON, when the server or worker fails to start. A supervising process such as
 * `vendure dev` reads the code and the fixes from it.
 */
export interface StartupErrorEvent {
    vendure: 'event';
    event: 'startup-error';
    /** The namespaced code of the error, for example `core.config.invalid-custom-fields`. */
    code: string;
    message: string;
    /** Ways to fix the error. */
    fix: Array<{ description: string }>;
}

/**
 * The start of the line which the McpPlugin logs when the server starts, followed by the URL of
 * its admin endpoint, for example `Store MCP admin endpoint: http://localhost:3000/mcp/admin`.
 * `vendure dev` reads the URL from this line.
 */
export const MCP_ADMIN_ENDPOINT_LOG_PREFIX = 'Store MCP admin endpoint: ';
