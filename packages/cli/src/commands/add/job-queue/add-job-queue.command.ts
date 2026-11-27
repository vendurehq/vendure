import { defineCommand } from '@vendure/common/lib/command';

import { pluginAmbiguous, pluginNotFound, serviceNotFound } from '../add.errors.js';

export const addJobQueueDefinition = defineCommand({
    path: ['add', 'job-queue'],
    description: 'Add a job queue to a service of a plugin',
    keywords: ['background', 'worker', 'task', 'jobs'],
    behavior: 'mutating',
    requires: { project: true },
    schemas: () => import('./add-job-queue.schema.js'),
    cli: {
        fields: {
            plugin: { choices: async () => (await import('../add.project.js')).listPluginNames() },
            service: {
                choices: async (_ctx, input) => (await import('../add.project.js')).listServiceNames(input),
            },
        },
    },
    errors: [pluginNotFound, pluginAmbiguous, serviceNotFound],
    examples: ['vendure add job-queue --plugin ReviewsPlugin --service ReviewService --name review-indexing'],
    run: () => import('./add-job-queue.run.js'),
    render: () => import('./add-job-queue.render.js'),
});
