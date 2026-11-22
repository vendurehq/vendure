import { defineCommand } from '@vendure/common/lib/command';

import { entityNotFound, fileExists, pluginAmbiguous, pluginNotFound } from '../add.errors.js';

export const addServiceDefinition = defineCommand({
    path: ['add', 'service'],
    description: 'Add a new service to a plugin',
    keywords: ['provider', 'crud', 'business logic'],
    behavior: 'mutating',
    requires: { project: true },
    schemas: () => import('./add-service.schema.js'),
    cli: {
        positional: ['name'],
        fields: {
            plugin: { choices: async () => (await import('../add.project.js')).listPluginNames() },
            entity: {
                prompt: true,
                choices: async (_ctx, input) => (await import('../add.project.js')).listEntityNames(input),
            },
        },
    },
    errors: [pluginNotFound, pluginAmbiguous, entityNotFound, fileExists],
    examples: [
        'vendure add service ReviewService --plugin ReviewsPlugin',
        'vendure add service ProductReviewService --plugin ReviewsPlugin --entity ProductReview',
    ],
    run: () => import('./add-service.run.js'),
    render: () => import('./add-service.render.js'),
});
