import { CliCommandDefinition } from '../../shared/cli-command-definition';
import { runCliCommand } from '../../shared/cli-command-exit';

// No `requiresProject`: a codemod's path argument names the files it rewrites,
// and nothing else, so running it on a project from outside that project works.
// This is not the same as the `--config` option on `dev`, `build` and `migrate`,
// which names one file inside a project the command still needs the whole of —
// its node_modules, its tsconfig, its installed Vendure.
export const codemodCommandDef: CliCommandDefinition = {
    name: 'codemod',
    description: 'Run codemods to update your Vendure project code',
    arguments: [
        {
            name: 'transform',
            description: 'Name of the codemod to run (e.g. dashboard-ui)',
            required: false,
        },
        {
            name: 'path',
            description: 'Path to the files or directory to transform',
            required: false,
        },
    ],
    action: async (transform, path, _options) => {
        return runCliCommand(async () => {
            const { codemodCommand } = await import('./codemod');
            await codemodCommand(transform, path);
        });
    },
};
