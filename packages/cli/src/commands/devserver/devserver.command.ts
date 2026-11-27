import { defineCommand } from '@vendure/common/lib/command';

import { devServerErrors } from './devserver.js';

const keywords = ['dev', 'server', 'supervisor', 'local'];

export const devServerStatusDefinition = defineCommand({
    path: ['devserver', 'status'],
    description: 'Show the status, URLs and last error of the vendure dev run serving this project',
    keywords: [...keywords, 'health', 'running', 'urls'],
    behavior: 'readonly',
    schemas: async () => (await import('./devserver.schema.js')).status,
    errors: [devServerErrors.projectNotFound, devServerErrors.stateFileUnavailable],
    examples: ['vendure devserver status', 'vendure devserver status --json'],
    run: () => import('./status.js'),
    render: () => import('./status.js'),
});

export const devServerWaitDefinition = defineCommand({
    path: ['devserver', 'wait'],
    description: 'Wait until the vendure dev run is ready. Returns at once when it failed',
    keywords: [...keywords, 'ready', 'restart', 'compile'],
    behavior: 'readonly',
    schemas: async () => (await import('./devserver.schema.js')).wait,
    errors: [devServerErrors.projectNotFound, devServerErrors.stateFileUnavailable],
    examples: ['vendure devserver wait --until ready --timeout 60 --json'],
    run: () => import('./wait.js'),
    render: () => import('./wait.js'),
});

export const devServerLogsDefinition = defineCommand({
    path: ['devserver', 'logs'],
    description: 'Read the logs of the vendure dev run, filtered by time, request ID or severity',
    keywords: [...keywords, 'log', 'request', 'error', 'debug'],
    behavior: 'readonly',
    schemas: async () => (await import('./devserver.schema.js')).logs,
    errors: [devServerErrors.projectNotFound, devServerErrors.invalidSince],
    examples: [
        'vendure devserver logs --since 15m --min-severity warn',
        'vendure devserver logs --request 2b0c6c2e-5f6a-4a0e-9d1b-7f0d3c1e8a42 --json',
    ],
    run: () => import('./logs.js'),
    render: () => import('./logs.js'),
});

export const devServerStartDefinition = defineCommand({
    path: ['devserver', 'start'],
    description: 'Start vendure dev in the background for this project',
    keywords: [...keywords, 'run', 'launch', 'background'],
    behavior: 'mutating',
    schemas: async () => (await import('./devserver.schema.js')).start,
    cli: { positional: ['target'] },
    errors: [
        devServerErrors.projectNotFound,
        devServerErrors.stateFileUnavailable,
        devServerErrors.alreadyRunning,
        devServerErrors.startFailed,
    ],
    examples: ['vendure devserver start', 'vendure devserver start server --timeout 60'],
    run: () => import('./start.js'),
    render: () => import('./start.js'),
});

export const devServerStopDefinition = defineCommand({
    path: ['devserver', 'stop'],
    description: 'Stop the vendure dev run serving this project',
    keywords: [...keywords, 'kill', 'shutdown'],
    behavior: 'mutating',
    schemas: async () => (await import('./devserver.schema.js')).stop,
    errors: [devServerErrors.projectNotFound, devServerErrors.stateFileUnavailable],
    examples: ['vendure devserver stop'],
    run: () => import('./stop.js'),
    render: () => import('./stop.js'),
});

/** The `vendure devserver` commands, in the order they are listed. */
export const devServerDefinitions = [
    devServerStartDefinition,
    devServerStatusDefinition,
    devServerWaitDefinition,
    devServerLogsDefinition,
    devServerStopDefinition,
];
