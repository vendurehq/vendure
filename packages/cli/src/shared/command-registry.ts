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
    // Commander accepts an option anywhere on the command line once the
    // command that declares it has been reached, so `vendure --token X foo`
    // and `vendure foo --token X` are equivalent. Listing those options as
    // "Global Options" keeps subcommand help complete.
    program.configureHelp({ showGlobalOptions: true });

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
        fillSharedValues(command, sharedOptions);
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
    const supplied = new Set<string>();
    for (const { owner, attributeName } of sharedOptions) {
        const source = owner.getOptionValueSource(attributeName);
        if (source === undefined) {
            continue;
        }
        if (source === 'default' && (supplied.has(attributeName) || attributeName in values)) {
            continue;
        }
        if (source !== 'default') {
            supplied.add(attributeName);
        }
        values[attributeName] = owner.getOptionValue(attributeName);
    }
    return values;
}

/**
 * A command may declare an option with the same flag as a shared option, for
 * example the built-in `vendure plugins --json` when a plugin also registers a
 * shared `--json`. Commander gives the value to the shared option, so copy it
 * onto the command to keep both readings of the flag in agreement.
 *
 * This relies on Commander's `opts()` handing back its own `_optionValues`
 * rather than a copy, so writing here is visible in the options object it has
 * already passed to the action. `registerCommands() shares one value between a
 * shared option and a command option of the same name` pins that assumption.
 */
function fillSharedValues(command: Command, sharedOptions: SharedOption[]): void {
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
        command.setOptionValueWithSource(attributeName, owner.getOptionValue(attributeName), sharedSource);
    }
}
