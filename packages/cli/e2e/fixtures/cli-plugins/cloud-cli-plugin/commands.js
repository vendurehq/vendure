// The declarations of a package shaped like the Vendure Cloud command surface: a command nested
// below a group. They are plain data and import nothing from @vendure/cli.
import { defineCommand } from '@vendure/common/lib/command';

export const commands = [
    defineCommand({
        path: ['project', 'list'],
        description: 'List the projects you can access',
        behavior: 'readonly',
        schemas: () => import('./project-list.schema.js'),
        run: () => import('./project-list.run.js'),
    }),
];
