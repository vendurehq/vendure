import { Command } from 'commander';
import pc from 'picocolors';

import {
    CliCommandAction,
    CliCommandContext,
    CliCommandNode,
    CliCommandOption,
    hasCliSubcommands,
    isRunnableCliCommand,
} from './cli-command-definition';
import { CliCommandExit } from './cli-command-exit';
import { buildOptionFlags, parseOptionFlags } from './cli-command-options';
import { CliPluginExtensionAccessor } from './cli-plugin-extension';

/**
 * An option declared on an ancestor of a command. Commander stores the parsed
 * value on the command that declares the option, so the owner is kept here to
 * read the value back when the action runs.
 */
interface SharedOption {
    attributeName: string;
    owner: Command;
}

export interface RegisterCommandsOptions {
    /** Options declared on the program itself, and so shared by every command. */
    rootOptions?: CliCommandOption[];
    /** Reads plugin contributions registered for a named extension point. */
    getPluginExtensions?: CliPluginExtensionAccessor;
    /**
     * Top-level command name to the id of the plugin that registered it, as
     * {@link CommandRegistry.getCommandSources} returns it. Commands absent
     * from the map are built-ins.
     *
     * Used only to group the help output: a command behaves the same whether
     * a plugin or the CLI itself provides it, and is typed the same way.
     */
    commandSources?: ReadonlyMap<string, string>;
    /**
     * Root option attribute name to the id of the plugin that registered it,
     * as {@link CommandRegistry.getRootOptionSources} returns it. Options
     * absent from the map belong to the CLI itself.
     *
     * Used only to group the help output, like {@link commandSources}. Note
     * that only the root help groups them: the "Global Options" section a
     * subcommand's help shows is one flat list in Commander, whatever group
     * the options are in.
     */
    rootOptionSources?: ReadonlyMap<string, string>;
}

/**
 * The help heading commands from `packageName` are listed under.
 *
 * The package name is used unchanged rather than a prettier display name, so
 * the heading names the exact thing to install, enable or remove.
 */
function pluginCommandsHeading(packageName: string): string {
    return `Commands from ${packageName}:`;
}

/**
 * The help heading the shared options registered by `packageName` are listed
 * under. Worded to match {@link pluginCommandsHeading}, so one package reads
 * the same way wherever it appears.
 */
function pluginOptionsHeading(packageName: string): string {
    return `Options from ${packageName}:`;
}

/**
 * Splits a heading built by {@link pluginCommandsHeading} or
 * {@link pluginOptionsHeading} back into its parts, so
 * {@link styleHelpTitle} can pick the package name out of it. Kept beside the
 * two builders: it has to match what they produce, and `styleTitle` hands
 * Commander's help back nothing but the finished string.
 */
const PLUGIN_HEADING = /^((?:Commands|Options) from )(.+)(:)$/;

/**
 * Styles one help section heading.
 *
 * Every heading is bold, including the CLI's own `Commands:` and `Options:`,
 * so the sections read as peers rather than a plugin's looking like an aside.
 * Within a plugin's heading the package name is tinted as well, which is what
 * visibly pairs its "Commands from" section with its "Options from" one. The
 * tint is bold too, so the heading is one weight throughout.
 *
 * Nothing is said by colour alone — the heading names the package in words —
 * so a monochrome terminal loses nothing. Commander strips the escape codes
 * itself when the output is not a terminal, or when NO_COLOR is set.
 */
export function styleHelpTitle(title: string, colors: HeadingColors = pc): string {
    const match = PLUGIN_HEADING.exec(title);
    if (!match) {
        return colors.bold(title);
    }
    const [, label, packageName, colon] = match;
    // Nested rather than concatenated: styling the parts separately would
    // close the bold run before the tint opens, leaving the package name at
    // normal weight beside a bold label.
    return colors.bold(label + colors.cyan(packageName) + colon);
}

/**
 * The palette {@link styleHelpTitle} paints with. It defaults to picocolors,
 * which emits nothing unless the terminal supports colour, so a test has to
 * pass `createColors(true)` to see what a colour terminal would get.
 */
export type HeadingColors = Pick<typeof pc, 'bold' | 'cyan'>;

export function registerCommands(
    program: Command,
    commands: CliCommandNode[],
    options: RegisterCommandsOptions = {},
): void {
    const {
        rootOptions = [],
        getPluginExtensions = () => [],
        commandSources,
        rootOptionSources,
    } = options;
    const sharedOptions = declareOptions(program, rootOptions, rootOptionSources);
    for (const node of commands) {
        const command = registerNode(program, node, [], sharedOptions, getPluginExtensions);
        const source = commandSources?.get(node.name);
        if (source) {
            // Commander groups by the heading text itself, so every command
            // from one package lands in one section without further
            // bookkeeping. Commands left ungrouped keep Commander's own
            // "Commands:" heading, which is where the built-ins stay.
            command.helpGroup(pluginCommandsHeading(source));
        }
    }
}

/**
 * Registers a node and everything nested under it, returning the Commander
 * command it created so the caller can group it in the help output.
 */
function registerNode(
    parent: Command,
    node: CliCommandNode,
    path: string[],
    sharedOptions: SharedOption[],
    getPluginExtensions: CliPluginExtensionAccessor,
): Command {
    const command = parent.command(node.name).description(node.description);
    const commandPath = [...path, node.name];
    const runnable = isRunnableCliCommand(node) ? node : undefined;
    const subcommands = hasCliSubcommands(node) ? node.subcommands : undefined;

    for (const arg of runnable?.arguments ?? []) {
        command.argument(arg.required ? `<${arg.name}>` : `[${arg.name}]`, arg.description);
    }
    const ownOptions = declareOptions(command, node.options ?? []);

    if (subcommands) {
        // A node with subcommands shares its options with every command below
        // it; hasCliSubcommands explains why.
        const inheritedOptions = [...sharedOptions, ...ownOptions];
        for (const subcommand of subcommands) {
            registerNode(command, subcommand, commandPath, inheritedOptions, getPluginExtensions);
        }
        if (runnable) {
            // A command with subcommands takes no positional arguments, so any
            // operand left here is a mistyped subcommand for the action below to
            // reject. Said explicitly because Commander's own default for this
            // has changed between major versions.
            command.allowExcessArguments(true);
            // Commander leaves out its implicit `help` subcommand once a command
            // has an action, so without this `vendure deploy help` would not work
            // the way `vendure config help` does. Skipped when the plugin
            // declares its own `help`, which Commander would otherwise list
            // twice.
            if (!subcommands.some(subcommand => subcommand.name === 'help')) {
                command.addHelpCommand();
            }
        }
    }

    if (!runnable) {
        // A group has no action: Commander prints its help and exits non-zero
        // when it is run without a subcommand.
        return command;
    }

    command.action(async (...args: any[]) => {
        if (subcommands && command.args.length > 0) {
            // Commander tries the subcommand names before it falls back to this
            // action, and a command with subcommands declares no arguments, so a
            // word still sitting here named no subcommand. Reporting it through
            // Commander is what stops `vendure deploy plann` deploying, and gives
            // the same message and "did you mean" hint that a group gives.
            reportUnknownSubcommand(command);
        }
        fillSharedValues(command, commanderOptions(args), sharedOptions);
        const context: CliCommandContext = {
            inheritedOptions: readSharedValues(sharedOptions),
            commandPath,
            getPluginExtensions,
        };
        // Exit is owned by the host so plugins can wrap built-in actions.
        process.exit(await runAction(runnable.action, args, context));
    });

    return command;
}

/**
 * Reports a word that named no subcommand, the way Commander reports one on a
 * command that has no action of its own.
 *
 * `unknownCommand` assembles the "did you mean" hint from the visible
 * subcommands and routes through `Command#error`, so the message, the output
 * channel configured by `configureOutput` and the exit code all match what a
 * group produces. Commander calls it itself but has never declared it in its
 * typings, hence the cast. The fallback keeps the channel and exit code right,
 * losing only the hint, should a later version drop it.
 */
function reportUnknownSubcommand(command: Command): never {
    const commander = command as Command & { unknownCommand?: () => never };
    if (typeof commander.unknownCommand === 'function') {
        commander.unknownCommand();
    }
    return command.error(`error: unknown command '${command.args[0]}'`, {
        code: 'commander.unknownCommand',
    });
}

/**
 * Runs a command action and turns its outcome into an exit code. Commander
 * passes positional args first, then the options object and the Command
 * instance; the host appends the context.
 */
async function runAction(action: CliCommandAction, args: any[], context: CliCommandContext): Promise<number> {
    try {
        const result = await action(...args, context);
        return typeof result === 'number' ? result : 0;
    } catch (e) {
        if (e instanceof CliCommandExit) {
            return e.exitCode;
        }
        process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
        return 1;
    }
}

/**
 * Declares options on a command and describes them for any descendants, which
 * inherit them when the command has subcommands or is the root program.
 */
function declareOptions(
    command: Command,
    options: CliCommandOption[],
    sources?: ReadonlyMap<string, string>,
): SharedOption[] {
    const declared: SharedOption[] = [];
    for (const option of options) {
        const source = sources?.get(parseOptionFlags(option).attributeName);
        const helpGroup = source === undefined ? undefined : pluginOptionsHeading(source);
        declareOption(command, option, declared, helpGroup);

        for (const subOption of option.subOptions ?? []) {
            // Indent the description so the help output shows the nesting.
            // Grouped with its parent, which is the option it is indented under.
            declareOption(
                command,
                { ...subOption, description: `  └─ ${subOption.description}` },
                declared,
                helpGroup,
            );
        }
    }
    return declared;
}

/**
 * Declares one option on a command, unless that flag is already declared there.
 *
 * One sub-option can belong to more than one parent — `vendure add` takes
 * `--selected-plugin` with either `-e` or `-s` — and every sub-option is
 * flattened onto the same command, so the flag arrives twice. Commander 11
 * accepted the repeat, listed it twice in help and matched the first
 * declaration when parsing. Commander 13 onwards throws instead, which would
 * fail at startup and take down the whole CLI rather than one command.
 *
 * Keeping the first declaration parses exactly as Commander 11 did, and drops
 * the duplicate help line. A plugin can hit this as readily as a built-in, so
 * it is handled here rather than in any one command's definition.
 */
function declareOption(
    command: Command,
    option: CliCommandOption,
    declared: SharedOption[],
    helpGroup?: string,
): void {
    const parsed = parseOptionFlags(option);
    const alreadyDeclared = command.options.some(
        existing =>
            existing.attributeName() === parsed.attributeName ||
            (parsed.short !== undefined && existing.short === parsed.short),
    );
    if (alreadyDeclared) {
        return;
    }
    addOption(command, option, helpGroup);
    declared.push({ attributeName: parsed.attributeName, owner: command });
}

/**
 * Builds the option the way `Command#option` does — create it, give it the
 * default value, add it — with the chance to put it in a help group on the
 * way, which `Command#option` gives no way to do.
 */
function addOption(command: Command, option: CliCommandOption, helpGroup?: string): void {
    const created = command.createOption(buildOptionFlags(option), option.description);
    created.default(option.defaultValue);
    if (helpGroup !== undefined) {
        created.helpGroup(helpGroup);
    }
    command.addOption(created);
}

/**
 * Reads the value of each shared option in scope.
 *
 * No two entries can share a name: registration rejects a flag shared by both
 * the root and a command with subcommands, or by two such commands on the same
 * branch, whichever order the plugins load in. So there is nothing here to
 * resolve — an option has one owner, and that owner holds its value.
 */
function readSharedValues(sharedOptions: SharedOption[]): Record<string, any> {
    const values: Record<string, any> = {};
    for (const { owner, attributeName } of sharedOptions) {
        if (owner.getOptionValueSource(attributeName) !== undefined) {
            values[attributeName] = owner.getOptionValue(attributeName);
        }
    }
    return values;
}

/**
 * Commander calls an action with the positional arguments, then the parsed
 * options, then the Command. This runs before the host appends the context, so
 * the offset is one less than the exported `readCommandOptions` uses.
 */
function commanderOptions(args: any[]): Record<string, any> {
    return args[args.length - 2] ?? {};
}

/**
 * A command may declare an option with the same flag as a shared option, for
 * example the built-in `vendure plugins --json` when a plugin also registers a
 * shared `--json`. Commander gives the value to the shared option, so copy it
 * onto the command to keep both readings of the flag in agreement.
 *
 * The value is written into the options object Commander passed to the action,
 * so this does not depend on `opts()` returning its internal store by
 * reference. It is also set on the Command, for an action that reads it there.
 */
function fillSharedValues(
    command: Command,
    options: Record<string, any>,
    sharedOptions: SharedOption[],
): void {
    for (const { owner, attributeName } of sharedOptions) {
        const sharedSource = owner.getOptionValueSource(attributeName);
        if (sharedSource === undefined) {
            continue;
        }
        if (!command.options.some(option => option.attributeName() === attributeName)) {
            continue;
        }
        const localSource = command.getOptionValueSource(attributeName);
        if (localSource !== undefined && localSource !== 'default') {
            continue;
        }
        const value = owner.getOptionValue(attributeName);
        command.setOptionValueWithSource(attributeName, value, sharedSource);
        options[attributeName] = value;
    }
}
