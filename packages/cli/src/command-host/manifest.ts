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

import {
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
 * of CLI plugins. Later loads, such as `vendure commands`, then refuse the same plugins that the
 * command line did.
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
     * Defaults to those recorded with {@link setCommanderPaths}.
     */
    takenPaths?: TakenCommandPath[];
    coreManifestFile?: string;
}

/**
 * Loads the commands of the current project: the CLI's own manifest, merged with the manifests of
 * the project's enabled plugins. It reads manifests only, and runs no plugin code.
 *
 * A plugin may add commands under a group that already exists, such as `cloud`, but never a
 * command whose path another package or a built-in command has, a command that would turn a
 * group into a command, or one under another package's command. Such a plugin is refused whole,
 * with a coded error, and the rest of the commands stay.
 */
export async function loadProjectCommands(
    options: LoadProjectCommandsOptions = {},
): Promise<ProjectCommands> {
    const core = await loadCoreManifest(options.coreManifestFile);
    const plugins = options.plugins ?? resolveCommandManifests(options.pluginOptions).manifests;
    return mergeProjectManifests(core, plugins, options.takenPaths ?? commanderPaths);
}

/**
 * Merges the CLI's manifest with the plugin manifests, in the order the plugins are enabled. See
 * {@link loadProjectCommands}.
 */
export function mergeProjectManifests(
    core: CommandManifest,
    plugins: ResolvedCommandManifest[],
    takenPaths: TakenCommandPath[] = [],
): ProjectCommands {
    const accepted: CommandManifest[] = [core];
    const definitionsPaths = new Map<string, string>();
    const refused: RefusedManifest[] = [];
    const taken: TakenCommandPath[] = [...takenPaths, ...pathsOf(core)];

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
        const clash = findClash(plugin.manifest, taken);
        if (clash) {
            refuse(hostErrors.pluginCommandClash, { plugin: plugin.packageName, ...clash });
            continue;
        }
        try {
            mergeManifests([...accepted, plugin.manifest]);
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
    for (const command of manifest.commands) {
        const other = taken.find(
            entry =>
                (entry.leaf && startsWith(command.path, entry.path)) || startsWith(entry.path, command.path),
        );
        if (other) {
            return { command: command.path.join(' '), other: other.owner };
        }
    }
    return undefined;
}

/**
 * Imports a plugin's declarations module. It exports its commands as `commands`, or as its
 * default export.
 */
async function importDefinitions(file: string): Promise<CommandDefinition[]> {
    const mod = (await import(pathToFileURL(file).href)) as {
        commands?: unknown;
        default?: { commands?: unknown } | unknown;
    };
    const defaultExport = mod.default;
    const commands =
        mod.commands ??
        (Array.isArray(defaultExport)
            ? defaultExport
            : (defaultExport as { commands?: unknown } | undefined)?.commands);
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
