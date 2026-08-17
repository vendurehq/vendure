import { cancel, intro, isCancel, log, multiselect, outro } from '@clack/prompts';
import pc from 'picocolors';

import { exitCliCommand } from '../../shared/cli-command-exit';
import {
    addCliPluginToProjectConfig,
    readCliProjectPackageJson,
    removeCliPluginFromProjectConfig,
    writeCliPluginProjectConfig,
} from '../../shared/cli-plugin-project-config';
import {
    DiscoveredCliPlugin,
    discoverCliPlugins,
    listDirectDependencyNames,
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

    if (options.json) {
        printJson(discoverCliPlugins());
        return;
    }

    if (normalizedAction === 'add') {
        await addPlugin(requirePackageName(normalizedAction, packageName));
        return;
    }

    if (normalizedAction === 'remove') {
        await removePlugin(requirePackageName(normalizedAction, packageName));
        return;
    }

    if (normalizedAction) {
        log.error(`Unknown plugins action "${action}". Use add, remove, or omit the action to list.`);
        log.info('Examples:\n   vendure plugins\n   vendure plugins add @vendure/cloud\n   vendure plugins remove @vendure/cloud\n   vendure plugins --json');
        exitCliCommand(1);
    }

    if (isNonInteractiveEnvironment()) {
        printTextList(discoverCliPlugins());
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

async function addPlugin(packageName: string): Promise<void> {
    assertPackageCanBeEnabled(packageName);
    const result = addCliPluginToProjectConfig(packageName);
    log.success(`Enabled CLI plugin ${pc.cyan(packageName)}`);
    log.info(`Wrote ${result.packageJsonPath}`);
}

async function removePlugin(packageName: string): Promise<void> {
    const result = removeCliPluginFromProjectConfig(packageName);
    log.success(`Disabled CLI plugin ${pc.cyan(packageName)}`);
    log.info(`Wrote ${result.packageJsonPath}`);
}

function assertPackageCanBeEnabled(packageName: string): void {
    const project = readCliProjectPackageJson();
    if (!project) {
        log.error('Could not find a project package.json.');
        exitCliCommand(1);
    }

    const directDeps = new Set(listDirectDependencyNames(project.packageJson));
    if (!directDeps.has(packageName)) {
        log.error(
            `Package "${packageName}" is not a direct dependency of ${project.projectRoot}. Install it first, then run vendure plugins add ${packageName}.`,
        );
        exitCliCommand(1);
    }

    const discovered = discoverCliPlugins().find(plugin => plugin.packageName === packageName);
    if (!discovered) {
        log.error(
            `Package "${packageName}" does not declare vendure.cliPlugin in its package.json, so it cannot be enabled as a CLI plugin.`,
        );
        exitCliCommand(1);
    }
}

async function runInteractiveManager(): Promise<void> {
    if (abortIfNonInteractive('vendure plugins', [
        'vendure plugins --json',
        'vendure plugins add @vendure/cloud',
        'vendure plugins remove @vendure/cloud',
    ])) {
        return;
    }

    const discovered = discoverCliPlugins();
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

    const enabled = new Set(selected as string[]);
    const plugins = toggleable
        .map(plugin => plugin.packageName)
        .filter(name => enabled.has(name));

    // Anything previously known but unchecked goes to exclude so the startup
    // hint stays quiet for packages the user intentionally declined.
    const exclude = toggleable
        .map(plugin => plugin.packageName)
        .filter(name => !enabled.has(name));

    const result = writeCliPluginProjectConfig({ plugins, exclude });
    outro(`Updated ${result.packageJsonPath}`);
}

function statusHint(plugin: DiscoveredCliPlugin): string {
    switch (plugin.status) {
        case 'enabled':
            return 'enabled';
        case 'excluded':
            return 'excluded';
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
        const detail = plugin.reason ? ` — ${plugin.reason}` : '';
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
