import { Command } from 'commander';

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

export function registerCommands(
    program: Command,
    commands: CliCommandNode[],
    rootOptions: CliCommandOption[] = [],
    getPluginExtensions: CliPluginExtensionAccessor = () => [],
): void {
    const sharedOptions = declareOptions(program, rootOptions);
    for (const node of commands) {
        registerNode(program, node, [], sharedOptions, getPluginExtensions);
    }
}

function registerNode(
    parent: Command,
    node: CliCommandNode,
    path: string[],
    sharedOptions: SharedOption[],
    getPluginExtensions: CliPluginExtensionAccessor,
): void {
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
        return;
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
function declareOptions(command: Command, options: CliCommandOption[]): SharedOption[] {
    const declared: SharedOption[] = [];
    for (const option of options) {
        declareOption(command, option, declared);

        for (const subOption of option.subOptions ?? []) {
            // Indent the description so the help output shows the nesting.
            declareOption(command, { ...subOption, description: `  └─ ${subOption.description}` }, declared);
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
 * accepts the repeat, lists it twice in help and matches the first declaration
 * when parsing. Commander 13 onwards throws instead, which would fail at
 * startup and take down the whole CLI rather than one command.
 *
 * Keeping the first declaration parses exactly as Commander 11 does, and drops
 * the duplicate help line. A plugin can hit this as readily as a built-in, so
 * it is handled here rather than in any one command's definition.
 */
function declareOption(command: Command, option: CliCommandOption, declared: SharedOption[]): void {
    const parsed = parseOptionFlags(option);
    const alreadyDeclared = command.options.some(
        existing =>
            existing.attributeName() === parsed.attributeName ||
            (parsed.short !== undefined && existing.short === parsed.short),
    );
    if (alreadyDeclared) {
        return;
    }
    addOption(command, option);
    declared.push({ attributeName: parsed.attributeName, owner: command });
}

function addOption(command: Command, option: CliCommandOption): void {
    command.option(buildOptionFlags(option), option.description, option.defaultValue);
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
