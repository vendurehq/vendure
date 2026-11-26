import {
    applyCommandExtensions,
    commandDeclarations,
    CommandDefinition,
    CommandErrorBody,
    CommandErrorDefinition,
    CommandExtensionDefinition,
    extensionDeclarations,
    JsonSchema,
} from '@vendure/common/lib/command';
import {
    buildCommandManifest,
    CommandManifest,
    extendManifestCommand,
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
            const clash = findClash(plugin.manifest, plugin.packageName, taken);
            if (clash) {
                refused.push({ package: plugin.packageName, error: clash });
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

    // Extensions apply once every command is known, so a package may extend a command of a package
    // enabled after it. Each package's extensions apply together, or not at all.
    const commands = mergeManifests(accepted);
    for (const manifest of accepted) {
        if (!manifest.extensions?.length) {
            continue;
        }
        const extended = applyExtensions(manifest, commands, checkRegistration);
        if ('error' in extended) {
            refused.push({ package: manifest.package, error: extended.error });
            continue;
        }
        for (const command of extended.commands) {
            commands[commands.findIndex(other => sameCommand(other, command))] = command;
        }
    }

    const modules = new Map<string, Promise<unknown>>();
    const importModule = (source: string) => {
        const file = definitionsPaths.get(source);
        if (!file) {
            throw new Error(`No package "${source}" declares commands in this project`);
        }
        let loaded = modules.get(file);
        if (!loaded) {
            loaded = import(pathToFileURL(file).href);
            modules.set(file, loaded);
        }
        return { file, loaded };
    };
    const extensionsOf = async (command: MergedManifestCommand): Promise<CommandExtensionDefinition[]> => {
        const found: CommandExtensionDefinition[] = [];
        for (const { package: packageName } of command.extendedBy ?? []) {
            const { file, loaded } = importModule(packageName);
            const declared = await declarationsOf(file, loaded, extensionDeclarations);
            const match = declared.find(candidate => candidate.path.join(' ') === command.path.join(' '));
            if (!match) {
                throw new Error(
                    `${file}: the manifest lists an extension of "${command.path.join(' ')}", which the module does not export`,
                );
            }
            found.push(match);
        }
        return found;
    };

    return {
        commands,
        refused,
        loadDefinitions: async source => {
            // The CLI's own commands declare no groups, so they need no `commandDeclarations`.
            const definitions =
                source === CORE_SOURCE
                    ? (await import('./core-commands.js')).coreCommandDefinitions
                    : await (async () => {
                          const { file, loaded } = importModule(source);
                          return declarationsOf(file, loaded, commandDeclarations);
                      })();
            // A command that other packages extend runs with their extensions applied.
            return Promise.all(
                definitions.map(async definition => {
                    const command = commands.find(
                        candidate =>
                            candidate.source === source &&
                            candidate.path.join(' ') === definition.path.join(' '),
                    );
                    return command?.extendedBy?.length
                        ? applyCommandExtensions(definition, await extensionsOf(command))
                        : definition;
                }),
            );
        },
    };
}

function sameCommand(a: MergedManifestCommand, b: MergedManifestCommand): boolean {
    return a.path.join(' ') === b.path.join(' ');
}

/**
 * The commands a package's extensions change, with the extensions applied, or the coded error that
 * refuses them: a command that is not there, or a field, flag, consent or error code that is.
 */
function applyExtensions(
    manifest: CommandManifest,
    commands: MergedManifestCommand[],
    checkRegistration: ((commands: MergedManifestCommand[]) => void) | undefined,
): { commands: MergedManifestCommand[] } | { error: CommandErrorBody } {
    const plugin = manifest.package;
    const changed = new Map<string, MergedManifestCommand>();
    for (const extension of manifest.extensions ?? []) {
        const key = extension.path.join(' ');
        const target = changed.get(key) ?? commands.find(command => command.path.join(' ') === key);
        if (!target) {
            return { error: errorBody(hostErrors.pluginExtensionTargetMissing, { plugin, command: key }) };
        }
        if (target.extendedBy?.some(entry => entry.package === plugin)) {
            return {
                error: errorBody(hostErrors.pluginExtensionClash, {
                    plugin,
                    command: key,
                    reason: `${plugin} declares two extensions of it`,
                }),
            };
        }
        let extendedCommand: MergedManifestCommand;
        try {
            extendedCommand = extendManifestCommand(target, extension, plugin);
        } catch (e) {
            return {
                error: errorBody(hostErrors.pluginExtensionClash, {
                    plugin,
                    command: key,
                    reason: e instanceof Error ? e.message : String(e),
                }),
            };
        }
        changed.set(key, extendedCommand);
        // The rules of a command with commands under it hold for what an extension adds too.
        const reason = parentRuleBroken(
            extendedCommand,
            command => changed.get(command.path.join(' ')) ?? command,
            commands,
        );
        if (reason) {
            return { error: errorBody(hostErrors.pluginExtensionClash, { plugin, command: key, reason }) };
        }
    }
    const extended = [...changed.values()];
    try {
        // As for a package's commands: a flag Commander refuses, such as two fields with one flag name.
        checkRegistration?.(extended);
    } catch (e) {
        return {
            error: errorBody(hostErrors.pluginExtensionClash, {
                plugin,
                command: extended.map(command => command.path.join(' ')).join('", "'),
                reason: e instanceof Error ? e.message : String(e),
            }),
        };
    }
    return { commands: extended };
}

/**
 * Why an extended command breaks a rule of commands with commands under them, or undefined.
 * The command above may take no flag whose value could be the next command's name, and a flag that
 * a command and a command under it share must be declared the same way on both.
 */
function parentRuleBroken(
    extended: MergedManifestCommand,
    current: (command: MergedManifestCommand) => MergedManifestCommand,
    commands: MergedManifestCommand[],
): string | undefined {
    const key = extended.path.join(' ');
    const below = commands
        .filter(
            command => command.path.length > extended.path.length && startsWith(command.path, extended.path),
        )
        .map(current);
    const above = commands
        .filter(
            command => command.path.length < extended.path.length && startsWith(extended.path, command.path),
        )
        .map(current);
    if (below.length > 0) {
        const field = valueBeforeName(extended);
        if (field) {
            return `"${key}" has commands under it, so it takes no positional field and no flag with an optional value or a list, and the extension gives it ${field}`;
        }
    }
    for (const child of below) {
        const flag = sharedFlagConflict(extended, child);
        if (flag) {
            return `${flag} would be declared differently on "${key}" and on "${child.path.join(' ')}" under it`;
        }
    }
    for (const parent of above) {
        const flag = sharedFlagConflict(parent, extended);
        if (flag) {
            return `${flag} would be declared differently on "${parent.path.join(' ')}" and on "${key}" under it`;
        }
    }
    return undefined;
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
function findClash(
    manifest: CommandManifest,
    plugin: string,
    taken: TakenCommandPath[],
): CommandErrorBody | undefined {
    for (const command of manifest.commands) {
        const name = command.path.join(' ');
        const other = taken.find(
            entry =>
                (entry.leaf && startsWith(command.path, entry.path)) || startsWith(entry.path, command.path),
        );
        if (other) {
            return errorBody(hostErrors.pluginCommandClash, { plugin, command: name, other: other.owner });
        }
        for (const own of manifest.commands) {
            if (own === command) {
                continue;
            }
            if (own.path.join(' ') === name) {
                const duplicate = `another command "${name}" of ${plugin}`;
                return errorBody(hostErrors.pluginCommandClash, { plugin, command: name, other: duplicate });
            }
            if (!startsWith(own.path, command.path)) {
                continue;
            }
            const child = own.path.join(' ');
            const field = valueBeforeName(command);
            if (field) {
                return errorBody(hostErrors.pluginParentPositional, { plugin, command: name, child, field });
            }
            const flag = sharedFlagConflict(command, own);
            if (flag) {
                return errorBody(hostErrors.pluginParentFlagConflict, { plugin, command: name, child, flag });
            }
        }
    }
    return undefined;
}

/**
 * What of the command could take the name of a command under it as its value: a positional field,
 * or a flag that takes an optional value or a list. Undefined when there is none.
 */
function valueBeforeName(command: ManifestCommand): string | undefined {
    const positional = command.cli.positional?.[0];
    if (positional) {
        return `the positional field "${positional}"`;
    }
    const properties = (command.input.properties ?? {}) as Record<string, JsonSchema>;
    for (const [field, schema] of Object.entries(properties)) {
        const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
        if (takesOptionalValue(schema)) {
            return `the flag --${kebab(field)}, which takes an optional value`;
        }
        if (type === 'array') {
            return `the flag --${kebab(field)}, which takes a list`;
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
 * Reads a plugin's declarations module: its `commands`, with the shared input of its `groups`
 * applied, so the group fields the manifest lists reach `run()`, or its `extensions`.
 */
async function declarationsOf<T>(
    file: string,
    loaded: Promise<unknown>,
    read: (mod: unknown) => T,
): Promise<T> {
    const mod: unknown = await loaded;
    try {
        return read(mod);
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
