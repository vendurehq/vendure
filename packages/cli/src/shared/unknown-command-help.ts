import { addDevDependencyCommand } from './package-manager';
import {
    CliPluginLoadFailure,
    findEnabledPluginDeclaringCommand,
    findInactivePluginProvidingCommand,
    getCliPluginScope,
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
 *
 * `notInstalledGlobally` lists globally enabled packages that could not be
 * found, which startup does not report. Their commands are unknown, so any of
 * them could be the one asked for, and each is named with the fix.
 */
export function unknownCommandHelp(
    commandName: string,
    options: ResolveCliPluginsOptions,
    unavailablePackages: ReadonlyMap<string, PluginFailureStep>,
    notInstalledGlobally: readonly CliPluginLoadFailure[] = [],
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

    for (const failure of notInstalledGlobally) {
        lines.push(globalPluginNotInstalledHelp(failure, options));
    }

    // Inactive packages that declare no commands are not named here. The
    // startup hint printed before this already counts every inactive package.
    return lines;
}

/**
 * One line naming the fix for a globally enabled package the CLI could not
 * find.
 *
 * In a project, the fix is to enable the package for that project, installing
 * it first when the project does not have it. Removing the global entry would
 * break every other project that relies on it. Outside a project there is no
 * such fix, so the scope's own reason is given.
 */
export function globalPluginNotInstalledHelp(
    failure: CliPluginLoadFailure,
    options: ResolveCliPluginsOptions,
): string {
    const { packageName } = failure;
    const project = getCliPluginScope('project', { ...options, scopes: ['project'] });
    if (!project || project.error) {
        return `${packageName} is enabled globally but could not be found. ${failure.reason}`;
    }
    const enable = pluginsCommandFor('add', packageName, 'project');
    if (!project.resolvePackage(packageName)) {
        const install = addDevDependencyCommand(project.origin, packageName);
        return `${packageName} is enabled globally but not installed in ${project.origin}. Install it with: ${install} && ${enable}`;
    }
    const ineligible = project.check(packageName);
    if (ineligible) {
        return `${packageName} is enabled globally but cannot be enabled for ${project.origin}: ${ineligible}`;
    }
    return `${packageName} is enabled globally but not for ${project.origin}. Enable it with: ${enable}`;
}
