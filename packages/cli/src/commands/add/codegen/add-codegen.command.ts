import { defineCommand } from '@vendure/common/lib/command';

import { packageJsonNotFound, pluginAmbiguous, pluginNotFound } from '../add.errors.js';

export const addCodegenDefinition = defineCommand({
    path: ['add', 'codegen'],
    description: 'Set up GraphQL code generation for a plugin',
    keywords: ['graphql', 'types', 'typescript'],
    behavior: 'mutating',
    requires: { project: true },
    schemas: () => import('./add-codegen.schema.js'),
    cli: {
        fields: {
            plugin: {
                prompt: true,
                choices: async () => (await import('../add.project.js')).listPluginNames(),
            },
        },
    },
    errors: [pluginNotFound, pluginAmbiguous, packageJsonNotFound],
    examples: ['vendure add codegen --plugin MyPlugin'],
    run: () => import('./add-codegen.run.js'),
    render: () => import('./add-codegen.render.js'),
});
