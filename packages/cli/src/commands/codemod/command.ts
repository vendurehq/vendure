import { CliCommandDefinition } from '../../shared/cli-command-definition';
import { runCliCommand } from '../../shared/cli-command-exit';

// No `requiresProject`: a codemod takes an explicit path, so transforming a
// project from outside it is a legitimate way to run this. Given no path it
// reads the current directory and reports finding nothing to transform, which
// is already a clear enough answer.
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
