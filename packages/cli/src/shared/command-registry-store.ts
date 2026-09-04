import pc from 'picocolors';

import {
    CliCommandArgument,
    CliCommandDefinition,
    CliCommandExtension,
    CliCommandGroupDefinition,
    CliCommandNode,
    CliCommandOption,
    isCliCommandGroup,
} from './cli-command-definition';
import { describeOption, ParsedCliOption, parseOptionFlags, withSubOptions } from './cli-command-options';
import { CliPlugin, normalizeCommandPath } from './cli-plugin';

/**
 * Flags the CLI host owns. A plugin that took one of these would break
 * `vendure --help`, which is how a user recovers from a bad plugin.
 */
export const RESERVED_FLAGS = ['--help', '-h', '--version', '-V'];

/**
 * Commands the CLI host owns. `plugins` is how a user disables a plugin that
 * misbehaves and `help` is how they find it, so no plugin may replace or
 * extend either. Commander adds `help` implicitly, so the registry would not
 * otherwise see a collision.
 */
export const RESERVED_COMMANDS = ['plugins', 'help'];

function reservedCommandConflict(name: string): string {
    const reason =
        name === 'plugins'
            ? 'it is how a plugin is disabled'
            : 'it is how a user finds their way out of a broken plugin';
    return `Command "${name}" is reserved by the CLI, because ${reason}.`;
}

interface RegisteredCommand {
    node: CliCommandNode;
    /** Plugin id, or undefined for a built-in. */
    source?: string;
    /** Plugins that have extended this command, in the order they were applied. */
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
}

interface RegistryState {
    commands: Map<string, RegisteredCommand>;
    rootOptions: Map<string, RegisteredOption>;
}

/**
 * Thrown when a plugin's commands, extensions or shared options would collide
 * with what is already registered. The CLI host reports it and skips that
 * plugin, so one plugin cannot make the rest of the CLI unusable.
 */
export class CliPluginRegistrationError extends Error {
    constructor(readonly conflicts: string[]) {
        super(
            `${conflicts.length === 1 ? 'Conflict' : 'Conflicts'}:\n${conflicts.map(c => `  - ${c}`).join('\n')}`,
        );
        this.name = 'CliPluginRegistrationError';
    }
}

/**
 * In-memory registry of CLI commands and the options shared by all of them.
 * Built-in commands are registered first and plugins are applied on top, in
 * activation order.
 */
export class CommandRegistry {
    private state: RegistryState = { commands: new Map(), rootOptions: new Map() };

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
     * Applies the commands, extensions and shared options of a loaded CLI
     * plugin.
     *
     * Everything is applied to a draft first. If any part of the plugin
     * collides with what is already registered, {@link CliPluginRegistrationError}
     * is thrown and the draft is discarded, so a plugin's commands and options
     * are either all registered or none are.
     */
    applyPlugin(plugin: CliPlugin): void {
        const draft: RegistryState = {
            commands: new Map(this.state.commands),
            rootOptions: new Map(this.state.rootOptions),
        };
        const conflicts: string[] = [];
        const notices: string[] = [];

        for (const option of withSubOptions(plugin.rootOptions ?? [])) {
            this.draftRootOption(draft, option, plugin.id, conflicts);
        }
        for (const node of plugin.commands) {
            draftCommand(draft, node, plugin.id, conflicts, notices);
        }
        for (const extension of plugin.extendCommands ?? []) {
            draftExtension(draft, extension, plugin.id, conflicts, notices);
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

    toArray(): CliCommandNode[] {
        return Array.from(this.state.commands.values(), entry => entry.node);
    }

    /**
     * Options registered on the `vendure` command itself by plugins.
     */
    getRootOptions(): CliCommandOption[] {
        return Array.from(this.state.rootOptions.values(), entry => entry.option);
    }

    /**
     * Plugins that have extended anything in the tree under the top-level
     * command `name`, in the order they were applied.
     *
     * Deliberately tree-scoped rather than per command path: it backs the
     * refusal to replace a command another plugin has extended, and replacing
     * a group does discard an extension of one of its subcommands.
     */
    getExtendedBy(name: string): string[] {
        return [...(this.state.commands.get(name)?.extendedBy ?? [])];
    }

    private draftRootOption(
        draft: RegistryState,
        option: CliCommandOption,
        source: string,
        conflicts: string[],
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
            if (declared.isGroupOption) {
                // The mirror of the check in draftCommand. Without it the rule
                // would depend on which of the two plugins is listed first.
                conflicts.push(
                    `Shared option "${describeOption(option)}" is already shared by the command group ` +
                        `"vendure ${declared.path.join(' ')}". A group shares its options with everything ` +
                        `below it, so the same flag cannot be shared at two levels.`,
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
            draft.rootOptions.set(parsed.attributeName, { option, source });
        }
    }
}

function draftCommand(
    draft: RegistryState,
    node: CliCommandNode,
    source: string,
    conflicts: string[],
    notices: string[],
): void {
    const before = conflicts.length;
    if (RESERVED_COMMANDS.includes(node.name)) {
        conflicts.push(reservedCommandConflict(node.name));
        return;
    }

    const existing = draft.commands.get(node.name);
    if (existing && node.replaces !== true) {
        conflicts.push(
            `Command "${node.name}" is already provided by ${existing.source ?? 'the CLI'}. ` +
                `Set "replaces: true" on it to override that deliberately, or use "extendCommands" ` +
                `to add to it without discarding it.`,
        );
        return;
    }

    const discarded = existing?.extendedBy.filter(id => id !== source) ?? [];
    if (discarded.length > 0) {
        conflicts.push(
            `Command "${node.name}" has been extended by ${discarded.join(', ')}. Replacing it would ` +
                `discard that. Use "extendCommands" instead, or list this plugin before them in ` +
                `vendure.cli.plugins.`,
        );
        return;
    }

    for (const declared of listCommandOptions([node])) {
        const parsed = parseOptionFlags(declared.option);
        for (const flag of [parsed.long, parsed.short]) {
            if (flag && RESERVED_FLAGS.includes(flag)) {
                conflicts.push(
                    `Option "${describeOption(declared.option)}" on "vendure ${declared.path.join(' ')}" ` +
                        `uses "${flag}", which is reserved by the CLI.`,
                );
            }
        }
        const shared = findRootOption(draft, parsed);
        if (!shared) {
            continue;
        }
        if (declared.isGroupOption) {
            conflicts.push(
                `Option "${describeOption(declared.option)}" on the command group ` +
                    `"vendure ${declared.path.join(' ')}" is already a shared option registered by ` +
                    `${shared.source ?? 'the CLI'}. A group shares its options with everything below it, ` +
                    `so the same flag cannot be shared at two levels.`,
            );
        } else if (!takesSameValue(shared.option, declared.option)) {
            conflicts.push(
                `Option "${describeOption(declared.option)}" on "vendure ${declared.path.join(' ')}" is not ` +
                    `compatible with the shared option "${describeOption(shared.option)}" registered by ` +
                    `${shared.source ?? 'the CLI'}: one takes a value and the other does not.`,
            );
        }
    }

    if (conflicts.length > before) {
        return;
    }
    if (existing) {
        notices.push(`Replaced command "${node.name}" via ${source}\n`);
    }
    draft.commands.set(node.name, { node, source, extendedBy: [], describedBy: {} });
}

function draftExtension(
    draft: RegistryState,
    extension: CliCommandExtension,
    source: string,
    conflicts: string[],
    notices: string[],
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
    if (!entry || !target) {
        conflicts.push(
            `No command is registered at "vendure ${label}", so there is nothing to extend. ` +
                `Check the path, and that the plugin providing it is listed first in vendure.cli.plugins.`,
        );
        return;
    }

    const targetIsGroup = isCliCommandGroup(target);
    if (targetIsGroup && extension.decorate) {
        conflicts.push(
            `"vendure ${label}" is a command group and has no action to decorate. Extend one of its ` +
                `subcommands instead.`,
        );
    }
    const inheritedShared = ancestorSharedOptions(draft, path);
    // Extending a group shares the option with everything below it, so the
    // subtree matters as much as the ancestors.
    const descendantShared = targetIsGroup ? descendantGroupOptions(target, path) : [];
    const targetOptions = withSubOptions(target.options ?? []);
    for (const option of withSubOptions(extension.options ?? [])) {
        const parsed = parseOptionFlags(option);
        for (const flag of [parsed.long, parsed.short]) {
            if (flag && RESERVED_FLAGS.includes(flag)) {
                conflicts.push(
                    `Option "${describeOption(option)}" added to "vendure ${label}" uses "${flag}", ` +
                        `which is reserved by the CLI.`,
                );
            }
        }
        const clash = targetOptions.find(existing => isSameOption(existing, parsed));
        if (clash) {
            conflicts.push(`Option "${describeOption(option)}" is already declared on "vendure ${label}".`);
        }
        const descendant = descendantShared.find(existing => isSameOption(existing.option, parsed));
        if (descendant) {
            conflicts.push(
                `Option "${describeOption(option)}" added to the command group "vendure ${label}" is ` +
                    `already shared by "vendure ${descendant.path.join(' ')}" below it. A group shares ` +
                    `its options with everything below it, so the same flag cannot be shared at two ` +
                    `levels.`,
            );
            continue;
        }
        const inherited = inheritedShared.find(existing => isSameOption(existing, parsed));
        const shared = findRootOption(draft, parsed);
        const sharedOption = shared?.option ?? inherited;
        if (!sharedOption) {
            continue;
        }
        if (targetIsGroup) {
            conflicts.push(
                `Option "${describeOption(option)}" added to the command group "vendure ${label}" is ` +
                    `already a shared option ("${describeOption(sharedOption)}"). A group shares its ` +
                    `options with everything below it, so the same flag cannot be shared at two levels.`,
            );
        } else if (!takesSameValue(sharedOption, option)) {
            conflicts.push(
                `Option "${describeOption(option)}" added to "vendure ${label}" is not compatible with ` +
                    `the shared option "${describeOption(sharedOption)}": one takes a value and the ` +
                    `other does not.`,
            );
        }
    }

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
 * Builds the extended command. The original definition is never mutated, so
 * `builtinCommands.<name>.action` keeps pointing at the original
 * implementation and each decorator wraps only what was registered before it.
 */
function extendNode(target: CliCommandNode, extension: CliCommandExtension): CliCommandNode {
    const options = [...(target.options ?? []), ...(extension.options ?? [])];
    const description = extension.description ?? target.description;

    if (isCliCommandGroup(target)) {
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
        throw new Error('decorate must return an action function');
    }
    return { ...command, action };
}

function freezeCommand(command: CliCommandDefinition): Readonly<CliCommandDefinition> {
    // The arrays are copied as well as frozen: freezing makes a mutating
    // decorator fail loudly, and copying means it could not have reached the
    // registered definition even if it did not.
    const frozenOptions = command.options && (Object.freeze([...command.options]) as CliCommandOption[]);
    const frozenArguments =
        command.arguments && (Object.freeze([...command.arguments]) as CliCommandArgument[]);
    return Object.freeze({ ...command, options: frozenOptions, arguments: frozenArguments });
}

function findNodeAtPath(node: CliCommandNode, path: string[]): CliCommandNode | undefined {
    if (path.length === 0) {
        return node;
    }
    if (!isCliCommandGroup(node)) {
        return undefined;
    }
    const child = node.subcommands.find(subcommand => subcommand.name === path[0]);
    return child && findNodeAtPath(child, path.slice(1));
}

/**
 * Rebuilds the tree with the node at `path` replaced. The caller must have
 * resolved `path` with {@link findNodeAtPath} first, which is what guarantees
 * every node above the replacement is a group.
 */
function replaceNodeAtPath(
    node: CliCommandNode,
    path: string[],
    replacement: CliCommandNode,
): CliCommandNode {
    if (path.length === 0) {
        return replacement;
    }
    const group = node as CliCommandGroupDefinition;
    return {
        ...group,
        subcommands: group.subcommands.map(subcommand =>
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
    /** Group options are shared with every command below them. */
    isGroupOption: boolean;
}

function listCommandOptions(nodes: CliCommandNode[], path: string[] = []): DeclaredOption[] {
    const declared: DeclaredOption[] = [];
    for (const node of nodes) {
        const commandPath = [...path, node.name];
        const isGroupOption = isCliCommandGroup(node);
        for (const option of withSubOptions(node.options ?? [])) {
            declared.push({ path: commandPath, option, isGroupOption });
        }
        if (isCliCommandGroup(node)) {
            declared.push(...listCommandOptions(node.subcommands, commandPath));
        }
    }
    return declared;
}

/**
 * Options that groups below `node` share with their own subtrees. An option
 * added to `node` would be shared with them, so the same flag cannot appear in
 * both places.
 */
function descendantGroupOptions(
    node: CliCommandNode,
    path: string[],
): Array<{ path: string[]; option: CliCommandOption }> {
    if (!isCliCommandGroup(node)) {
        return [];
    }
    const found: Array<{ path: string[]; option: CliCommandOption }> = [];
    for (const subcommand of node.subcommands) {
        const subPath = [...path, subcommand.name];
        if (isCliCommandGroup(subcommand)) {
            for (const option of withSubOptions(subcommand.options ?? [])) {
                found.push({ path: subPath, option });
            }
            found.push(...descendantGroupOptions(subcommand, subPath));
        }
    }
    return found;
}

/**
 * Options shared with the command at `path` by the groups above it. Together
 * with the root options these are the shared options in scope there.
 */
function ancestorSharedOptions(draft: RegistryState, path: string[]): CliCommandOption[] {
    const options: CliCommandOption[] = [];
    let node = draft.commands.get(path[0])?.node;
    for (let i = 0; i < path.length - 1 && node; i++) {
        if (!isCliCommandGroup(node)) {
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
