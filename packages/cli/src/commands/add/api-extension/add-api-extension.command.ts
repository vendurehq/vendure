import { defineCommand } from '@vendure/common/lib/command';

import { pluginAmbiguous, pluginNotFound, serviceNotFound } from '../add.errors.js';

import { apiExtensionFailed } from './add-api-extension.errors.js';

export const addApiExtensionDefinition = defineCommand({
    path: ['add', 'api-extension'],
    description: 'Add an Admin API extension to a plugin, with a resolver that calls a service',
    keywords: ['graphql', 'resolver', 'query', 'mutation', 'schema'],
    behavior: 'mutating',
    requires: { project: true },
    schemas: () => import('./add-api-extension.schema.js'),
    cli: {
        fields: {
            plugin: { choices: async () => (await import('../add.project.js')).listPluginNames() },
            service: {
                choices: async (_ctx, input) => (await import('../add.project.js')).listServiceNames(input),
            },
        },
    },
    errors: [pluginNotFound, pluginAmbiguous, serviceNotFound, apiExtensionFailed],
    examples: [
        'vendure add api-extension --plugin ReviewsPlugin --service ReviewService --query-name reviews',
        'vendure add api-extension --plugin ReviewsPlugin --service ProductReviewService',
    ],
    run: () => import('./add-api-extension.run.js'),
    render: () => import('./add-api-extension.render.js'),
});
