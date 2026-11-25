import { defineCommand } from '@vendure/common/lib/command';

import { devErrors } from './dev.errors.js';

/**
 * `vendure dev`, the foreground run of the server, the worker and the Dashboard. It runs until it
 * is stopped, so it is a `service`: it is not an MCP tool. Agents use the `devserver` commands.
 */
export const devDefinition = defineCommand({
    path: ['dev'],
    description: 'Run Vendure in development mode',
    keywords: ['server', 'worker', 'dashboard', 'watch', 'reload'],
    behavior: 'service',
    schemas: () => import('./dev.schema.js'),
    errors: [devErrors.startFailed],
    cli: {
        positional: ['target'],
        flags: {
            inspect: { placeholder: 'host:port' },
            inspectBrk: { placeholder: 'host:port' },
        },
    },
    examples: ['vendure dev', 'vendure dev server --dir apps/server', 'vendure dev --inspect'],
    run: () => import('./dev.run.js'),
    render: () => import('./dev.render.js'),
});
