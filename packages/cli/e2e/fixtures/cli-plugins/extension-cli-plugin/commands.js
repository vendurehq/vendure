// A package that declares no commands of its own, only extensions of the CLI's: `vendure explain`
// gets a --shout flag, and `vendure dev` a --cloud-project flag.
import { defineCommandExtension } from '@vendure/common/lib/command';

export const commands = [];

export const extensions = [
    defineCommandExtension({
        path: ['explain'],
        schemas: () => import('./explain-extension.schema.js'),
        run: () => import('./explain-extension.run.js'),
    }),
    defineCommandExtension({
        path: ['dev'],
        schemas: () => import('./dev-extension.schema.js'),
        run: () => import('./dev-extension.run.js'),
    }),
];
