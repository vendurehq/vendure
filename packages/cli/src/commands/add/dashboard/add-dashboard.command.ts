import { defineCommand } from '@vendure/common/lib/command';

import { pluginAmbiguous, pluginNotFound } from '../add.errors.js';

import { dashboardConflict } from './add-dashboard.errors.js';

export const addDashboardDefinition = defineCommand({
    path: ['add', 'dashboard'],
    description: 'Add Dashboard extensions to a plugin',
    keywords: ['admin', 'ui', 'react', 'extension'],
    behavior: 'mutating',
    requires: { project: true },
    schemas: () => import('./add-dashboard.schema.js'),
    cli: {
        fields: {
            plugin: { choices: async () => (await import('../add.project.js')).listPluginNames() },
        },
    },
    errors: [pluginNotFound, pluginAmbiguous, dashboardConflict],
    examples: ['vendure add dashboard --plugin ReviewsPlugin'],
    run: () => import('./add-dashboard.run.js'),
    render: () => import('./add-dashboard.render.js'),
});
