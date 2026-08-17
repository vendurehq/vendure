import { cancel, intro, isCancel, log, multiselect, outro } from '@clack/prompts';
import pc from 'picocolors';

import { exitCliCommand } from '../../shared/cli-command-exit';
import {
    addCliPluginToProjectConfig,
    mergeEnabledPluginSelection,
    readCliProjectPackageJson,
    removeCliPluginFromProjectConfig,
    writeCliPluginProjectConfig,
} from '../../shared/cli-plugin-project-config';
import {
    DiscoveredCliPlugin,
    discoverCliPlugins,
    getCliPluginProjectContext,
} from '../../shared/resolve-cli-plugins';
import { abortIfNonInteractive, isNonInteractiveEnvironment, withInteractiveTimeout } from '../../utilities/utils';

export interface PluginsCommandOptions {
    json?: boolean;
}

/**
 * Manages explicit activation of CLI plugins for the current project.
 */
export async function pluginsCommand(
    action?: string,
    packageName?: string,
    options: PluginsCommandOptions = {},
): Promise<void> {
    const normalizedAction = action?.trim().toLowerCase();

    // Actions run before --json is considered, so `plugins add <pkg> --json`
    // performs the write and then prints the updated state.
    if (normalizedAction === 'add') {
        addPlugin(requirePackageName(normalizedAction, packageName), options);
        return;
    }

    if (normalizedAction === 'remove') {
        removePlugin(requirePackageName(normalizedAction, packageName), options);
        return;
    }

    if (normalizedAction) {
        log.error(`Unknown plugins action "${action}". Use add, remove, or omit the action to list.`);
        log.info(
            'Examples:\n   vendure plugins\n   vendure plugins add @vendure/cloud\n   vendure plugins remove @vendure/cloud\n   vendure plugins --json',
        );
        exitCliCommand(1);
    }

    if (options.json) {
        printJson(discoverCliPlugins({ validate: true }));
        return;
    }

    if (isNonInteractiveEnvironment()) {
        printTextList(discoverCliPlugins({ validate: true }));
        return;
    }

    await runInteractiveManager();
}

function requirePackageName(action: string, packageName: string | undefined): string {
    const name = packageName?.trim();
    if (!name) {
        log.error(`Missing package name for "vendure plugins ${action}".`);
        log.info(`Example: vendure plugins ${action} @vendure/cloud`);
        exitCliCommand(1);
    }
    return name;
}

function addPlugin(packageName: string, options: PluginsCommandOptions): void {
    assertPackageCanBeEnabled(packageName);
    const result = addCliPluginToProjectConfig(packageName);
    log.success(`Enabled CLI plugin ${pc.cyan(packageName)}`);
    log.info(`Wrote ${result.packageJsonPath}`);
    if (options.json) {
        printJson(discoverCliPlugins({ validate: true }));
    }
}

function removePlugin(packageName: string, options: PluginsCommandOptions): void {
    const project = readCliProjectPackageJson();
    if (!project) {
        log.error('Could not find a project package.json.');
        exitCliCommand(1);
    }

    const enabled = project.packageJson.vendure?.cli?.plugins ?? [];
    if (!enabled.includes(packageName)) {
        log.error(`Package "${packageName}" is not an enabled CLI plugin, so there is nothing to remove.`);
        if (enabled.length > 0) {
            log.info(`Enabled plugins:\n${enabled.map(name => `   ${name}`).join('\n')}`);
        } else {
            log.info('No CLI plugins are currently enabled.');
        }
        exitCliCommand(1);
    }

    const result = removeCliPluginFromProjectConfig(packageName);
    log.success(`Disabled CLI plugin ${pc.cyan(packageName)}`);
    log.info(`Wrote ${result.packageJsonPath}`);
    if (options.json) {
        printJson(discoverCliPlugins({ validate: true }));
    }
}

function assertPackageCanBeEnabled(packageName: string): void {
    const context = getCliPluginProjectContext();
    if (!context) {
        log.error('Could not find a project package.json.');
        exitCliCommand(1);
    }

    if (!context.directDependencyNames.has(packageName)) {
        log.error(
            `Package "${packageName}" is not a direct dependency of ${context.projectRoot}. Install it first, then run vendure plugins add ${packageName}.`,
        );
        exitCliCommand(1);
    }

    const resolved = context.resolvePackage(packageName);
    if (!resolved) {
        log.error(
            `Package "${packageName}" is a dependency but could not be resolved from ${context.projectRoot}. Check that it is installed correctly (and built, if it is a workspace package).`,
        );
        exitCliCommand(1);
    }

    if (!resolved.packageJson.vendure?.cliPlugin) {
        log.error(
            `Package "${packageName}" does not declare vendure.cliPlugin in its package.json, so it cannot be enabled as a CLI plugin.`,
        );
        exitCliCommand(1);
    }
}

async function runInteractiveManager(): Promise<void> {
    if (
        abortIfNonInteractive('vendure plugins', [
            'vendure plugins --json',
            'vendure plugins add @vendure/cloud',
            'vendure plugins remove @vendure/cloud',
        ])
    ) {
        return;
    }

    const discovered = discoverCliPlugins({ validate: true });
    if (discovered.length === 0) {
        log.info('No direct dependencies declare a vendure.cliPlugin entry.');
        return;
    }

    // eslint-disable-next-line no-console
    console.log('\n');
    intro(pc.blue('Vendure CLI plugins'));

    const toggleable = discovered.filter(plugin => plugin.status !== 'failed');
    const failed = discovered.filter(plugin => plugin.status === 'failed');

    for (const plugin of failed) {
        log.warn(`${plugin.packageName}: ${plugin.reason ?? 'failed to resolve'}`);
    }

    if (toggleable.length === 0) {
        outro('No plugins available to enable.');
        return;
    }

    const selected = await withInteractiveTimeout(
        async () =>
            multiselect({
                message: 'Enable CLI plugins (space to toggle, enter to save)',
                options: toggleable.map(plugin => ({
                    value: plugin.packageName,
                    label: plugin.packageName,
                    hint: statusHint(plugin),
                })),
                initialValues: toggleable
                    .filter(plugin => plugin.status === 'enabled')
                    .map(plugin => plugin.packageName),
                required: false,
            }),
        {
            examples: [
                'vendure plugins --json',
                'vendure plugins add @vendure/cloud',
                'vendure plugins remove @vendure/cloud',
            ],
            helpCommands: ['vendure plugins --help'],
        },
    );

    if (isCancel(selected)) {
        cancel('No changes made.');
        exitCliCommand(0);
    }

    const currentPlugins = readCliProjectPackageJson()?.packageJson.vendure?.cli?.plugins ?? [];
    // Entries classified as failed are not offered for toggling and must
    // survive the write — a user who only opened the manager to look should
    // not delete a temporarily broken plugin from the allowlist.
    const plugins = mergeEnabledPluginSelection(
        currentPlugins,
        toggleable.map(plugin => plugin.packageName),
        selected as string[],
    );

    const result = writeCliPluginProjectConfig({ plugins });
    outro(`Updated ${result.packageJsonPath}`);
}

function statusHint(plugin: DiscoveredCliPlugin): string {
    switch (plugin.status) {
        case 'enabled':
            return 'enabled';
        case 'not-enabled':
            return 'not enabled';
        case 'failed':
            return plugin.reason ?? 'failed';
        default:
            return plugin.status;
    }
}

function printTextList(plugins: DiscoveredCliPlugin[]): void {
    if (plugins.length === 0) {
        process.stdout.write('No CLI plugins discovered.\n');
        return;
    }
    for (const plugin of plugins) {
        const detail = plugin.status === 'failed' && plugin.reason ? ` — ${plugin.reason}` : '';
        process.stdout.write(`${plugin.packageName}\t${plugin.status}${detail}\n`);
    }
}

function printJson(plugins: DiscoveredCliPlugin[]): void {
    process.stdout.write(
        `${JSON.stringify(
            {
                plugins: plugins.map(plugin => ({
                    packageName: plugin.packageName,
                    status: plugin.status,
                    reason: plugin.reason,
                    entryPath: plugin.entryPath,
                    declaredCommands: plugin.declaredCommands,
                })),
            },
            null,
            2,
        )}\n`,
    );
}
