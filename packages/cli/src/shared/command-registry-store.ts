import pc from 'picocolors';

import {
    CliCommandArgument,
    CliCommandDefinition,
    CliCommandExtension,
    CliCommandNode,
    CliCommandOption,
    CliCommandParent,
    hasCliSubcommands,
    isCliCommandGroup,
    isRunnableCliCommand,
} from './cli-command-definition.js';
import { describeOption, ParsedCliOption, parseOptionFlags, withSubOptions } from './cli-command-options.js';
import { RegisteredCliPluginExtension } from './cli-plugin-extension.js';
import { CliPlugin, getCliPluginExtensionEntries, normalizeCommandPath } from './cli-plugin.js';

/**
 * Why a flag cannot be shared by a command that has subcommands and by
 * something above or below it.
 */
const SUBTREE_SHARING_EXPLANATION =
    'A command with subcommands shares its options with all of them, so the same flag cannot be ' +
    'shared at two levels.';

/**
 * Flags the CLI host owns. A plugin that took one of these would break
 * `vendure --help`, which is how a user recovers from a bad plugin.
 */
export const RESERVED_FLAGS = ['--help', '-h', '--version', '-V'];

/**
 * Commands the CLI host owns. `plugins` is how a user disables a plugin that
 * misbehaves and `help` is how they find it, so no plugin may declare or
 * extend either. Commander adds `help` implicitly, so the registry would not
 * otherwise see a collision.
 */
const RESERVED_COMMAND_REASONS: Record<string, string> = {
    plugins: 'it is how a plugin is disabled',
    help: 'it is how a user finds their way out of a broken plugin',
};

export const RESERVED_COMMANDS = Object.keys(RESERVED_COMMAND_REASONS);

function reservedCommandConflict(name: string): string {
    return `Command "${name}" is reserved by the CLI, because ${RESERVED_COMMAND_REASONS[name]}.`;
}

/**
 * A top-level built-in command, as the CLI host receives it, with the
 * extensions of the CLI plugins applied.
 */
export interface CommandTreeEntry {
    node: CliCommandNode;
}

/**
 * A shared option and the plugin that registered it. `source` is undefined for
 * one the CLI itself declares.
 */
export interface RootOptionEntry {
    option: CliCommandOption;
    source?: string;
}

interface RegisteredCommand {
    node: CliCommandNode;
    /**
     * Plugins that have extended this command, in the order they were applied, innermost first.
     * `MergedManifestCommand.extendedBy` lists the extensions of a manifest command the other way
     * round, outermost first.
     */
    extendedBy: string[];
    /**
     * Plugin whose extension last set the description, keyed by the command
     * path it set. A tree holds several commands, so ownership cannot be
     * recorded against the tree as a whole.
     */
    describedBy: Record<string, string>;
}

interface RegisteredOption {
    option: CliCommandOption;
    source?: string;
    /**
     * True for an entry that came from a parent's `subOptions`. Kept in the map
     * so collision lookups see it, but left out of {@link CommandRegistry.getRootOptions}
     * because the parent already carries it and the host expands it once.
     */
    isSubOption: boolean;
}

interface RegistryState {
    commands: Map<string, RegisteredCommand>;
    rootOptions: Map<string, RegisteredOption>;
    /** Ids of the plugins applied so far. One plugin, one id. */
    pluginIds: Set<string>;
    pluginExtensions: Map<string, RegisteredCliPluginExtension[]>;
}

/**
 * Thrown when a plugin's extensions or shared options would collide
 * with what is already registered. The CLI host reports it and skips that
 * plugin, so one plugin cannot make the rest of the CLI unusable.
 */
export class CliPluginRegistrationError extends Error {
    constructor(readonly conflicts: string[]) {
        const heading = conflicts.length === 1 ? 'Conflict' : 'Conflicts';
        const bullets = conflicts.map(conflict => `  - ${conflict}`).join('\n');
        super(`${heading}:\n${bullets}`);
        this.name = 'CliPluginRegistrationError';
    }
}

/**
 * In-memory registry of the built-in commands and the options shared by all of
 * them. Built-in commands are registered first and plugins are applied on top,
 * in activation order. A plugin adds shared options and extends the built-in
 * commands. Its own commands are `defineCommand` commands, which the command
 * manifest adds.
 */
export class CommandRegistry {
    private state: RegistryState = {
        commands: new Map(),
        rootOptions: new Map(),
        pluginIds: new Set(),
        pluginExtensions: new Map(),
    };
    /** Paths of the commands the CLI declares with `defineCommand`, which `extendCommands` cannot reach. */
    private hostCommands = new Set<string>();
    /** The arguments of this run, so a skipped extension is reported only for the command it concerns. */
    private runArgs: string[] = [];

    /**
     * Records the paths of the commands the CLI declares with `defineCommand`, such as `dev`, so an
     * extension of one of them is skipped, and the arguments of this run, so the warning about it
     * appears only when that command runs.
     */
    setHostDeclaredCommands(paths: string[][], runArgs: string[] = []): void {
        this.hostCommands = new Set(paths.map(path => path.join(' ')));
        this.runArgs = runArgs;
    }

    /**
     * Registers the built-in commands. Plugins go through {@link applyPlugin},
     * which is the only path that enforces the collision rules.
     */
    registerAll(commands: CliCommandNode[]): void {
        for (const command of commands) {
            this.register(command);
        }
    }

    register(command: CliCommandNode): void {
        this.state.commands.set(command.name, { node: command, extendedBy: [], describedBy: {} });
    }

    /**
     * Applies the extensions, shared options and hooks of a loaded CLI plugin.
     *
     * Everything is applied to a draft first. If any part of the plugin
     * collides with what is already registered, {@link CliPluginRegistrationError}
     * is thrown and the draft is discarded, so a plugin's extensions and options
     * are either all registered or none are.
     */
    applyPlugin(plugin: CliPlugin): void {
        const draft: RegistryState = {
            commands: new Map(this.state.commands),
            rootOptions: new Map(this.state.rootOptions),
            pluginIds: new Set(this.state.pluginIds),
            pluginExtensions: new Map(
                Array.from(this.state.pluginExtensions, ([extensionPoint, entries]) => [
                    extensionPoint,
                    [...entries],
                ]),
            ),
        };
        const conflicts: string[] = [];
        const notices: string[] = [];

        // Checked for every plugin, not only one contributing a hook. The id is
        // what a conflict message names and what a hook is recorded against, so
        // two plugins sharing one is ambiguous everywhere, not just here.
        if (draft.pluginIds.has(plugin.id)) {
            conflicts.push(`Another CLI plugin is already registered under the id "${plugin.id}".`);
        }
        draft.pluginIds.add(plugin.id);

        for (const option of plugin.rootOptions ?? []) {
            this.draftRootOption(draft, option, plugin.id, conflicts, false);
            for (const subOption of option.subOptions ?? []) {
                this.draftRootOption(draft, subOption, plugin.id, conflicts, true);
            }
        }
        for (const extension of plugin.extendCommands ?? []) {
            draftExtension(draft, extension, plugin.id, conflicts, notices, this.hostCommands, this.runArgs);
        }
        for (const { extensionPoint, extension } of getCliPluginExtensionEntries(plugin)) {
            const entries = draft.pluginExtensions.get(extensionPoint) ?? [];
            entries.push({ pluginId: plugin.id, extension });
            draft.pluginExtensions.set(extensionPoint, entries);
        }

        if (conflicts.length > 0) {
            throw new CliPluginRegistrationError(conflicts);
        }

        this.state = draft;
        for (const notice of notices) {
            process.stderr.write(pc.yellow(notice));
        }
    }

    get(name: string): CliCommandNode | undefined {
        return this.state.commands.get(name)?.node;
    }

    has(name: string): boolean {
        return this.state.commands.has(name);
    }

    /**
     * The top-level built-in commands, with the plugins' extensions applied.
     * A built-in that a plugin has extended is still the CLI's command.
     */
    getCommandTree(): CommandTreeEntry[] {
        return Array.from(this.state.commands.values(), entry => ({ node: entry.node }));
    }

    /**
     * Options registered on the `vendure` command itself, each with the plugin
     * that registered it, so the help can name the package.
     */
    getRootOptions(): RootOptionEntry[] {
        // Sub-options are excluded: their parent still carries them, and the
        // host expands each parent once when it registers the option.
        return Array.from(this.state.rootOptions.values())
            .filter(entry => !entry.isSubOption)
            .map(entry => ({ option: entry.option, source: entry.source }));
    }

    /**
     * Plugins that have extended anything in the tree under the top-level
     * command `name`, in the order they were applied.
     *
     * Tree-scoped rather than per command path. Exposed for tests and
     * diagnostics; the CLI itself does not call it.
     */
    getExtendedBy(name: string): string[] {
        return [...(this.state.commands.get(name)?.extendedBy ?? [])];
    }

    getPluginExtensions<T = unknown>(extensionPoint: string): ReadonlyArray<RegisteredCliPluginExtension<T>> {
        return [...(this.state.pluginExtensions.get(extensionPoint) ?? [])] as Array<
            RegisteredCliPluginExtension<T>
        >;
    }

    private draftRootOption(
        draft: RegistryState,
        option: CliCommandOption,
        source: string,
        conflicts: string[],
        isSubOption: boolean,
    ): void {
        const before = conflicts.length;
        const parsed = parseOptionFlags(option);
        for (const flag of [parsed.long, parsed.short]) {
            if (flag && RESERVED_FLAGS.includes(flag)) {
                conflicts.push(
                    `Shared option "${describeOption(option)}" uses "${flag}", which is reserved by the CLI.`,
                );
            }
        }
        const existing = findRootOption(draft, parsed);
        if (existing) {
            conflicts.push(
                `Shared option "${describeOption(option)}" is already registered by ` +
                    `${existing.source ?? 'the CLI'}.`,
            );
        }
        for (const declared of listCommandOptions(Array.from(draft.commands.values(), entry => entry.node))) {
            if (!isSameOption(declared.option, parsed)) {
                continue;
            }
            if (declared.sharedBy) {
                conflicts.push(
                    `Shared option "${describeOption(option)}" is already shared by ` +
                        `${describeCommand(declared.sharedBy, declared.path)}. ` +
                        `${SUBTREE_SHARING_EXPLANATION}`,
                );
            } else if (!takesSameValue(declared.option, option)) {
                conflicts.push(
                    `Shared option "${describeOption(option)}" is not compatible with ` +
                        `"${describeOption(declared.option)}" on "vendure ${declared.path.join(' ')}": ` +
                        `one takes a value and the other does not.`,
                );
            }
        }
        if (conflicts.length === before) {
            draft.rootOptions.set(parsed.attributeName, { option, source, isSubOption });
        }
    }
}

function draftExtension(
    draft: RegistryState,
    extension: CliCommandExtension,
    source: string,
    conflicts: string[],
    notices: string[],
    hostCommands: ReadonlySet<string> = new Set(),
    runArgs: string[] = [],
): void {
    const before = conflicts.length;
    const path = normalizeCommandPath(extension.command);
    const label = path.join(' ');

    if (RESERVED_COMMANDS.includes(path[0])) {
        conflicts.push(reservedCommandConflict(path[0]));
        return;
    }

    const entry = draft.commands.get(path[0]);
    const target = entry && findNodeAtPath(entry.node, path.slice(1));
    // Only this extension is skipped: the plugin's other commands and extensions still apply. A
    // group whose commands the CLI declares, such as `console`, counts as declared too.
    const hostDeclared =
        hostCommands.has(label) || [...hostCommands].some(command => command.startsWith(`${label} `));
    if (!target && hostDeclared) {
        if (!path.every((segment, index) => runArgs[index] === segment)) {
            return;
        }
        notices.push(
            `Skipped the extension of "vendure ${label}" from ${source}: the command is declared with ` +
                'defineCommand, so the plugin has to extend it with defineCommandExtension.\n',
        );
        return;
    }
    if (!entry || !target) {
        conflicts.push(
            `No built-in command is registered at "vendure ${label}", so there is nothing to extend. ` +
                `Check the path. A command declared with defineCommand is extended with defineCommandExtension.`,
        );
        return;
    }

    if (extension.decorate && !isRunnableCliCommand(target)) {
        conflicts.push(
            `"vendure ${label}" is a command group and has no action to decorate. Extend one of its ` +
                `subcommands instead.`,
        );
    }
    conflicts.push(...extensionOptionConflicts(draft, extension, target, path));

    if (conflicts.length > before) {
        return;
    }

    let extended: CliCommandNode;
    try {
        extended = extendNode(target, extension);
    } catch (e) {
        conflicts.push(`Extending "vendure ${label}" failed: ${e instanceof Error ? e.message : String(e)}`);
        return;
    }

    const previousDescriber = entry.describedBy[label];
    if (extension.description && previousDescriber && previousDescriber !== source) {
        notices.push(
            `Description of "vendure ${label}" set by ${source} replaces the one set by ` +
                `${previousDescriber}\n`,
        );
    }

    draft.commands.set(path[0], {
        ...entry,
        node: replaceNodeAtPath(entry.node, path.slice(1), extended),
        extendedBy: [...entry.extendedBy, source],
        describedBy: extension.description ? { ...entry.describedBy, [label]: source } : entry.describedBy,
    });
}

/**
 * The options an added option has to agree with: the target's own, those
 * shared by the commands above it, and — when the target has subcommands —
 * those declared anywhere below it.
 */
interface ExtensionOptionScope {
    ancestors: CliCommandOption[];
    own: CliCommandOption[];
    path: string[];
    /**
     * Set when the target has subcommands, and so shares an added option with
     * everything below it.
     */
    subtree?: {
        /** Which kind of command the target is, for the wording below. */
        kind: SharingCommandKind;
        /** Options that commands below the target share with their own subtrees. */
        parents: Array<{ path: string[]; option: CliCommandOption }>;
        /** Options declared by commands below the target that share nothing. */
        leaves: Array<{ path: string[]; option: CliCommandOption }>;
    };
}

/**
 * Checks each option an extension adds against the flags the CLI owns and
 * every option already in scope at the target.
 */
function extensionOptionConflicts(
    draft: RegistryState,
    extension: CliCommandExtension,
    target: CliCommandNode,
    path: string[],
): string[] {
    const kind = sharingKind(target);
    const scope: ExtensionOptionScope = {
        ancestors: ancestorSharedOptions(draft, path),
        own: withSubOptions(target.options ?? []),
        path,
        // Extending a command that has subcommands shares the option with
        // everything below it, so the subtree matters as much as the ancestors.
        subtree: kind
            ? {
                  kind,
                  parents: descendantParentOptions(target, path),
                  leaves: descendantLeafOptions(target, path),
              }
            : undefined,
    };

    return withSubOptions(extension.options ?? []).flatMap(option =>
        addedOptionConflicts(draft, option, scope),
    );
}

function addedOptionConflicts(
    draft: RegistryState,
    option: CliCommandOption,
    scope: ExtensionOptionScope,
): string[] {
    const parsed = parseOptionFlags(option);
    const name = describeOption(option);
    const { subtree } = scope;
    const label = scope.path.join(' ');
    const conflicts: string[] = [];

    for (const flag of [parsed.long, parsed.short]) {
        if (flag && RESERVED_FLAGS.includes(flag)) {
            conflicts.push(
                `Option "${name}" added to "vendure ${label}" uses "${flag}", which is reserved by the CLI.`,
            );
        }
    }
    if (scope.own.some(existing => isSameOption(existing, parsed))) {
        conflicts.push(`Option "${name}" is already declared on "vendure ${label}".`);
    }

    if (subtree) {
        const targetName = describeCommand(subtree.kind, scope.path);
        const parentBelow = subtree.parents.find(existing => isSameOption(existing.option, parsed));
        if (parentBelow) {
            conflicts.push(
                `Option "${name}" added to ${targetName} is already shared by ` +
                    `"vendure ${parentBelow.path.join(' ')}" below it. ${SUBTREE_SHARING_EXPLANATION}`,
            );
            return conflicts;
        }

        const leafBelow = subtree.leaves.find(
            existing => isSameOption(existing.option, parsed) && !takesSameValue(existing.option, option),
        );
        if (leafBelow) {
            conflicts.push(
                `Option "${name}" added to ${targetName} is not compatible with ` +
                    `"${describeOption(leafBelow.option)}" on "vendure ${leafBelow.path.join(' ')}" below ` +
                    `it: one takes a value and the other does not.`,
            );
            return conflicts;
        }
    }

    const sharedOption =
        findRootOption(draft, parsed)?.option ??
        scope.ancestors.find(existing => isSameOption(existing, parsed));
    if (!sharedOption) {
        return conflicts;
    }
    if (subtree) {
        conflicts.push(
            `Option "${name}" added to ${describeCommand(subtree.kind, scope.path)} is already a ` +
                `shared option ("${describeOption(sharedOption)}"). ${SUBTREE_SHARING_EXPLANATION}`,
        );
    } else if (!takesSameValue(sharedOption, option)) {
        conflicts.push(
            `Option "${name}" added to "vendure ${label}" is not compatible with the shared option ` +
                `"${describeOption(sharedOption)}": one takes a value and the other does not.`,
        );
    }
    return conflicts;
}

function extendNode(target: CliCommandNode, extension: CliCommandExtension): CliCommandNode {
    const options = [...(target.options ?? []), ...(extension.options ?? [])];
    const description = extension.description ?? target.description;

    if (!isRunnableCliCommand(target)) {
        return { ...target, description, options: options.length > 0 ? options : undefined };
    }

    const command: CliCommandDefinition = {
        ...target,
        description,
        options: options.length > 0 ? options : undefined,
    };

    if (!extension.decorate) {
        return command;
    }
    // The decorator gets a frozen copy: `Readonly` is shallow, and on a first
    // extension `target.options` is the array the built-in module exports.
    const action = extension.decorate({ command: freezeCommand(target), next: target.action });
    if (typeof action !== 'function') {
        throw new TypeError('decorate must return an action function');
    }
    return { ...command, action };
}

function freezeCommand(command: CliCommandDefinition): Readonly<CliCommandDefinition> {
    return freezeNode(command) as Readonly<CliCommandDefinition>;
}

/**
 * A frozen deep copy of a node, for handing to a decorator.
 *
 * Everything is copied as well as frozen: freezing makes a mutating decorator
 * fail loudly, and copying means it could not have reached the registered
 * definition even if it did not. Recursing is what lets `subcommands` be shown
 * at all — a decorator can see that the command it wraps has commands nested
 * under it without holding the nodes the registry goes on to use.
 */
function freezeNode(node: CliCommandNode): Readonly<CliCommandNode> {
    const copy = { ...node } as CliCommandDefinition;
    if (copy.options) {
        copy.options = Object.freeze([...copy.options]) as CliCommandOption[];
    }
    if (copy.arguments) {
        copy.arguments = Object.freeze([...copy.arguments]) as CliCommandArgument[];
    }
    if (hasCliSubcommands(node)) {
        copy.subcommands = Object.freeze(node.subcommands.map(freezeNode)) as CliCommandNode[];
    }
    return Object.freeze(copy);
}

function findNodeAtPath(node: CliCommandNode, path: string[]): CliCommandNode | undefined {
    if (path.length === 0) {
        return node;
    }
    if (!hasCliSubcommands(node)) {
        return undefined;
    }
    const child = node.subcommands.find(subcommand => subcommand.name === path[0]);
    return child && findNodeAtPath(child, path.slice(1));
}

/**
 * Rebuilds the tree with the node at `path` replaced. The caller must have
 * resolved `path` with {@link findNodeAtPath} first, which is what guarantees
 * every node above the replacement has subcommands.
 */
function replaceNodeAtPath(
    node: CliCommandNode,
    path: string[],
    replacement: CliCommandNode,
): CliCommandNode {
    if (path.length === 0) {
        return replacement;
    }
    const parent = node as CliCommandParent;
    return {
        ...parent,
        subcommands: parent.subcommands.map(subcommand =>
            subcommand.name === path[0]
                ? replaceNodeAtPath(subcommand, path.slice(1), replacement)
                : subcommand,
        ),
    };
}

function findRootOption(draft: RegistryState, parsed: ParsedCliOption): RegisteredOption | undefined {
    return Array.from(draft.rootOptions.values()).find(entry => isSameOption(entry.option, parsed));
}

interface DeclaredOption {
    path: string[];
    option: CliCommandOption;
    /**
     * Set when the declaring command has subcommands, and so shares the option
     * with all of them. Which kind of command it is only affects the wording.
     */
    sharedBy?: SharingCommandKind;
}

function listCommandOptions(nodes: CliCommandNode[], path: string[] = []): DeclaredOption[] {
    const declared: DeclaredOption[] = [];
    for (const node of nodes) {
        const commandPath = [...path, node.name];
        const sharedBy = sharingKind(node);
        for (const option of withSubOptions(node.options ?? [])) {
            declared.push({ path: commandPath, option, sharedBy });
        }
        if (hasCliSubcommands(node)) {
            declared.push(...listCommandOptions(node.subcommands, commandPath));
        }
    }
    return declared;
}

/**
 * What a command that shares its options with its subtree is: a group, or a
 * command that also runs an action. Undefined for one that shares nothing,
 * which is any command with no subcommands.
 */
type SharingCommandKind = 'group' | 'command';

function sharingKind(node: CliCommandNode): SharingCommandKind | undefined {
    if (!hasCliSubcommands(node)) {
        return undefined;
    }
    return isCliCommandGroup(node) ? 'group' : 'command';
}

/**
 * How a command that shares its options is named in an error message. Only one
 * with no action of its own is a group, but both share in the same way.
 */
function describeCommand(kind: SharingCommandKind, path: string[]): string {
    return `the command ${kind === 'group' ? 'group ' : ''}"vendure ${path.join(' ')}"`;
}

/**
 * Options that commands below `node` share with their own subtrees. An option
 * added to `node` would be shared with them, so the same flag cannot appear in
 * both places.
 */
function descendantParentOptions(
    node: CliCommandNode,
    path: string[],
): Array<{ path: string[]; option: CliCommandOption }> {
    if (!hasCliSubcommands(node)) {
        return [];
    }
    const found: Array<{ path: string[]; option: CliCommandOption }> = [];
    for (const subcommand of node.subcommands) {
        const subPath = [...path, subcommand.name];
        if (hasCliSubcommands(subcommand)) {
            for (const option of withSubOptions(subcommand.options ?? [])) {
                found.push({ path: subPath, option });
            }
            found.push(...descendantParentOptions(subcommand, subPath));
        }
    }
    return found;
}

/**
 * Options declared by the commands below `node` that have no subcommands of
 * their own. An option shared by `node` reaches all of them, so the shapes have
 * to agree even though repeating the flag is allowed.
 */
function descendantLeafOptions(
    node: CliCommandNode,
    path: string[],
): Array<{ path: string[]; option: CliCommandOption }> {
    if (!hasCliSubcommands(node)) {
        return [];
    }
    const found: Array<{ path: string[]; option: CliCommandOption }> = [];
    for (const subcommand of node.subcommands) {
        const subPath = [...path, subcommand.name];
        if (hasCliSubcommands(subcommand)) {
            found.push(...descendantLeafOptions(subcommand, subPath));
        } else {
            for (const option of withSubOptions(subcommand.options ?? [])) {
                found.push({ path: subPath, option });
            }
        }
    }
    return found;
}

/**
 * Options shared with the command at `path` by the commands above it. Together
 * with the root options these are the shared options in scope there.
 */
function ancestorSharedOptions(draft: RegistryState, path: string[]): CliCommandOption[] {
    const options: CliCommandOption[] = [];
    let node = draft.commands.get(path[0])?.node;
    for (let i = 0; i < path.length - 1 && node; i++) {
        if (!hasCliSubcommands(node)) {
            break;
        }
        options.push(...withSubOptions(node.options ?? []));
        node = node.subcommands.find(subcommand => subcommand.name === path[i + 1]);
    }
    return options;
}

/**
 * Two options are the same option when they share a flag, or when they resolve
 * to the same attribute name — `--api-token` and `--apiToken` are written
 * differently but Commander stores both under `apiToken`.
 */
function isSameOption(option: CliCommandOption, other: ParsedCliOption): boolean {
    const parsed = parseOptionFlags(option);
    return (
        (other.long != null && parsed.long === other.long) ||
        (other.short != null && parsed.short === other.short) ||
        parsed.attributeName === other.attributeName
    );
}

/**
 * Two options can share a value only when they agree on whether a value
 * follows the flag. Otherwise the shared option would eat the flag and leave
 * the other command's value stranded as a stray argument.
 */
function takesSameValue(a: CliCommandOption, b: CliCommandOption): boolean {
    return parseOptionFlags(a).takesValue === parseOptionFlags(b).takesValue;
}
