// The declarations of this package's commands. They are plain data: declaring them loads no
// schema library and no implementation, and imports nothing from @vendure/cli.
import { defineCommand, defineCommandGroup, defineError } from '@vendure/common/lib/command';

export const nothingToReset = defineError({
    code: 'example.nothing-to-reset',
    exit: 1,
    message: ({ file }) => `There is no example data at ${file}`,
});

// Every `example` command takes `--audience`, declared once for the group.
export const groups = [
    defineCommandGroup({
        path: ['example'],
        description: 'Example commands',
        schemas: () => import('./example-group.schema.js'),
        cli: { flags: { audience: { short: '-a' } } },
    }),
];

export const commands = [
    defineCommand({
        path: ['example', 'greet'],
        description: 'Greet someone, to show a plugin command running on the host',
        keywords: ['hello'],
        behavior: 'readonly',
        schemas: () => import('./greet.schema.js'),
        cli: { positional: ['name'], flags: { shout: { short: '-s' } } },
        examples: ['vendure example greet Ada', 'vendure example greet Ada --shout --json'],
        run: () => import('./greet.run.js'),
    }),
    defineCommand({
        path: ['example', 'reset'],
        description: 'Delete the example data file of the project',
        behavior: 'destructive',
        consents: { resetData: 'Delete example-data.json and the data in it' },
        errors: [nothingToReset],
        schemas: () => import('./reset.schema.js'),
        plan: () => import('./reset.plan.js'),
        run: () => import('./reset.run.js'),
    }),
];
