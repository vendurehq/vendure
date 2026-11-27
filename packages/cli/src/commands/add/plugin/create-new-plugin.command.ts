import { defineCommand } from '@vendure/common/lib/command';

import { fileExists } from '../add.errors.js';

import { vendureConfigNotFound } from './create-new-plugin.errors.js';

export const addPluginDefinition = defineCommand({
    path: ['add', 'plugin'],
    description: 'Create a new Vendure plugin and add it to the Vendure config',
    keywords: ['scaffold', 'module', 'extension'],
    behavior: 'mutating',
    requires: { project: true },
    schemas: () => import('./create-new-plugin.schema.js'),
    cli: { positional: ['name'], fields: { dir: { prompt: true } } },
    errors: [fileExists, vendureConfigNotFound],
    examples: ['vendure add plugin reviews', 'vendure add plugin reviews --dir ./src/plugins/reviews'],
    run: () => import('./create-new-plugin.run.js'),
    render: () => import('./create-new-plugin.render.js'),
});
