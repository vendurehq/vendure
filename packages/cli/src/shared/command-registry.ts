import { Command } from 'commander';

import {
    CliCommandAction,
    CliCommandContext,
    CliCommandDefinition,
    CliCommandNode,
    CliCommandOption,
    hasCliSubcommands,
    isRunnableCliCommand,
} from './cli-command-definition';
import { CliCommandExit } from './cli-command-exit';
import { buildOptionFlags, parseOptionFlags } from './cli-command-options';

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
): void {
    const sharedOptions = declareOptions(program, rootOptions);
    for (const node of commands) {
        registerNode(program, node, [], sharedOptions);
    }
}

function registerNode(
    parent: Command,
    node: CliCommandNode,
    path: string[],
    sharedOptions: SharedOption[],
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
            registerNode(command, subcommand, commandPath, inheritedOptions);
        }
        if (runnable) {
            // Commander leaves out its implicit `help` subcommand when a command
            // has an action, so without this `vendure deploy help` would not work
            // the way `vendure config help` does. A `help` the plugin declared
            // itself wins, and no second one is added.
            command.addHelpCommand();
        }
    }

    if (!runnable) {
        // A group has no action: Commander prints its help and exits non-zero
        // when it is run without a subcommand.
        return;
    }

    command.action(async (...args: any[]) => {
        const unknownSubcommand = subcommands ? strayOperand(command, runnable) : undefined;
        if (unknownSubcommand !== undefined) {
            // Commander tries the subcommand names before it falls back to this
            // action, so an operand still spare here matched none of them.
            // Reporting it is what stops `vendure deploy plann` deploying.
            process.stderr.write(`error: unknown command '${unknownSubcommand}'\n`);
            process.exit(1);
        }
        fillSharedValues(command, commanderOptions(args), sharedOptions);
        const context: CliCommandContext = {
            inheritedOptions: readSharedValues(sharedOptions),
            commandPath,
        };
        // Exit is owned by the host so plugins can wrap built-in actions.
        process.exit(await runAction(runnable.action, args, context));
    });
}

/**
 * The first operand Commander has no home for: past the positional arguments the
 * command declares, and — because Commander resolves subcommands first — not the
 * name of one of its subcommands either.
 *
 * A command that declares both `arguments` and `subcommands` cannot tell a
 * mistyped subcommand from a value, because the operand fills a positional
 * before it is ever spare. Only a command with no positional left over is
 * protected.
 */
function strayOperand(command: Command, node: CliCommandDefinition): string | undefined {
    return command.args[node.arguments?.length ?? 0];
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
        addOption(command, option);
        declared.push({ attributeName: parseOptionFlags(option).attributeName, owner: command });

        for (const subOption of option.subOptions ?? []) {
            // Indent the description so the help output shows the nesting.
            const indentedSubOption = { ...subOption, description: `  └─ ${subOption.description}` };
            addOption(command, indentedSubOption);
            declared.push({
                attributeName: parseOptionFlags(indentedSubOption).attributeName,
                owner: command,
            });
        }
    }
    return declared;
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
