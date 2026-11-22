import { defineCommand } from '@vendure/common/lib/command';

import { generateFailed } from './generate-migration.errors.js';

export const generateMigrationDefinition = defineCommand({
    path: ['migrate', 'generate'],
    description: 'Generate a database migration from the changes to your entities',
    keywords: ['database', 'schema', 'typeorm'],
    behavior: 'mutating',
    requires: { project: true },
    schemas: () => import('./generate-migration.schema.js'),
    cli: {
        positional: ['name'],
        fields: {
            outputDir: {
                prompt: true,
                choices: async (_ctx, input) => {
                    const { loadProjectConfig, migrationDirs } = await import('../migration-project.js');
                    return migrationDirs(await loadProjectConfig(input.config as string | undefined));
                },
            },
        },
    },
    errors: [generateFailed],
    examples: [
        'vendure migrate generate add-reviews',
        'vendure migrate generate baseline --from-empty --output-dir ./src/migrations',
    ],
    run: () => import('./generate-migration.run.js'),
    render: () => import('./generate-migration.render.js'),
});
