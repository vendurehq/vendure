import { LOG_LEVEL_NAMES } from '@vendure/common/lib/log';
import { z } from 'zod';

import { DEV_SERVER_STATUSES } from '../dev/state-file.js';

import { MAX_LOG_LINES } from './log-reader.js';

const timeout = z
    .number()
    .positive()
    .optional()
    .describe('How many seconds to wait. Defaults to 120, or 30 when called as an MCP tool');

const diagnostic = z.object({
    file: z.string(),
    line: z.number(),
    column: z.number().optional(),
    message: z.string(),
    code: z.string().optional().describe('The TypeScript error code, for example TS2322'),
});

const statusReport = z.object({
    status: z.enum(DEV_SERVER_STATUSES),
    urls: z.object({
        admin: z.string().optional(),
        shop: z.string().optional(),
        mcp: z.string().optional(),
        dashboard: z.string().optional(),
    }),
    startedAt: z.string().nullable().describe('When the run started, or null when none has run'),
    restarts: z.number().describe('How many times a file change restarted the processes'),
    lastError: z
        .object({
            process: z.string(),
            code: z.string().optional(),
            message: z.string(),
            diagnostics: z.array(diagnostic).optional(),
            fix: z
                .array(
                    z.object({
                        description: z.string(),
                        path: z
                            .array(z.string())
                            .optional()
                            .describe('The command to run, when the fix is one'),
                        input: z
                            .record(z.string(), z.unknown())
                            .optional()
                            .describe('The input of that command'),
                    }),
                )
                .optional(),
        })
        .nullable()
        .describe('Why the run is failed'),
});

export const logLine = z.object({
    ts: z.string(),
    level: z.enum(LOG_LEVEL_NAMES),
    ctx: z.string().optional(),
    msg: z.string(),
    process: z.string().optional(),
    requestId: z.string().optional(),
    code: z.string().optional(),
    stack: z.string().optional(),
});

export const status = {
    input: z.object({}),
    output: statusReport,
};

export const wait = {
    input: z.object({
        until: z.enum(['ready']).optional().describe('The status to wait for (default: ready)'),
        timeout,
        afterRestarts: z
            .number()
            .int()
            .nonnegative()
            .optional()
            .describe(
                'Count ready or failed only once the run has restarted this many times. Pass the ' +
                    'restarts that status reported before an edit plus 1 to wait for the restart it causes',
            ),
    }),
    output: statusReport.extend({
        timedOut: z.boolean().describe('True when the timeout passed before the run was ready or failed'),
    }),
};

export const logs = {
    input: z.object({
        since: z
            .string()
            .optional()
            .describe('Only lines since a duration ago, such as 15m or 2h, or since an ISO 8601 instant'),
        request: z.string().optional().describe('Only lines of the request with this ID'),
        minSeverity: z
            .enum(LOG_LEVEL_NAMES)
            .optional()
            .describe('Only lines at this level or a more severe one: error, warn, info, verbose, debug'),
    }),
    output: z.object({
        lines: z
            .array(logLine)
            .describe(`The newest ${MAX_LOG_LINES} lines that pass the filters, oldest first`),
        omitted: z.number().describe('How many older lines that pass the filters were left out'),
    }),
};

export const start = {
    input: z.object({
        target: z
            .enum(['all', 'server'])
            .optional()
            .describe('What to run: all, or the server only (default: all)'),
        wait: z
            .boolean()
            .optional()
            .describe(
                'Wait until the run is ready or failed, instead of returning once it has started. ' +
                    'Defaults to true, or false when called as an MCP tool',
            ),
        timeout,
    }),
    output: statusReport,
};

export const stop = {
    input: z.object({}),
    output: z.object({
        wasRunning: z.boolean().describe('False when no run was serving the project'),
        stopped: z.boolean(),
    }),
};
