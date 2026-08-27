import { CliCommandDefinition } from '../../shared/cli-command-definition';
import { runCliCommand } from '../../shared/cli-command-exit';

export const consoleCommandDef: CliCommandDefinition = {
    name: 'console',
    description: 'Link this Vendure project to Vendure Console',
    arguments: [
        {
            name: 'action',
            description: 'Action to run: link | status | unlink',
            required: false,
        },
    ],
    options: [
        {
            long: '--allow-custom-console',
            description: 'Allow custom remote Console endpoints without an interactive prompt',
            required: false,
        },
        {
            long: '--project <path>',
            description: 'Vendure project directory (required when project discovery is ambiguous)',
            required: true,
        },
        {
            long: '--force',
            description: 'Confirm replacement or unlink without an interactive prompt',
            required: false,
        },
    ],
    action: async (action, options) => {
        return runCliCommand(async () => {
            const { consoleCommand } = await import('./console');
            return consoleCommand(action, options);
        });
    },
};
