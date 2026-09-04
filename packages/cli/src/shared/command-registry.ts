import { Command } from 'commander';

import {
    CliCommandAction,
    CliCommandContext,
    CliCommandNode,
    CliCommandOption,
    isCliCommandGroup,
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

    if (isCliCommandGroup(node)) {
        const groupOptions = [...sharedOptions, ...declareOptions(command, node.options ?? [])];
        for (const subcommand of node.subcommands) {
            registerNode(command, subcommand, commandPath, groupOptions);
        }
        // A group has no action: Commander prints its help and exits non-zero
        // when it is run without a subcommand.
        return;
    }

    for (const arg of node.arguments ?? []) {
        command.argument(arg.required ? `<${arg.name}>` : `[${arg.name}]`, arg.description);
    }
    declareOptions(command, node.options ?? []);

    command.action(async (...args: any[]) => {
        fillSharedValues(command, commanderOptions(args), sharedOptions);
        const context: CliCommandContext = {
            inheritedOptions: readSharedValues(sharedOptions),
            commandPath,
        };
        // Exit is owned by the host so plugins can wrap built-in actions.
        process.exit(await runAction(node.action, args, context));
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
 * inherit them when the command is a group or the root program.
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
 * Reads the value of each shared option in scope. A value supplied on the
 * command line always beats a default, whichever level declared it, so a group
 * option carrying a `defaultValue` cannot discard what the user typed.
 */
function readSharedValues(sharedOptions: SharedOption[]): Record<string, any> {
    const values: Record<string, any> = {};
    for (const { owner, attributeName } of sharedOptions) {
        const source = owner.getOptionValueSource(attributeName);
        if (source === undefined) {
            continue;
        }
        if (source === 'default' && attributeName in values) {
            continue;
        }
        values[attributeName] = owner.getOptionValue(attributeName);
    }
    return values;
}

/**
 * Commander calls an action with the positional arguments, then the parsed
 * options, then the Command.
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
