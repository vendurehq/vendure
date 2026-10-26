import { CliCommandDefinition } from '../../shared/cli-command-definition';
import { runCliCommand } from '../../shared/cli-command-exit';

export const pluginsCommandDef: CliCommandDefinition = {
    name: 'plugins',
    description: 'List, enable, or disable CLI plugins',
    arguments: [
        {
            name: 'action',
            description: 'Optional action: add | remove (omit to list / interactively manage)',
            required: false,
        },
        {
            name: 'packageName',
            description: 'Package name for add / remove',
            required: false,
        },
    ],
    options: [
        {
            long: '--json',
            description: 'Print discovered CLI plugins as JSON (non-interactive)',
            required: false,
        },
        {
            short: '-g',
            long: '--global',
            description: 'Act on the machine-wide plugin list rather than this project',
            required: false,
        },
    ],
    action: async (action, packageName, options) => {
        return runCliCommand(async () => {
            const { pluginsCommand } = await import('./plugins');
            await pluginsCommand(action, packageName, options);
        });
    },
};
