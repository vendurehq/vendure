import {
    CliCommandDefinition,
    CliCommandExtension,
    CliCommandNode,
    CliCommandOption,
    isCliCommandGroup,
} from './cli-command-definition';
import { describeOption, parseOptionFlags, withSubOptions } from './cli-command-options';

/**
 * A CLI plugin that can add new commands or replace existing ones.
 *
 * Packages declare their plugin entry in `package.json`:
 *
 * ```json
 * {
 *   "vendure": {
 *     "cliPlugin": "./dist/cli-plugin.js"
 *   }
 * }
 * ```
 *
 * @since 3.8.0
 */
export interface CliPlugin {
    /**
     * Stable plugin id, typically the npm package name (e.g. `@vendure/cloud`).
     */
    id: string;
    /**
     * Commands to register. Each entry is either a command with an action, or a
     * group of subcommands. A top-level name that a built-in or an earlier
     * plugin already provides is rejected unless the command sets
     * `replaces: true`.
     */
    commands: CliCommandNode[];
    /**
     * Options registered on the `vendure` command itself, and therefore shared
     * by every command. They can be given anywhere on the command line
     * (`vendure --token X project list` and `vendure project list --token X`
     * are equivalent) and reach actions via `CliCommandContext.inheritedOptions`.
     *
     * @since 3.8.0
     */
    rootOptions?: CliCommandOption[];
    /**
     * Additions to commands that are already registered, whether built-in or
     * contributed by another plugin. Unlike replacing a command, several
     * plugins can extend the same one: their options are merged and their
     * decorators are composed in `vendure.cli.plugins` order.
     *
     * @since 3.8.0
     */
    extendCommands?: CliCommandExtension[];
}

export function assertCliPlugin(value: unknown): asserts value is CliPlugin {
    if (!value || typeof value !== 'object') {
        throw new Error('CLI plugin must be an object');
    }
    const plugin = value as Partial<CliPlugin>;
    if (typeof plugin.id !== 'string' || plugin.id.trim().length === 0) {
        throw new Error('CLI plugin id must be a non-empty string');
    }
    if (!Array.isArray(plugin.commands)) {
        throw new Error(`CLI plugin "${plugin.id}" must provide a commands array`);
    }
    const rootOptions = plugin.rootOptions ?? [];
    if (!Array.isArray(rootOptions)) {
        throw new Error(`CLI plugin "${plugin.id}" rootOptions must be an array`);
    }
    assertUniqueOptions(plugin.id, rootOptions, 'shared root options');
    assertNodes(plugin.id, plugin.commands, [], rootOptions);

    const extensions = plugin.extendCommands ?? [];
    if (!Array.isArray(extensions)) {
        throw new Error(`CLI plugin "${plugin.id}" extendCommands must be an array`);
    }
    assertExtensions(plugin.id, extensions, rootOptions);
}

/**
 * Normalises the `command` of an extension to a path, e.g. `'dev'` and
 * `['config', 'server', 'set']`.
 */
export function normalizeCommandPath(command: string | string[]): string[] {
    return (Array.isArray(command) ? command : command.split(' '))
        .map(segment => segment.trim())
        .filter(segment => segment.length > 0);
}

function assertExtensions(
    pluginId: string,
    extensions: CliCommandExtension[],
    rootOptions: CliCommandOption[],
): void {
    const seenPaths = new Set<string>();
    for (const extension of extensions) {
        if (!extension || typeof extension !== 'object') {
            throw new Error(`CLI plugin "${pluginId}" has a command extension that is not an object`);
        }
        const path = normalizeCommandPath(extension.command);
        if (path.length === 0) {
            throw new Error(`CLI plugin "${pluginId}" has a command extension without a command path`);
        }
        const label = path.join(' ');
        if (seenPaths.has(label)) {
            throw new Error(
                `CLI plugin "${pluginId}" extends "${label}" more than once. Combine them into one extension.`,
            );
        }
        seenPaths.add(label);

        if (extension.decorate !== undefined && typeof extension.decorate !== 'function') {
            throw new Error(`CLI plugin "${pluginId}" extension of "${label}" has a non-function decorate`);
        }
        if (extension.decorate === undefined && !extension.description && !extension.options?.length) {
            throw new Error(
                `CLI plugin "${pluginId}" extension of "${label}" adds nothing. Give it a decorate, ` +
                    `description or options.`,
            );
        }

        assertUniqueOptions(pluginId, extension.options ?? [], `options added to "${label}"`);
    }
}

/**
 * Validates and returns a CLI plugin definition for export from a plugin package.
 *
 * @since 3.8.0
 */
export function defineCliPlugin(plugin: CliPlugin): CliPlugin {
    assertCliPlugin(plugin);
    return plugin;
}

function assertNodes(
    pluginId: string,
    nodes: CliCommandNode[],
    path: string[],
    inheritedOptions: CliCommandOption[],
): void {
    const seenNames = new Set<string>();
    for (const node of nodes) {
        if (!node || typeof node.name !== 'string' || node.name.trim().length === 0) {
            throw new Error(`CLI plugin "${pluginId}" has a command with an invalid name`);
        }
        const commandPath = [...path, node.name];
        const label = commandPath.join(' ');
        if (seenNames.has(node.name)) {
            throw new Error(`CLI plugin "${pluginId}" declares the command "${label}" more than once`);
        }
        seenNames.add(node.name);

        if (typeof node.description !== 'string' || node.description.trim().length === 0) {
            throw new Error(`CLI plugin "${pluginId}" command "${label}" must provide a description`);
        }

        const ownOptions = node.options ?? [];
        assertUniqueOptions(pluginId, ownOptions, `options of command "${label}"`);
        if (!isCliCommandGroup(node)) {
            assertMatchesInheritedShape(pluginId, label, ownOptions, inheritedOptions);
        }
        if (isCliCommandGroup(node)) {
            assertDoesNotShadow(pluginId, label, ownOptions, inheritedOptions);
            if (typeof (node as Partial<CliCommandDefinition>).action === 'function') {
                throw new Error(
                    `CLI plugin "${pluginId}" command "${label}" declares both subcommands and an action. ` +
                        `A command group has no action of its own: move it into a subcommand.`,
                );
            }
            if (node.subcommands.length === 0) {
                throw new Error(
                    `CLI plugin "${pluginId}" command group "${label}" must provide at least one subcommand`,
                );
            }
            assertNodes(pluginId, node.subcommands, commandPath, [...inheritedOptions, ...ownOptions]);
        } else if (typeof node.action !== 'function') {
            throw new Error(`CLI plugin "${pluginId}" command "${label}" must provide an action function`);
        }
    }
}

function assertUniqueOptions(pluginId: string, options: CliCommandOption[], context: string): void {
    for (const option of options) {
        for (const subOption of option.subOptions ?? []) {
            if (subOption.subOptions?.length) {
                throw new Error(
                    `CLI plugin "${pluginId}" nests sub-options more than one level deep under ` +
                        `"${describeOption(option)}" in ${context}. The CLI registers one level, so a ` +
                        `deeper option would be validated but never parsed.`,
                );
            }
        }
    }

    const seenFlags = new Set<string>();
    for (const option of withSubOptions(options)) {
        if (!option || typeof option.long !== 'string' || option.long.trim().length === 0) {
            throw new Error(`CLI plugin "${pluginId}" has an option without a long flag in ${context}`);
        }
        const { long, short } = parseOptionFlags(option);
        for (const flag of [long, short]) {
            if (!flag) {
                continue;
            }
            if (seenFlags.has(flag)) {
                throw new Error(`CLI plugin "${pluginId}" declares "${flag}" twice in ${context}`);
            }
            seenFlags.add(flag);
        }
    }
}

/**
 * A command may repeat a flag one of its groups shares — the host copies the
 * value onto it — but only if both agree on whether a value follows the flag.
 * Otherwise the group consumes the flag and hands the command a value its own
 * declaration says it will never see.
 */
function assertMatchesInheritedShape(
    pluginId: string,
    label: string,
    ownOptions: CliCommandOption[],
    inheritedOptions: CliCommandOption[],
): void {
    const inherited = withSubOptions(inheritedOptions);
    for (const option of withSubOptions(ownOptions)) {
        const parsed = parseOptionFlags(option);
        const clash = inherited.find(existing => {
            const other = parseOptionFlags(existing);
            return (
                other.long === parsed.long ||
                (other.short != null && other.short === parsed.short) ||
                other.attributeName === parsed.attributeName
            );
        });
        if (clash && parseOptionFlags(clash).takesValue !== parsed.takesValue) {
            throw new Error(
                `CLI plugin "${pluginId}" command "${label}" declares "${describeOption(option)}", which ` +
                    `is not compatible with the shared option "${describeOption(clash)}": one takes a ` +
                    `value and the other does not.`,
            );
        }
    }
}

/**
 * A group's options are shared with everything below it, so two levels sharing
 * one flag would leave the value's owner ambiguous. A leaf may repeat a shared
 * flag: the host copies the value onto it, so both readings agree.
 */
function assertDoesNotShadow(
    pluginId: string,
    label: string,
    ownOptions: CliCommandOption[],
    inheritedOptions: CliCommandOption[],
): void {
    const inheritedFlags = new Map<string, CliCommandOption>();
    for (const option of withSubOptions(inheritedOptions)) {
        const { long, short } = parseOptionFlags(option);
        for (const flag of [long, short]) {
            if (flag) {
                inheritedFlags.set(flag, option);
            }
        }
    }
    for (const option of withSubOptions(ownOptions)) {
        const { long, short } = parseOptionFlags(option);
        for (const flag of [long, short]) {
            if (!flag) {
                continue;
            }
            const shadowed = inheritedFlags.get(flag);
            if (shadowed) {
                throw new Error(
                    `CLI plugin "${pluginId}" command "${label}" declares "${flag}", which is already a shared ` +
                        `option ("${describeOption(shadowed)}"). Declare it at one level only and read the ` +
                        `value from the command context.`,
                );
            }
        }
    }
}
