import { cancel, intro, isCancel, log, multiselect, outro } from '@clack/prompts';
import pc from 'picocolors';

import { exitCliCommand } from '../../shared/cli-command-exit';
import {
    addGlobalPlugin,
    getGlobalPluginAllowlist,
    removeGlobalPlugin,
    writeGlobalPluginAllowlist,
} from '../../shared/cli-global-plugin-config';
import {
    addCliPluginToProjectConfig,
    mergeEnabledPluginSelection,
    readCliProjectPackageJson,
    removeCliPluginFromProjectConfig,
    writeCliPluginProjectConfig,
} from '../../shared/cli-plugin-project-config';
import {
    checkScopeDeclaresPlugin,
    cliPluginCommandNames,
    CliPluginScopeKind,
    DiscoveredCliPlugin,
    discoverCliPlugins,
    getCliPluginScope,
} from '../../shared/resolve-cli-plugins';
import { abortIfNonInteractive, isNonInteractiveEnvironment, withInteractiveTimeout } from '../../utilities/utils';

export interface PluginsCommandOptions {
    json?: boolean;
    global?: boolean;
}

/**
 * Which allowlist `add` and `remove` write to.
 *
 * `--global` is explicit. Otherwise the project is used when there is one,
 * because that is the narrower change and the one a developer in a repo means.
 * Outside a project the global list is the only one there is, so it is used
 * rather than reporting that no package.json was found — that is the whole
 * situation a globally installed CLI is run in.
 */
function resolveTargetScope(options: PluginsCommandOptions): CliPluginScopeKind {
    if (options.global) {
        return 'global';
    }
    return readCliProjectPackageJson() ? 'project' : 'global';
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
            [
                'Examples:',
                '   vendure plugins',
                '   vendure plugins add @vendure/cloud',
                '   vendure plugins add --global @vendure/cloud',
                '   vendure plugins remove @vendure/cloud',
                '   vendure plugins --json',
            ].join('\n'),
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
    const scope = resolveTargetScope(options);
    assertPackageCanBeEnabled(packageName, scope);
    const written =
        scope === 'global'
            ? addGlobalPlugin(packageName).path
            : addCliPluginToProjectConfig(packageName).packageJsonPath;
    log.success(`Enabled CLI plugin ${pc.cyan(packageName)} ${scopeSuffix(scope)}`);
    log.info(`Wrote ${written}`);
    if (options.json) {
        printJson(discoverCliPlugins({ validate: true }));
    }
}

/** Names the list that was changed, so the message is unambiguous. */
function scopeSuffix(scope: CliPluginScopeKind): string {
    return scope === 'global' ? 'for this machine' : 'for this project';
}

function removePlugin(packageName: string, options: PluginsCommandOptions): void {
    const scope = resolveTargetScope(options);
    const enabled = readEnabledPlugins(scope);

    if (!enabled.includes(packageName)) {
        log.error(
            `Package "${packageName}" is not an enabled CLI plugin ${scopeSuffix(
                scope,
            )}, so there is nothing to remove.`,
        );
        if (enabled.length > 0) {
            log.info(`Enabled plugins:\n${enabled.map(name => `   ${name}`).join('\n')}`);
        } else {
            log.info('No CLI plugins are currently enabled.');
        }
        // The other list is the usual reason for this, so say so rather than
        // leaving the user to guess which one they were looking at.
        const other: CliPluginScopeKind = scope === 'global' ? 'project' : 'global';
        if (readEnabledPlugins(other).includes(packageName)) {
            log.info(`It is enabled ${scopeSuffix(other)}. Remove it with: ${removeCommandFor(packageName, other)}`);
        }
        exitCliCommand(1);
    }

    const written =
        scope === 'global'
            ? removeGlobalPlugin(packageName).path
            : removeCliPluginFromProjectConfig(packageName).packageJsonPath;
    log.success(`Disabled CLI plugin ${pc.cyan(packageName)} ${scopeSuffix(scope)}`);
    log.info(`Wrote ${written}`);
    if (options.json) {
        printJson(discoverCliPlugins({ validate: true }));
    }
}

function removeCommandFor(packageName: string, scope: CliPluginScopeKind): string {
    return `vendure plugins remove${scope === 'global' ? ' --global' : ''} ${packageName}`;
}

/** The allowlist as it currently stands in one scope. */
function readEnabledPlugins(scope: CliPluginScopeKind): string[] {
    if (scope === 'global') {
        return getGlobalPluginAllowlist();
    }
    return readCliProjectPackageJson()?.packageJson.vendure?.cli?.plugins ?? [];
}

/**
 * Refuses a package the scope could not load, using the scope's own rules, so
 * that `plugins add` never writes an allowlist entry that startup would then
 * report as broken.
 */
function assertPackageCanBeEnabled(packageName: string, scopeKind: CliPluginScopeKind): void {
    const scope = getCliPluginScope(scopeKind);
    if (!scope) {
        log.error('Could not find a project package.json.');
        exitCliCommand(1);
    }

    const ineligible = scope.checkEligible(packageName) ?? checkScopeDeclaresPlugin(packageName, scope);
    if (ineligible) {
        log.error(`Package "${packageName}" cannot be enabled ${scopeSuffix(scopeKind)}: ${ineligible}`);
        exitCliCommand(1);
    }
}

async function runInteractiveManager(): Promise<void> {
    if (
        abortIfNonInteractive('vendure plugins', [
            'vendure plugins --json',
            'vendure plugins add @vendure/cloud',
            'vendure plugins add --global @vendure/cloud',
            'vendure plugins remove @vendure/cloud',
        ])
    ) {
        return;
    }

    const discovered = discoverCliPlugins({ validate: true });
    if (discovered.length === 0) {
        log.info('No installed package declares a vendure.cliPlugin entry.');
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
                // Keyed by scope as well as name, because the same package
                // can be offered once per scope and the two toggle separately.
                options: toggleable.map(plugin => ({
                    value: toggleKey(plugin),
                    label: `${plugin.packageName} ${pc.dim(`(${scopeSuffix(plugin.scope)})`)}`,
                    hint: statusHint(plugin),
                })),
                initialValues: toggleable
                    .filter(plugin => plugin.status === 'enabled')
                    .map(plugin => toggleKey(plugin)),
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

    const selectedKeys = new Set(selected);
    const written: string[] = [];

    for (const scope of ['global', 'project'] as CliPluginScopeKind[]) {
        const inScope = toggleable.filter(plugin => plugin.scope === scope);
        if (inScope.length === 0) {
            continue;
        }
        // Entries classified as failed are not offered for toggling and must
        // survive the write — a user who only opened the manager to look should
        // not delete a temporarily broken plugin from the allowlist.
        const plugins = mergeEnabledPluginSelection(
            readEnabledPlugins(scope),
            inScope.map(plugin => plugin.packageName),
            inScope
                .filter(plugin => selectedKeys.has(toggleKey(plugin)))
                .map(plugin => plugin.packageName),
        );
        written.push(
            scope === 'global'
                ? writeGlobalPluginAllowlist(plugins).path
                : writeCliPluginProjectConfig({ plugins }).packageJsonPath,
        );
    }

    outro(written.length > 0 ? `Updated ${written.join(' and ')}` : 'No changes made.');
}

/**
 * Identifies one row of the picker. The same package can be installed both
 * globally and in the project, and each is enabled separately, so the name
 * alone would make the two rows indistinguishable.
 */
function toggleKey(plugin: DiscoveredCliPlugin): string {
    return `${plugin.scope}:${plugin.packageName}`;
}

function statusHint(plugin: DiscoveredCliPlugin): string {
    switch (plugin.status) {
        case 'enabled':
            return withCommands('enabled', plugin);
        case 'not-enabled':
            return withCommands('not enabled', plugin);
        case 'failed':
            return plugin.reason ?? 'failed';
        default:
            return plugin.status;
    }
}

/** How many commands a hint can name beside the package on one line. */
const MAX_COMMANDS_IN_HINT = 6;

/**
 * The commands a package contributes, appended to its status so the picker
 * says what enabling or disabling it would change. Cut off at
 * {@link MAX_COMMANDS_IN_HINT}. `printTextList` writes the full list, which
 * has a line of its own.
 */
function withCommands(status: string, plugin: DiscoveredCliPlugin): string {
    const commands = cliPluginCommandNames(plugin);
    if (commands.length === 0) {
        return status;
    }
    const shown = commands.slice(0, MAX_COMMANDS_IN_HINT);
    const rest = commands.length - shown.length;
    const suffix = rest > 0 ? `, +${rest} more` : '';
    return `${status} — ${shown.join(', ')}${suffix}`;
}

function printTextList(plugins: DiscoveredCliPlugin[]): void {
    if (plugins.length === 0) {
        process.stdout.write('No CLI plugins discovered.\n');
        return;
    }
    for (const plugin of plugins) {
        const detail = plugin.status === 'failed' && plugin.reason ? ` — ${plugin.reason}` : '';
        process.stdout.write(`${plugin.packageName}\t${plugin.scope}\t${plugin.status}${detail}\n`);
        const commands = cliPluginCommandNames(plugin);
        if (commands.length > 0) {
            // Indented under its package, so each plugin's first line stays a
            // single tab-separated record for anything parsing this output.
            process.stdout.write(`\tcommands: ${commands.join(', ')}\n`);
        }
    }
}

function printJson(plugins: DiscoveredCliPlugin[]): void {
    process.stdout.write(
        `${JSON.stringify(
            {
                plugins: plugins.map(plugin => ({
                    packageName: plugin.packageName,
                    scope: plugin.scope,
                    status: plugin.status,
                    reason: plugin.reason,
                    entryPath: plugin.entryPath,
                    declaredCommands: plugin.declaredCommands,
                    loadedCommands: plugin.loadedCommands,
                })),
            },
            null,
            2,
        )}\n`,
    );
}
