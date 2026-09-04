import {
    CliCommandDefinition,
    CliCommandNode,
    CliCommandOption,
    isCliCommandGroup,
} from './cli-command-definition';
import { describeOption, parseOptionFlags } from './cli-command-options';

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
 */
export interface CliPlugin {
    /**
     * Stable plugin id, typically the npm package name (e.g. `@vendure/cloud`).
     */
    id: string;
    /**
     * Commands to register. Each entry is either a command with an action, or a
     * group of subcommands. A top-level name that matches a built-in (or a
     * previously registered) command replaces it, which must be declared with
     * `replaces: true`.
     */
    commands: CliCommandNode[];
    /**
     * Options registered on the `vendure` command itself, and therefore shared
     * by every command. They can be given anywhere on the command line
     * (`vendure --token X project list` and `vendure project list --token X`
     * are equivalent) and reach actions via `CliCommandContext.inheritedOptions`.
     */
    rootOptions?: CliCommandOption[];
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
}

/**
 * Validates and returns a CLI plugin definition for export from a plugin package.
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
        assertDoesNotShadow(pluginId, label, ownOptions, inheritedOptions);

        if (isCliCommandGroup(node)) {
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
    const seenFlags = new Set<string>();
    for (const option of options) {
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
 * A shared option is consumed by the command that declares it wherever it
 * appears on the command line, so a nested command redeclaring the same flag
 * would never receive a value. Reject it while the author can still see why.
 */
function assertDoesNotShadow(
    pluginId: string,
    label: string,
    ownOptions: CliCommandOption[],
    inheritedOptions: CliCommandOption[],
): void {
    const inheritedFlags = new Map<string, CliCommandOption>();
    for (const option of inheritedOptions) {
        const { long, short } = parseOptionFlags(option);
        for (const flag of [long, short]) {
            if (flag) {
                inheritedFlags.set(flag, option);
            }
        }
    }
    for (const option of ownOptions) {
        const { long, short } = parseOptionFlags(option);
        for (const flag of [long, short]) {
            if (!flag) {
                continue;
            }
            const shadowed = inheritedFlags.get(flag);
            if (shadowed) {
                throw new Error(
                    `CLI plugin "${pluginId}" command "${label}" declares "${flag}", which is already a shared ` +
                        `option ("${describeOption(shadowed)}"). Remove it and read the value from the command context.`,
                );
            }
        }
    }
}
