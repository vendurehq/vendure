import { CliCommandDefinition } from '../../shared/cli-command-definition';
import { runCliCommand } from '../../shared/cli-command-exit';

// No `requiresProject`: the path argument names the files to rewrite, so
// transforming a project from outside it is a valid way to run this.
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
