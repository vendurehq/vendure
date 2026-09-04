import pc from 'picocolors';

import {
    CliCommandDefinition,
    CliCommandExtension,
    CliCommandGroupDefinition,
    CliCommandNode,
    CliCommandOption,
    isCliCommandGroup,
} from './cli-command-definition';
import { buildOptionFlags, describeOption, ParsedCliOption, parseOptionFlags } from './cli-command-options';
import { CliPlugin, normalizeCommandPath } from './cli-plugin';

/**
 * Flags the CLI host owns. A plugin that took one of these would break
 * `vendure --help`, which is how a user recovers from a bad plugin.
 */
const RESERVED_FLAGS = ['--help', '-h', '--version', '-V'];

/**
 * Commands the CLI host owns. `plugins` is how a user disables a plugin that
 * misbehaves, so no plugin may replace or extend it.
 */
const RESERVED_COMMANDS = ['plugins'];

interface RegisteredCommand {
    node: CliCommandNode;
    /** Plugin id, or undefined for a built-in. */
    source?: string;
    /** Plugins that have extended this command, in the order they were applied. */
    extendedBy: string[];
    /** Plugin whose extension last set the description. */
    describedBy?: string;
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
    constructor(
        readonly pluginId: string,
        readonly conflicts: string[],
    ) {
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
     * Registers built-in or plugin commands. When a command name already
     * exists, it is replaced and a short notice is written to stderr.
     */
    registerAll(commands: CliCommandNode[], source?: string): void {
        for (const command of commands) {
            this.register(command, source);
        }
    }

    register(command: CliCommandNode, source?: string): void {
        if (this.state.commands.has(command.name) && source) {
            // Not dim: this is the main signal that a built-in (or earlier
            // plugin) command was overridden, and precedence follows
            // vendure.cli.plugins order (last enabled plugin wins).
            process.stderr.write(pc.yellow(`Replaced command "${command.name}" via ${source}\n`));
        }
        this.state.commands.set(command.name, { node: command, source, extendedBy: [] });
    }

    /**
     * Applies the commands, extensions and shared options of a loaded CLI
     * plugin.
     *
     * Everything is applied to a draft first. If any part of the plugin
     * collides with what is already registered, {@link CliPluginRegistrationError}
     * is thrown and the draft is discarded, so a plugin is never applied by
     * halves.
     */
    applyPlugin(plugin: CliPlugin): void {
        const draft: RegistryState = {
            commands: new Map(this.state.commands),
            rootOptions: new Map(this.state.rootOptions),
        };
        const conflicts: string[] = [];
        const notices: string[] = [];

        for (const option of plugin.rootOptions ?? []) {
            this.draftRootOption(draft, option, plugin.id, conflicts);
        }
        for (const node of plugin.commands) {
            draftCommand(draft, node, plugin.id, conflicts, notices);
        }
        for (const extension of plugin.extendCommands ?? []) {
            draftExtension(draft, extension, plugin.id, conflicts, notices);
        }

        if (conflicts.length > 0) {
            throw new CliPluginRegistrationError(plugin.id, conflicts);
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
     * Plugins that have extended the command at `path`, in the order they were
     * applied. The last one is the outermost wrapper.
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
            if (isSameOption(declared.option, parsed) && !takesSameValue(declared.option, option)) {
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
        conflicts.push(
            `Command "${node.name}" is reserved by the CLI, because it is how a plugin is disabled.`,
        );
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
        const shared = findRootOption(draft, parseOptionFlags(declared.option));
        if (shared && !takesSameValue(shared.option, declared.option)) {
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
    draft.commands.set(node.name, { node, source, extendedBy: [] });
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
        conflicts.push(
            `Command "${path[0]}" is reserved by the CLI, because it is how a plugin is disabled.`,
        );
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
    if (targetIsGroup && extension.arguments?.length) {
        conflicts.push(`"vendure ${label}" is a command group and takes no positional arguments.`);
    }

    const contributors = [entry.source ?? 'the CLI', ...entry.extendedBy].join(', ');
    for (const option of extension.options ?? []) {
        const parsed = parseOptionFlags(option);
        for (const flag of [parsed.long, parsed.short]) {
            if (flag && RESERVED_FLAGS.includes(flag)) {
                conflicts.push(
                    `Option "${describeOption(option)}" added to "vendure ${label}" uses "${flag}", ` +
                        `which is reserved by the CLI.`,
                );
            }
        }
        const clash = (target.options ?? []).find(existing => isSameOption(existing, parsed));
        if (clash) {
            conflicts.push(
                `Option "${describeOption(option)}" is already declared on "vendure ${label}" ` +
                    `(contributed by ${contributors}).`,
            );
        }
        const shared = findRootOption(draft, parsed);
        if (shared && !takesSameValue(shared.option, option)) {
            conflicts.push(
                `Option "${describeOption(option)}" added to "vendure ${label}" is not compatible with ` +
                    `the shared option "${describeOption(shared.option)}" registered by ` +
                    `${shared.source ?? 'the CLI'}: one takes a value and the other does not.`,
            );
        }
    }

    if (!targetIsGroup) {
        const existingArguments = target.arguments ?? [];
        for (const argument of extension.arguments ?? []) {
            if (existingArguments.some(existing => existing.name === argument.name)) {
                conflicts.push(
                    `Argument "${argument.name}" is already declared on "vendure ${label}" ` +
                        `(contributed by ${contributors}).`,
                );
            }
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

    if (extension.description && entry.describedBy && entry.describedBy !== source) {
        notices.push(
            `Description of "vendure ${label}" set by ${source} replaces the one set by ` +
                `${entry.describedBy}\n`,
        );
    }

    draft.commands.set(path[0], {
        ...entry,
        node: replaceNodeAtPath(entry.node, path.slice(1), extended),
        extendedBy: [...entry.extendedBy, source],
        describedBy: extension.description ? source : entry.describedBy,
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

    const commandArguments = [...(target.arguments ?? []), ...(extension.arguments ?? [])];
    const command: CliCommandDefinition = {
        ...target,
        description,
        options: options.length > 0 ? options : undefined,
        arguments: commandArguments.length > 0 ? commandArguments : undefined,
    };

    if (!extension.decorate) {
        return command;
    }
    const action = extension.decorate({ command: target, next: target.action });
    if (typeof action !== 'function') {
        throw new Error('decorate must return an action function');
    }
    return { ...command, action };
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

function listCommandOptions(
    nodes: CliCommandNode[],
    path: string[] = [],
): Array<{ path: string[]; option: CliCommandOption }> {
    const declared: Array<{ path: string[]; option: CliCommandOption }> = [];
    for (const node of nodes) {
        const commandPath = [...path, node.name];
        for (const option of node.options ?? []) {
            declared.push({ path: commandPath, option });
        }
        if (isCliCommandGroup(node)) {
            declared.push(...listCommandOptions(node.subcommands, commandPath));
        }
    }
    return declared;
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
    return /[<[]/.test(buildOptionFlags(a)) === /[<[]/.test(buildOptionFlags(b));
}
