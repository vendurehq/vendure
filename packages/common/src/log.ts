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
