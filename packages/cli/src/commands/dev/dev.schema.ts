import { z } from 'zod';

const inspector = z.union([z.boolean(), z.string()]).optional();

export const input = z.object({
    target: z
        .enum(['all', 'server', 'worker', 'dashboard'])
        .default('all')
        .describe('What to run: all, server, worker or dashboard'),
    dir: z
        .string()
        .optional()
        .describe(
            'The Vendure project directory, resolved against the working directory. Needed when a workspace holds more than one',
        ),
    serverEntry: z
        .string()
        .optional()
        .describe('The TypeScript server entry file that calls bootstrap() (default: ./src/index.ts)'),
    workerEntry: z
        .string()
        .optional()
        .describe(
            'The TypeScript worker entry file that calls bootstrapWorker() (default: ./src/index-worker.ts)',
        ),
    viteConfig: z
        .string()
        .optional()
        .describe('The Vite config file the Dashboard uses (default: Vite config discovery)'),
    inspect: inspector.describe(
        'Enable the Node.js inspector for the server and worker (dev all uses ports 9229 and 9230)',
    ),
    inspectBrk: inspector.describe(
        'Enable the Node.js inspector, and break before user code starts (dev all uses ports 9229 and 9230)',
    ),
    reload: z
        .boolean()
        .default(true)
        .describe('Restart the server and worker when a backend source file changes'),
    reloadIgnoredPaths: z
        .array(z.string())
        .optional()
        .describe(
            'Paths whose changes never restart the server or the worker, resolved against the project directory',
        ),
});

export const output = z.object({
    processExitCode: z
        .number()
        .describe(
            'The exit code the dev processes ended with, such as 130 after Ctrl+C. The CLI itself exits 0 for a stopped run, and 1 for one a process ended with an error',
        ),
    stopped: z.boolean().describe('The run was stopped, by Ctrl+C or a signal, rather than ending by itself'),
});

/** The output and status events `vendure dev` emits while it runs. */
export const events = z.object({
    type: z.literal('output'),
    stream: z.enum(['stdout', 'stderr']),
    text: z
        .string()
        .describe(
            'Output of a process, or a status line, as it came. It can hold ANSI colour codes, because the processes run with FORCE_COLOR',
        ),
});
