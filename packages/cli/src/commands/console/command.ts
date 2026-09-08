import { CliCommandContext, CliCommandDefinition } from '../../shared/cli-command-definition';
import { runCliCommand } from '../../shared/cli-command-exit';

import { ConsoleLinkHookRegistration } from './console-link-hook';

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
            description: 'Create a different Project Link or remove the current link without confirmation',
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
