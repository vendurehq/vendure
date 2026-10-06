import { CliCommandContext, CliCommandDefinition } from '../../shared/cli-command-definition';
import { runCliCommand } from '../../shared/cli-command-exit';

import { ConsoleLinkHookRegistration } from './console-link-hook';

export const consoleCommandDef: CliCommandDefinition = {
    name: 'console',
    description: 'Link this Vendure project to Vendure Console',
    requiresProject: true,
    arguments: [
        {
            name: 'action',
            description: 'Action to run: link | status | unlink',
            required: false,
        },
    ],
    options: [
        {
            long: '--json',
            description: 'Write one structured Console result to stdout',
        },
        {
            long: '--non-interactive',
            description: 'Do not prompt, sign in or open a browser',
        },
        {
            long: '--project <path>',
            description: 'Vendure project directory (required when project discovery is ambiguous)',
            required: true,
        },
        {
            long: '--force',
            description: 'Create a different Project Link or remove the current link without confirmation',
            required: false,
        },
        {
            long: '--organization <account>',
            description:
                'Link a project of this organization: its Account identifier (Vendure Console → Settings) or its name. ' +
                'Signs in again when the CLI login belongs to another organization.',
            required: false,
        },
        {
            long: '--yes',
            description: 'Answer every CLI confirmation. Plugin hooks can still ask their own questions.',
            required: false,
        },
    ],
    action: async (action, options, _command, context: CliCommandContext) => {
        return runCliCommand(async () => {
            const { consoleCommand } = await import('./console');
            const hooks = context
                .getPluginExtensions<ConsoleLinkHookRegistration>('afterConsoleLink')
                .map(({ pluginId, extension }) =>
                    typeof extension === 'function'
                        ? { pluginId, hook: extension, requiresSession: false }
                        : { pluginId, hook: extension.hook, requiresSession: true },
                );
            return consoleCommand(action, options, { hooks });
        });
    },
};
