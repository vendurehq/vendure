import {
    findEnabledPluginDeclaringCommand,
    findInactivePluginProvidingCommand,
    listInactiveCliPlugins,
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
        return lines;
    }

    const provider = findInactivePluginProvidingCommand(commandName, options);
    if (provider) {
        lines.push(`It is provided by ${provider.packageName}, which is installed but not enabled.`);
        lines.push(`Enable it with: ${pluginsCommandFor('add', provider.packageName, provider.scope)}`);
        return lines;
    }

    // A package that declares no commands might provide this one; one that
    // declares others does not.
    const undeclared = listInactiveCliPlugins(options).filter(plugin => !plugin.declaredCommands);
    if (undeclared.length === 1) {
        lines.push('1 package provides CLI commands but is not enabled. Run "vendure plugins" to review it.');
    } else if (undeclared.length > 1) {
        lines.push(
            `${undeclared.length} packages provide CLI commands but are not enabled. Run "vendure plugins" to review them.`,
        );
    }
    return lines;
}
