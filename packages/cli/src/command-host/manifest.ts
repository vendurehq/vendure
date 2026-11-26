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
            if (clash) {
                refused.push({ package: plugin.packageName, error: clash(plugin.packageName) });
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
 * The first command of a manifest that clashes with a path already taken, as the error to refuse the
 * package with. A clash is the same path, a path that holds a taken command, or a path under a
 * taken command. Paths under a taken group are fine.
 *
 * A package may also declare a command and commands under it, such as `acme deploy` and
 * `acme deploy plan`, with two conditions:
 * - The command above takes no positional fields, and no flag that takes an optional value or a
 *   list, such as `--wait [value]` or `--tags <tag...>`. A value of either could otherwise be the
 *   name of a command under it: `acme deploy --wait plan` would run `acme deploy`.
 * - A flag they share is declared the same way on both. Commander reads it with the declaration of
 *   the command above.
 *
 * Another package may not add to either.
 */
function findClash(manifest: CommandManifest, taken: TakenCommandPath[]): RefusedClash | undefined {
    for (const command of manifest.commands) {
        const name = command.path.join(' ');
        const other = taken.find(
            entry =>
                (entry.leaf && startsWith(command.path, entry.path)) || startsWith(entry.path, command.path),
        );
        if (other) {
            return plugin =>
                errorBody(hostErrors.pluginCommandClash, { plugin, command: name, other: other.owner });
        }
        for (const own of manifest.commands) {
            if (own === command) {
                continue;
            }
            if (own.path.join(' ') === name) {
                const duplicate = `another command "${name}" of ${manifest.package}`;
                return plugin =>
                    errorBody(hostErrors.pluginCommandClash, { plugin, command: name, other: duplicate });
            }
            if (!startsWith(own.path, command.path)) {
                continue;
            }
            const child = own.path.join(' ');
            if (command.cli.positional?.length || takesValueBeforeName(command)) {
                return plugin =>
                    errorBody(hostErrors.pluginParentPositional, { plugin, command: name, child });
            }
            const flag = sharedFlagConflict(command, own);
            if (flag) {
                return plugin =>
                    errorBody(hostErrors.pluginParentFlagConflict, { plugin, command: name, child, flag });
            }
        }
    }
    return undefined;
}

/** A refusal of a package's commands, as the error body for the package of the given name. */
type RefusedClash = (plugin: string) => CommandErrorBody;

/** Whether a flag of the command takes an optional value or a list, which can take the next word. */
function takesValueBeforeName(command: ManifestCommand): boolean {
    const properties = (command.input.properties ?? {}) as Record<string, JsonSchema>;
    return Object.values(properties).some(schema => {
        const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
        return takesOptionalValue(schema) || type === 'array';
    });
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
