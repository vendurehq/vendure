import { defineCommand } from '@vendure/common/lib/command';

import { fileExists, pluginNotFound } from '../add.errors.js';

export const addEntityDefinition = defineCommand({
    path: ['add', 'entity'],
    description: 'Add a new entity to a plugin',
    keywords: ['typeorm', 'database', 'model', 'table'],
    behavior: 'mutating',
    requires: { project: true },
    schemas: () => import('./add-entity.schema.js'),
    cli: {
        positional: ['name'],
        fields: {
            plugin: { choices: async () => (await import('../add.project.js')).listPluginNames() },
        },
    },
    errors: [pluginNotFound, fileExists],
    examples: [
        'vendure add entity ProductReview --plugin ReviewsPlugin',
        'vendure add entity ProductReview --plugin ReviewsPlugin --custom-fields --translatable',
    ],
    run: () => import('./add-entity.run.js'),
    render: () => import('./add-entity.render.js'),
});
