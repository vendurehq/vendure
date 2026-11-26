import { defineCommand } from '@vendure/common/lib/command';

import { configResolverFailed } from '../../../shared/config-resolver.errors.js';
import { configUnreadable } from '../migrate.errors.js';

import { databaseUnreadable, revertFailed } from './revert-migration.errors.js';

export const revertMigrationDefinition = defineCommand({
    path: ['migrate', 'revert'],
    description: 'Revert the last applied database migration',
    keywords: ['undo', 'rollback', 'database'],
    behavior: 'destructive',
    requires: { project: true },
    consents: {
        revertMigration:
            'Revert the last applied migration. This can drop columns and tables, and the data in them.',
    },
    schemas: () => import('./revert-migration.schema.js'),
    errors: [configUnreadable, configResolverFailed, databaseUnreadable, revertFailed],
    examples: ['vendure migrate revert', 'vendure migrate revert --revert-migration <digest>'],
    plan: () => import('./revert-migration.plan.js'),
    run: () => import('./revert-migration.run.js'),
    render: () => import('./revert-migration.render.js'),
});
