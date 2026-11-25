import type {
    CommandDefinition,
    CommandErrorBody,
    CommandErrorDefinition,
} from '@vendure/common/lib/command';
import {
    buildCommandManifest,
    CommandManifest,
    MANIFEST_FILE_NAME,
    MergedManifestCommand,
    mergeManifests,
    readManifestFile,
} from '@vendure/common/lib/command/manifest';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { RESERVED_COMMANDS } from '../shared/command-registry-store.js';
import {
    failureAffectsCommandManifest,
    ResolveCliPluginsOptions,
    resolveCommandManifests,
    ResolvedCommandManifest,
} from '../shared/resolve-cli-plugins.js';

import { hostErrors } from './host-errors.js';
import { errorBody } from './host.js';

/** The package name the CLI's own commands have as their `source`. */
export const CORE_SOURCE = '@vendure/cli';

/**
 * Finds the manifest that ships with the CLI package. This file is in `dist/command-host`, and
 * the build writes the manifest to `dist`.
 */
export function coreManifestPath(): string {
    return path.join(import.meta.dirname, '..', MANIFEST_FILE_NAME);
}

/**
 * Loads the manifest of the CLI's own commands.
 *
 * `build` writes the CLI's manifest, but `watch` does not. Without the file, the manifest is built
 * from the declarations instead, which loads their schemas and is slower.
 */
export async function loadCoreManifest(
    coreManifestFile: string = coreManifestPath(),
): Promise<CommandManifest> {
    if (fs.existsSync(coreManifestFile)) {
        return readManifestFile(coreManifestFile);
    }
    const { coreCommandDefinitions } = await import('./core-commands.js');
    const { name, version } = JSON.parse(
        fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'package.json'), 'utf-8'),
    ) as { name: string; version: string };
    return buildCommandManifest(name, version, coreCommandDefinitions);
}

/** A plugin whose commands the host left out, and why. */
export interface RefusedManifest {
    package: string;
    error: CommandErrorBody;
}

/** A command path that is already on the command line, from a manifest or a Commander command. */
export interface TakenCommandPath {
    path: string[];
    /** Who declared it, for example `the built-in command "dev"`. */
    owner: string;
    /** A command that runs, as opposed to a group that only holds commands. */
    leaf: boolean;
}

/** The commands of a project: the CLI's own and those of its enabled plugins. */
export interface ProjectCommands {
    commands: MergedManifestCommand[];
    /** Enabled plugins whose commands were left out, each with a coded error. */
    refused: RefusedManifest[];
    /** Imports the declarations of the package that declared a command. */
    loadDefinitions(source: string): Promise<CommandDefinition[]>;
}

let commanderPaths: TakenCommandPath[] = [];

/**
 * Records the paths that Commander commands take in this process: the built-in commands and those
 * of CLI plugins. `cli.ts` calls it once, before it registers the manifest commands. Later loads in
 * the same process, such as `vendure commands` and `vendure mcp`, then refuse the same plugins that
 * the command line did. Commander's commands are only known after the `cliPlugin` modules have
 * run, which is why they are recorded rather than worked out again.
 */
export function setCommanderPaths(paths: TakenCommandPath[]): void {
    commanderPaths = paths;
}

export interface LoadProjectCommandsOptions {
    /** Where to resolve the project's plugins from. Defaults to the working directory. */
    pluginOptions?: ResolveCliPluginsOptions;
    /** The plugin manifests, when the caller has resolved them already. */
    plugins?: ResolvedCommandManifest[];
    /**
     * Paths the Commander commands already take, such as `dev` and the commands of CLI plugins.
     * Defaults to those recorded with {@link setCommanderPaths}, which is an empty list in a process
     * that did not start through `cli.ts`, such as a test.
     */
    takenPaths?: TakenCommandPath[];
    coreManifestFile?: string;
    /** The CLI's own manifest, when the caller has loaded it already. */
    core?: CommandManifest;
}

/**
 * Loads the commands of the current project: the CLI's own manifest, merged with the manifests of
 * the project's enabled plugins. It reads manifests only, and runs no plugin code.
 *
 * A plugin may add commands under a group that already exists, such as `cloud`, but never a
 * command whose path another package or a built-in command has, a command that would turn a
 * group into a command, or one under another package's command. The Commander commands of a
 * `cliPlugin` count, the package's own included. All the `defineCommand` commands of such a
 * plugin are refused, with a coded error, and the rest of the commands stay. Its `cliPlugin`
 * commands follow their own collision rules.
 */
export async function loadProjectCommands(
    options: LoadProjectCommandsOptions = {},
): Promise<ProjectCommands> {
    const core = options.core ?? (await loadCoreManifest(options.coreManifestFile));
    if (options.plugins) {
        return mergeProjectManifests(
            core,
            options.plugins,
            options.takenPaths ?? commanderPaths,
            await registrationCheck(),
        );
    }
    const { manifests, failures } = resolveCommandManifests(options.pluginOptions);
    const merged = mergeProjectManifests(
        core,
        manifests,
        options.takenPaths ?? commanderPaths,
        await registrationCheck(),
    );
    // A package that failed to resolve has no manifest to merge, and its commands are left out too.
    const unavailable = failures.filter(failureAffectsCommandManifest).map(failure => ({
        package: failure.packageName,
        error: errorBody(
            failure.failedPart === 'manifest-invalid'
                ? hostErrors.pluginManifestInvalid
                : hostErrors.pluginUnavailable,
            { plugin: failure.packageName, reason: failure.reason },
        ),
    }));
    return { ...merged, refused: [...unavailable, ...merged.refused] };
}

/**
 * Merges the CLI's manifest with the plugin manifests, in the order the plugins are enabled. See
 * {@link loadProjectCommands}.
 */
export function mergeProjectManifests(
    core: CommandManifest,
    plugins: ResolvedCommandManifest[],
    takenPaths: TakenCommandPath[] = [],
    checkRegistration?: (commands: MergedManifestCommand[]) => void,
): ProjectCommands {
    const accepted: CommandManifest[] = [core];
    const definitionsPaths = new Map<string, string>();
    const refused: RefusedManifest[] = [];
    const corePaths = pathsOf(core);
    // Built-in Commander commands such as `add` and `migrate` hold the CLI's own manifest commands,
    // so they are groups that a plugin may add to.
    const taken: TakenCommandPath[] = [
        ...takenPaths.map(entry =>
            entry.leaf &&
            corePaths.some(
                other => other.path.length > entry.path.length && startsWith(other.path, entry.path),
            )
                ? { ...entry, leaf: false }
                : entry,
        ),
        ...corePaths,
        // Commander adds `help` itself, so it is not among the Commander paths.
        ...RESERVED_COMMANDS.map(name => ({
            path: [name],
            owner: `the reserved command "${name}"`,
            leaf: true,
        })),
    ];

    for (const plugin of plugins) {
        const refuse = <Details>(error: CommandErrorDefinition<Details>, details: Details) =>
            refused.push({ package: plugin.packageName, error: errorBody(error, details) });
        if (plugin.packageName === CORE_SOURCE || definitionsPaths.has(plugin.packageName)) {
            refuse(hostErrors.pluginManifestInvalid, {
                plugin: plugin.packageName,
                reason: 'its commands are already loaded',
            });
            continue;
        }
        // A manifest is input from another package, so nothing about it may stop the CLI's own
        // commands from loading: any problem refuses this package's commands alone.
        try {
            const clash = findClash(plugin.manifest, taken);
            if (clash) {
                refuse(hostErrors.pluginCommandClash, { plugin: plugin.packageName, ...clash });
                continue;
            }
            mergeManifests([...accepted, plugin.manifest]);
            // Commander refuses some flags the merge rules allow, such as two fields that share a
            // flag name. Registering the commands on a command line of their own finds them here,
            // so they refuse this package instead of breaking the command line for everyone.
            checkRegistration?.(
                plugin.manifest.commands.map(command => ({ ...command, source: plugin.packageName })),
            );
        } catch (e) {
            refuse(hostErrors.pluginManifestInvalid, {
                plugin: plugin.packageName,
                reason: e instanceof Error ? e.message : String(e),
            });
            continue;
        }
        accepted.push(plugin.manifest);
        taken.push(...pathsOf(plugin.manifest));
        definitionsPaths.set(plugin.packageName, plugin.definitionsPath);
    }

    return {
        commands: mergeManifests(accepted),
        refused,
        loadDefinitions: async source => {
            if (source === CORE_SOURCE) {
                return (await import('./core-commands.js')).coreCommandDefinitions;
            }
            const file = definitionsPaths.get(source);
            if (!file) {
                throw new Error(`No package "${source}" declares commands in this project`);
            }
            return importDefinitions(file);
        },
    };
}

/** Registers commands on a command line of their own, which throws where Commander refuses them. */
async function registrationCheck(): Promise<(commands: MergedManifestCommand[]) => void> {
    const [{ Command }, { registerManifestCommands }] = await Promise.all([
        import('commander'),
        import('./commander-adapter.js'),
    ]);
    return commands => registerManifestCommands(new Command(), commands, { loadDefinitions: async () => [] });
}

/** The commands of a manifest, and the groups that hold them. */
function pathsOf(manifest: CommandManifest): TakenCommandPath[] {
    const owner = (command: string[]) => `the command "${command.join(' ')}" of ${manifest.package}`;
    const paths: TakenCommandPath[] = [];
    for (const command of manifest.commands) {
        paths.push({ path: command.path, owner: owner(command.path), leaf: true });
        for (let length = 1; length < command.path.length; length++) {
            const group = command.path.slice(0, length);
            paths.push({ path: group, owner: owner(command.path), leaf: false });
        }
    }
    return paths;
}

function startsWith(commandPath: string[], prefix: string[]): boolean {
    return (
        prefix.length <= commandPath.length &&
        prefix.every((segment, index) => commandPath[index] === segment)
    );
}

/**
 * The first command of a manifest that clashes with a path already taken: the same path, a path
 * that holds a taken command, or a path under a taken command. Paths under a taken group are fine.
 */
function findClash(
    manifest: CommandManifest,
    taken: TakenCommandPath[],
): { command: string; other: string } | undefined {
    // The package's own commands count too, so it cannot declare both `acme` and `acme sync`.
    const seen = [...taken];
    for (const command of manifest.commands) {
        const other = seen.find(
            entry =>
                (entry.leaf && startsWith(command.path, entry.path)) || startsWith(entry.path, command.path),
        );
        if (other) {
            return { command: command.path.join(' '), other: other.owner };
        }
        seen.push(...pathsOf({ ...manifest, commands: [command] }));
    }
    return undefined;
}

/**
 * Imports a plugin's declarations module, which exports its commands as `commands`. A CommonJS
 * module's exports can arrive as the default export of the import, so `default.commands` is read
 * too.
 */
async function importDefinitions(file: string): Promise<CommandDefinition[]> {
    const mod = (await import(pathToFileURL(file).href)) as {
        commands?: unknown;
        default?: { commands?: unknown };
    };
    const commands = mod.commands ?? mod.default?.commands;
    if (!Array.isArray(commands)) {
        throw new Error(`${file} does not export its commands as "commands"`);
    }
    return commands as CommandDefinition[];
}

/** The merged manifest for the project at the working directory. */
export async function loadMergedManifest(
    options: LoadProjectCommandsOptions = {},
): Promise<MergedManifestCommand[]> {
    return (await loadProjectCommands(options)).commands;
}
