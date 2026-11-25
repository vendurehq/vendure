import {
    commandDeclarations,
    CommandDefinition,
    CommandErrorBody,
    CommandErrorDefinition,
    JsonSchema,
} from '@vendure/common/lib/command';
import {
    buildCommandManifest,
    CommandManifest,
    MANIFEST_FILE_NAME,
    ManifestCommand,
    MergedManifestCommand,
    mergeManifests,
    readManifestFile,
    takesOptionalValue,
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
import { kebab } from './naming.js';

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
            if (clash?.kind === 'parent-gap') {
                refuse(hostErrors.pluginParentGap, {
                    plugin: plugin.packageName,
                    command: clash.command,
                    child: clash.child,
                    missing: clash.missing,
                });
                continue;
            }
            if (clash?.kind === 'parent-flag-conflict') {
                refuse(hostErrors.pluginParentFlagConflict, {
                    plugin: plugin.packageName,
                    command: clash.command,
                    child: clash.child,
                    flag: clash.flag,
                });
                continue;
            }
            if (clash?.kind === 'parent-positional') {
                refuse(hostErrors.pluginParentPositional, {
                    plugin: plugin.packageName,
                    command: clash.command,
                    child: clash.child,
                });
                continue;
            }
            if (clash) {
                refuse(hostErrors.pluginCommandClash, {
                    plugin: plugin.packageName,
                    command: clash.command,
                    other: clash.other,
                });
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
            // The CLI's own commands declare no groups, so they need no `commandDeclarations`.
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
 *
 * A package may declare a command and commands under it, such as `acme deploy` and
 * `acme deploy plan`, when the command above takes no positional fields: a positional value could
 * otherwise be taken for the name of a command under it, and when a flag they share is declared the
 * same way on both: Commander reads the flags of the command above first, with its declaration.
 * Another package may not add to either.
 */
function findClash(
    manifest: CommandManifest,
    taken: TakenCommandPath[],
):
    | { kind: 'clash'; command: string; other: string }
    | { kind: 'parent-positional'; command: string; child: string }
    | { kind: 'parent-flag-conflict'; command: string; child: string; flag: string }
    | { kind: 'parent-gap'; command: string; child: string; missing: string }
    | undefined {
    const ownPaths = new Set(manifest.commands.map(command => command.path.join(' ')));
    for (const command of manifest.commands) {
        const name = command.path.join(' ');
        const other = taken.find(
            entry =>
                (entry.leaf && startsWith(command.path, entry.path)) || startsWith(entry.path, command.path),
        );
        if (other) {
            return { kind: 'clash', command: name, other: other.owner };
        }
        for (const own of manifest.commands) {
            if (own === command) {
                continue;
            }
            if (own.path.join(' ') === name) {
                return {
                    kind: 'clash',
                    command: name,
                    other: `another command "${name}" of ${manifest.package}`,
                };
            }
            if (startsWith(own.path, command.path) && command.cli.positional?.length) {
                return { kind: 'parent-positional', command: name, child: own.path.join(' ') };
            }
            // Every path between a command and a command under it is a command of the package too.
            // A group there would take no options, so the options of the command above could not
            // reach the command under it.
            if (startsWith(own.path, command.path)) {
                for (let length = command.path.length + 1; length < own.path.length; length++) {
                    const between = own.path.slice(0, length).join(' ');
                    if (!ownPaths.has(between)) {
                        return {
                            kind: 'parent-gap',
                            command: name,
                            child: own.path.join(' '),
                            missing: between,
                        };
                    }
                }
            }
            const flag = startsWith(own.path, command.path) ? sharedFlagConflict(command, own) : undefined;
            if (flag) {
                return { kind: 'parent-flag-conflict', command: name, child: own.path.join(' '), flag };
            }
        }
    }
    return undefined;
}

/** How a command declares each of its flags, by flag: the long flags and the short ones. */
function flagDeclarations(command: ManifestCommand): Map<string, string> {
    const flags = new Map<string, string>();
    const properties = (command.input.properties ?? {}) as Record<string, JsonSchema>;
    for (const [field, schema] of Object.entries(properties)) {
        const long = `--${kebab(field)}`;
        const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
        const declaration = JSON.stringify({
            field,
            // The kind of value the flag takes. A placeholder is only a label, so it does not count.
            value: takesOptionalValue(schema)
                ? 'optional'
                : type === 'boolean'
                  ? 'switch'
                  : type === 'array'
                    ? 'list'
                    : 'value',
            type: schema.type,
            items: (schema.items as JsonSchema | undefined)?.type,
            enum: schema.enum,
        });
        flags.set(long, declaration);
        const short = command.cli.flags?.[field]?.short;
        if (short) {
            flags.set(short, declaration);
        }
    }
    return flags;
}

/**
 * A flag that a command and a command under it both have, declared differently, such as
 * `--target <a|b>` and `--target <c|d>`, or `-e` for two fields. Undefined when there is none.
 */
function sharedFlagConflict(parent: ManifestCommand, child: ManifestCommand): string | undefined {
    const parentFlags = flagDeclarations(parent);
    for (const [flag, declaration] of flagDeclarations(child)) {
        const other = parentFlags.get(flag);
        if (other !== undefined && other !== declaration) {
            return flag;
        }
    }
    return undefined;
}

/**
 * Imports a plugin's declarations module: its `commands`, with the shared input of its `groups`
 * applied, so the group fields the manifest lists reach `run()`.
 */
async function importDefinitions(file: string): Promise<CommandDefinition[]> {
    const mod: unknown = await import(pathToFileURL(file).href);
    try {
        return commandDeclarations(mod);
    } catch (e) {
        // The original error, with its stack, stays reachable as `cause`.
        throw Object.assign(new Error(`${file}: ${e instanceof Error ? e.message : String(e)}`), {
            cause: e,
        });
    }
}

/** The merged manifest for the project at the working directory. */
export async function loadMergedManifest(
    options: LoadProjectCommandsOptions = {},
): Promise<MergedManifestCommand[]> {
    return (await loadProjectCommands(options)).commands;
}
