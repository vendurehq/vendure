import {
    findEnabledPluginDeclaringCommand,
    findInactivePluginProvidingCommand,
    pluginsCommandFor,
    ResolveCliPluginsOptions,
} from './resolve-cli-plugins';

export type PluginFailureStep = 'load' | 'register';

/**
 * The lines to print for a command no registered plugin or built-in provides.
 *
 * A plugin is named only when its `vendure.cliCommands` declares the command.
 * `unavailablePackages` maps each enabled package that failed to load or to
 * register in this run, whose error was already printed, to that step.
 */
export function unknownCommandHelp(
    commandName: string,
    options: ResolveCliPluginsOptions,
    unavailablePackages: ReadonlyMap<string, PluginFailureStep>,
): string[] {
    const lines = [`Unknown command "${commandName}".`];

    const enabled = findEnabledPluginDeclaringCommand(commandName, options);
    if (enabled) {
        const failedStep = unavailablePackages.get(enabled.packageName);
        const cause = failedStep
            ? `It failed to ${failedStep}; see the error above.`
            : `Its vendure.cliCommands lists "${commandName}", but the plugin does not provide it.`;
        lines.push(`${enabled.packageName} is enabled but did not register "${commandName}". ${cause}`);
    }

    // Checked even when an enabled plugin declares the command, because
    // enabling this package is what would make the command available.
    const provider = findInactivePluginProvidingCommand(commandName, options);
    if (provider) {
        const subject = enabled ? `"${commandName}" is also` : 'It is';
        lines.push(`${subject} provided by ${provider.packageName}, which is installed but not enabled.`);
        lines.push(`Enable it with: ${pluginsCommandFor('add', provider.packageName, provider.scope)}`);
    }

    // Inactive packages that declare no commands are not named here. The
    // startup hint printed before this already counts every inactive package.
    return lines;
}
