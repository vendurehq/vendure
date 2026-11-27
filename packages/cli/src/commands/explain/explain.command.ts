import { defineCommand } from '@vendure/common/lib/command';

import { devServerErrors } from '../devserver/devserver.js';

export const explainDefinition = defineCommand({
    path: ['explain'],
    description:
        'Collect the error of one request to the local dev server, with its stack and the log lines of that request',
    keywords: ['error', 'request', 'debug', 'troubleshoot', 'logs', 'stack', 'request-id'],
    behavior: 'readonly',
    schemas: () => import('./explain.schema.js'),
    cli: { positional: ['requestId'] },
    errors: [devServerErrors.projectNotFound],
    examples: ['vendure explain 2b0c6c2e-5f6a-4a0e-9d1b-7f0d3c1e8a42', 'vendure explain <requestId> --json'],
    run: () => import('./explain.js'),
    render: () => import('./explain.js'),
});
