import { defineCommand } from '@vendure/common/lib/command';

import { allSeedErrors } from './seed.errors.js';

export const seedDefinition = defineCommand({
    path: ['seed'],
    description: 'Seed an empty database with a base-data preset, or list the presets',
    keywords: ['preset', 'base data', 'initial data', 'tax', 'zones', 'first run', 'scenario'],
    behavior: 'mutating',
    requires: { project: true },
    schemas: () => import('./seed.schema.js'),
    errors: allSeedErrors,
    examples: [
        'vendure seed',
        'vendure seed --preset uk',
        'vendure seed --preset single-country --country NZ --currency NZD',
        'vendure seed --first-run --json',
    ],
    run: () => import('./seed.run.js'),
    render: () => import('./seed.render.js'),
});
