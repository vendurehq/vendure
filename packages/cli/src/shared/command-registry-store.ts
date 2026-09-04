import pc from 'picocolors';

import { CliCommandNode, CliCommandOption, isCliCommandGroup } from './cli-command-definition';
import { buildOptionFlags, describeOption, ParsedCliOption, parseOptionFlags } from './cli-command-options';
import { CliPlugin } from './cli-plugin';

/**
 * Flags the CLI host owns. A plugin that took one of these would break
 * `vendure --help`, which is how a user recovers from a bad plugin.
 */
const RESERVED_FLAGS = ['--help', '-h', '--version', '-V'];

interface RegisteredCommand {
    node: CliCommandNode;
    /** Plugin id, or undefined for a built-in. */
    source?: string;
}

interface RegisteredOption {
    option: CliCommandOption;
    source?: string;
}

/**
 * Thrown when a plugin's commands or shared options would collide with what is
 * already registered. The CLI host reports it and skips that plugin, so one
 * plugin cannot make the rest of the CLI unusable.
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
    private readonly commands = new Map<string, RegisteredCommand>();
    private readonly rootOptions = new Map<string, RegisteredOption>();

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
        if (this.commands.has(command.name) && source) {
            // Not dim: this is the main signal that a built-in (or earlier
            // plugin) command was overridden, and precedence follows
            // vendure.cli.plugins order (last enabled plugin wins).
            process.stderr.write(pc.yellow(`Replaced command "${command.name}" via ${source}\n`));
        }
        this.commands.set(command.name, { node: command, source });
    }

    /**
     * Applies the commands and shared options of a loaded CLI plugin.
     *
     * Throws {@link CliPluginRegistrationError} without registering anything
     * when the plugin would collide with an existing command or shared option,
     * so a plugin is never applied by halves.
     */
    applyPlugin(plugin: CliPlugin): void {
        const conflicts = this.findConflicts(plugin);
        if (conflicts.length > 0) {
            throw new CliPluginRegistrationError(plugin.id, conflicts);
        }
        for (const option of plugin.rootOptions ?? []) {
            this.rootOptions.set(parseOptionFlags(option).attributeName, { option, source: plugin.id });
        }
        this.registerAll(plugin.commands, plugin.id);
    }

    get(name: string): CliCommandNode | undefined {
        return this.commands.get(name)?.node;
    }

    has(name: string): boolean {
        return this.commands.has(name);
    }

    toArray(): CliCommandNode[] {
        return Array.from(this.commands.values(), entry => entry.node);
    }

    /**
     * Options registered on the `vendure` command itself by plugins.
     */
    getRootOptions(): CliCommandOption[] {
        return Array.from(this.rootOptions.values(), entry => entry.option);
    }

    private findConflicts(plugin: CliPlugin): string[] {
        const conflicts: string[] = [];
        const declaredOptions = this.listDeclaredCommandOptions();

        for (const option of plugin.rootOptions ?? []) {
            const parsed = parseOptionFlags(option);
            for (const flag of [parsed.long, parsed.short]) {
                if (flag && RESERVED_FLAGS.includes(flag)) {
                    conflicts.push(
                        `Shared option "${describeOption(option)}" uses "${flag}", which is reserved by the CLI.`,
                    );
                }
            }
            const existing = this.findRootOption(parsed);
            if (existing) {
                conflicts.push(
                    `Shared option "${describeOption(option)}" is already registered by ` +
                        `${existing.source ?? 'the CLI'}.`,
                );
            }
            for (const declared of declaredOptions) {
                if (isSameOption(declared.option, parsed) && !takesSameValue(declared.option, option)) {
                    conflicts.push(
                        `Shared option "${describeOption(option)}" is not compatible with ` +
                            `"${describeOption(declared.option)}" on "vendure ${declared.path.join(' ')}": ` +
                            `one takes a value and the other does not.`,
                    );
                }
            }
        }

        for (const node of plugin.commands) {
            const existing = this.commands.get(node.name);
            if (existing && node.replaces !== true) {
                conflicts.push(
                    `Command "${node.name}" is already provided by ${existing.source ?? 'the CLI'}. ` +
                        `Set "replaces: true" on it to override that deliberately.`,
                );
            }
        }

        for (const declared of listCommandOptions(plugin.commands)) {
            const shared = this.findRootOption(parseOptionFlags(declared.option));
            if (shared && !takesSameValue(shared.option, declared.option)) {
                conflicts.push(
                    `Option "${describeOption(declared.option)}" on "vendure ${declared.path.join(' ')}" is not ` +
                        `compatible with the shared option "${describeOption(shared.option)}" registered by ` +
                        `${shared.source ?? 'the CLI'}: one takes a value and the other does not.`,
                );
            }
        }

        return conflicts;
    }

    private findRootOption(parsed: ParsedCliOption): RegisteredOption | undefined {
        return Array.from(this.rootOptions.values()).find(entry => isSameOption(entry.option, parsed));
    }

    private listDeclaredCommandOptions(): Array<{ path: string[]; option: CliCommandOption }> {
        return listCommandOptions(this.toArray());
    }
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
