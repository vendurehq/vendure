#! /usr/bin/env node

import { Command } from 'commander';
import { createRequire } from 'node:module';
import pc from 'picocolors';

import type { CommandManifest, MergedManifestCommand } from '@vendure/common/lib/command/manifest';
import { recordStartupEnvironment } from './auth/startup-environment.js';
import { registerManifestCommands } from './command-host/commander-adapter.js';
import {
    CORE_SOURCE,
    describeRefusal,
    loadCoreManifest,
    loadProjectCommands,
    setCommanderPaths,
    TakenCommandPath,
} from './command-host/manifest.js';
import { builtinCommandDefs } from './commands/builtins.js';
import { CommandRegistry } from './shared/command-registry-store.js';
import { pluginFromCommandsHeading, registerCommands, styleHelpTitle } from './shared/command-registry.js';
import { setPluginExtensionAccessor, setPluginProjectRoot } from './shared/plugin-extensions.js';
import { PROJECT_DIR_FLAG, selectsPluginProject } from './shared/project-dir-flag.js';
import {
    CliPluginScopeError,
    CliPluginScopeKind,
    listInactiveCliPluginPackages,
    pluginsCommandFor,
    resolveCliPlugins,
    ResolveCliPluginsOptions,
} from './shared/resolve-cli-plugins.js';
import { PluginFailureStep, unknownCommandHelp } from './shared/unknown-command-help.js';

async function main(): Promise<void> {
    // Before anything can load a project's `.env` file into the environment.
    recordStartupEnvironment();
    const program = new Command();

    const version = createRequire(import.meta.url)('../package.json').version;

    program
        // Commander otherwise names the program after the binary file
        // (`cli.js`), which would make every subcommand's help say `cli ...`.
        .name('vendure')
        .version(version)
        .usage(`<command>`)
        .description(
            pc.blue(`
                                888                          
                                888                          
                                888                          
888  888  .d88b.  88888b.   .d88888 888  888 888d888 .d88b.  
888  888 d8P  Y8b 888 "88b d88" 888 888  888 888P"  d8P  Y8b 
Y88  88P 88888888 888  888 888  888 888  888 888    88888888 
 Y8bd8P  Y8b.     888  888 Y88b 888 Y88b 888 888    Y8b.     
  Y88P    "Y8888  888  888  "Y88888  "Y88888 888     "Y8888                             
`),
        );

    // Shared options are declared once on the command that owns them, so
    // subcommand help needs Commander's "Global Options" section to be
    // complete. Commander copies the help configuration into each subcommand as
    // it is created, so this must be set first.
    program.configureHelp({ showGlobalOptions: true, styleTitle: styleHelpTitle });
    // Only on the top-level help, which is where an agent looks first.
    program.addHelpText(
        'after',
        '\nAgents: run "vendure guide" for how to use this CLI, --json and the Developer MCP.',
    );

    const registry = new CommandRegistry();
    registry.registerAll(builtinCommandDefs);
    // Loaded once: the registry needs its paths, and so does the merge below.
    let coreManifest: CommandManifest | undefined;
    try {
        coreManifest = await loadCoreManifest();
        registry.setHostDeclaredCommands(
            coreManifest.commands.map(command => command.path),
            process.argv.slice(2),
        );
    } catch {
        // Without the manifest, an extension of a host command is a registration conflict, which
        // refuses the whole plugin.
    }

    // A broken plugin must not take down the CLI: built-ins (including the
    // `plugins` command needed to disable it) stay available.
    // `vendure dev` and `vendure console` select a project directory, whose plugins are the ones
    // loaded, such as a plugin that replaces `dev`. Read it before loading plugins, and parse the
    // full command only after they have been registered.
    const pluginOptions: ResolveCliPluginsOptions = {};
    const selection = new Command().allowUnknownOption().exitOverride();
    if (selectsPluginProject(process.argv.slice(2))) {
        // Only the flag selects the plugins' project. A `dir` inside `--input` is read once the
        // plugins are loaded, so a caller that passes the input that way passes the flag too, as
        // the Developer MCP does.
        selection.option(`${PROJECT_DIR_FLAG} <dir>`);
        selection.parseOptions(process.argv.slice(3));
        pluginOptions.project = selection.opts<{ dir?: string }>().dir;
        pluginOptions.projectFlag = PROJECT_DIR_FLAG;
    }
    const { loaded, manifests, failures, scopeErrors, projectRoot } = resolveCliPlugins(pluginOptions);
    // The project the plugins came from, so a command that works on another one can say so.
    setPluginProjectRoot(projectRoot);
    for (const scopeError of scopeErrors) {
        writeScopeError(scopeError);
    }
    // A globally enabled package that is not installed is normal in a project
    // that does not use it, so it is reported only when an unknown command
    // could be one of its own.
    const notInstalledGlobally = failures.filter(
        failure => failure.scope === 'global' && failure.notInstalled,
    );
    const reportedFailures = failures.filter(failure => !notInstalledGlobally.includes(failure));
    // Enabled packages whose commands are missing for a reason already printed.
    const unavailablePackages = new Map<string, PluginFailureStep>(
        reportedFailures.map(failure => [failure.packageName, 'load']),
    );
    for (const failure of reportedFailures) {
        const headline =
            failure.failedPart === 'manifest-missing' || failure.failedPart === 'manifest-invalid'
                ? 'Failed to load the defineCommand commands of CLI plugin'
                : 'Failed to load CLI plugin';
        writePluginSkipped(failure.packageName, headline, failure.reason, failure.scope);
    }
    for (const { packageName, plugin, scope } of loaded) {
        try {
            registry.applyPlugin(plugin);
        } catch (e) {
            const reason = e instanceof Error ? e.message : String(e);
            unavailablePackages.set(packageName, 'register');
            writePluginSkipped(packageName, 'Failed to register CLI plugin', reason, scope);
        }
    }

    registerCommands(program, registry.getCommandTree(), {
        rootOptions: registry.getRootOptions(),
        getPluginExtensions: extensionPoint => registry.getPluginExtensions(extensionPoint),
    });
    // For the commands declared with `defineCommand`, such as `vendure console link`, which runs
    // the plugins' `afterConsoleLink` hooks.
    setPluginExtensionAccessor(extensionPoint => registry.getPluginExtensions(extensionPoint));

    // Commands declared with `defineCommand` are built from the manifests alone: the CLI's own and
    // those of the enabled plugins. Their declarations load only when one of them runs.
    try {
        setCommanderPaths(commanderPaths(program));
        const projectCommands = await loadProjectCommands({ plugins: manifests, core: coreManifest });
        for (const refusal of projectCommands.refused) {
            const { package: packageName, error } = refusal;
            const { headline, skipped } = describeRefusal(refusal);
            if (!skipped) {
                // Only its extensions were left out: its own commands still work.
                process.stderr.write(
                    pc.red(`${headline} "${packageName}": [${error.code}] ${error.message}\n`),
                );
                continue;
            }
            unavailablePackages.set(packageName, 'register');
            const scope =
                manifests.find(manifest => manifest.packageName === packageName)?.scope ?? 'project';
            writePluginSkipped(packageName, headline, `[${error.code}] ${error.message}`, scope);
        }
        const loadDefinitions = (source: string) => projectCommands.loadDefinitions(source);
        const loadCommand = (command: MergedManifestCommand) => projectCommands.loadCommand(command);
        // The CLI's own commands first, then each plugin's on its own, so that a plugin whose
        // commands Commander refuses cannot take the rest of the command line with it. The merge has
        // already checked them, so this is a last resort.
        const sources = [...new Set(projectCommands.commands.map(command => command.source))];
        for (const source of sources) {
            const commands = projectCommands.commands.filter(command => command.source === source);
            try {
                registerManifestCommands(program, commands, { loadDefinitions, loadCommand });
            } catch (e) {
                if (source === CORE_SOURCE) {
                    throw e;
                }
                unavailablePackages.set(source, 'register');
                const scope = manifests.find(manifest => manifest.packageName === source)?.scope ?? 'project';
                const reason = e instanceof Error ? e.message : String(e);
                writePluginSkipped(
                    source,
                    'Failed to register the defineCommand commands of CLI plugin',
                    reason,
                    scope,
                );
            }
        }
    } catch (e) {
        process.stderr.write(
            `Could not load the command manifest: ${e instanceof Error ? e.message : String(e)}\n`,
        );
    }

    program.on('command:*', operands => {
        const unknown = operands[0] ?? '';
        for (const line of unknownCommandHelp(
            unknown,
            pluginOptions,
            unavailablePackages,
            notInstalledGlobally,
        )) {
            process.stderr.write(`${line}\n`);
        }
        process.exit(1);
    });

    maybeWriteInactivePluginsHint(process.argv, pluginOptions);

    await program.parseAsync(process.argv);
}

/**
 * The paths of the commands registered with Commander so far: the built-in commands and those of
 * CLI plugins. A command with subcommands is a group, which a plugin's manifest may add to. So is
 * a command that the CLI's own manifest adds to, such as `add`, which the merge decides.
 */
function commanderPaths(program: Command): TakenCommandPath[] {
    const paths: TakenCommandPath[] = [];
    // Only a plugin's top-level commands carry its help heading.
    const visit = (command: Command, parent: string[], parentPlugin?: string) => {
        for (const child of command.commands) {
            const path = [...parent, child.name()];
            const plugin = parentPlugin ?? pluginFromCommandsHeading(child.helpGroup());
            paths.push({
                path,
                owner: plugin
                    ? `the command "${path.join(' ')}" of ${plugin}`
                    : `the built-in command "${path.join(' ')}"`,
                leaf: child.commands.length === 0,
            });
            visit(child, path, plugin);
        }
    };
    visit(program, []);
    return paths;
}

/**
 * Reports a plugin scope the CLI could not use. An ambiguous project never
 * supplies a member allowlist.
 */
function writeScopeError({ scope, origin, reason }: CliPluginScopeError): void {
    process.stderr.write(pc.red(`${reason}\n`));
    if (scope === 'project') {
        process.stderr.write(
            'No project CLI plugins were loaded. Run from a project directory or use dev --dir <dir>.\n',
        );
    } else {
        process.stderr.write(
            `No CLI plugins were loaded from it. Fix ${origin}, or delete it to start over.\n`,
        );
    }
}

/**
 * Reports a plugin the CLI could not use, and how to disable it. Built-ins stay
 * registered either way, so `vendure plugins remove` remains reachable.
 *
 * The suggested command names the scope the plugin was enabled in, because
 * removing it from the other one would report that it was never enabled there
 * and leave the broken plugin in place.
 */
function writePluginSkipped(
    packageName: string,
    headline: string,
    reason: string,
    scope: CliPluginScopeKind,
): void {
    process.stderr.write(pc.red(`${headline} "${packageName}": ${reason}\n`));
    process.stderr.write(
        `Skipping it. Fix the issue or disable it with: ${pluginsCommandFor('remove', packageName, scope)}\n`,
    );
}

/**
 * Arguments and command names that mean the user is orienting themselves
 * rather than running a command, so the inactive-plugins hint would be noise.
 * Local to this file: they overlap the registry's reserved lists today, but
 * answer a different question and should not move when those change.
 */
const HINT_SUPPRESSING_ARGS = new Set(['--help', '-h', '--version', '-V']);
const HINT_SUPPRESSING_COMMANDS = new Set(['plugins', 'help']);

/**
 * One-line hint when packages declare CLI plugins but are not enabled yet.
 * Skipped for `vendure plugins` itself and for `--help` / `--version`.
 */
function maybeWriteInactivePluginsHint(argv: string[], options: ResolveCliPluginsOptions): void {
    const args = argv.slice(2);
    if (args.length === 0) {
        return;
    }
    const primary = args.find(arg => !arg.startsWith('-'));
    if (
        (primary && HINT_SUPPRESSING_COMMANDS.has(primary)) ||
        args.some(arg => HINT_SUPPRESSING_ARGS.has(arg))
    ) {
        return;
    }

    const inactive = listInactiveCliPluginPackages(options);
    if (inactive.length === 0) {
        return;
    }

    const noun = inactive.length === 1 ? 'package provides' : 'packages provide';
    process.stderr.write(`${inactive.length} ${noun} CLI commands. Run "vendure plugins" to review them.\n`);
}

void main().catch((e: unknown) => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
});
