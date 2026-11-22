import { defineCommand } from '@vendure/common/lib/command';

import { runFailed } from './run-migration.errors.js';

export const runMigrationDefinition = defineCommand({
    path: ['migrate', 'run'],
    description: 'Run the pending database migrations',
    keywords: ['database', 'apply', 'typeorm'],
    behavior: 'mutating',
    requires: { project: true },
    schemas: () => import('./run-migration.schema.js'),
    errors: [runFailed],
    examples: ['vendure migrate run', 'vendure migrate run --config ./src/vendure-config.ts'],
    run: () => import('./run-migration.run.js'),
    render: () => import('./run-migration.render.js'),
});
