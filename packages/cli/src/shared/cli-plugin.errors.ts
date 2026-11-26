import { defineError } from '@vendure/common/lib/command';

/**
 * A CLI plugin still declares commands under `commands`, which v4 does not read. Without
 * this error the plugin would load with none of its commands, and nothing would say why.
 *
 * @since 4.0.0
 */
export const pluginCommandsRemoved = defineError<{ plugin: string }>({
    code: 'plugin.commands-removed',
    exit: 1,
    message: ({ plugin }) =>
        `CLI plugin "${plugin}" declares commands under "commands", which this version of the CLI no ` +
        'longer loads. Declare each command with defineCommand, build the command manifest, and list it ' +
        'in package.json as vendure.commandManifest and vendure.commandDefinitions. Then remove ' +
        '"commands" from the CLI plugin.',
});

/** Thrown by `assertCliPlugin` for {@link pluginCommandsRemoved}. Its message starts with the code. */
export class CliPluginCommandsRemovedError extends Error {
    readonly code = pluginCommandsRemoved.code;

    constructor(readonly plugin: string) {
        super(`[${pluginCommandsRemoved.code}] ${pluginCommandsRemoved.message({ plugin })}`);
        this.name = 'CliPluginCommandsRemovedError';
    }
}
