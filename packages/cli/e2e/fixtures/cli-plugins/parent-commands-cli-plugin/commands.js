// A command with commands under it: `acme deploy` runs on its own, and `acme deploy plan` is a
// command under it. The child is declared first, so the CLI registers it before its parent.
import { defineCommand } from '@vendure/common/lib/command';

export const commands = [
    defineCommand({
        path: ['acme', 'deploy', 'plan'],
        description: 'Show what a deployment would change',
        behavior: 'readonly',
        schemas: () => import('./deploy.schema.js'),
        run: () => import('./plan.run.js'),
    }),
    defineCommand({
        path: ['acme', 'deploy'],
        description: 'Deploy the project',
        behavior: 'mutating',
        schemas: () => import('./deploy.schema.js'),
        run: () => import('./deploy.run.js'),
    }),
];
