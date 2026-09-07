/**
 * An option on a CLI command.
 *
 * @since 3.8.0
 */
export interface CliCommandOption {
    long: string;
    short?: string;
    description: string;
    required?: boolean;
    defaultValue?: any;
    subOptions?: CliCommandOption[]; // Options that are only valid when this option is used
    // Interactive mode metadata
    interactiveId?: string; // ID for interactive selection (e.g., 'add-entity')
    interactiveCategory?: string; // Category label (e.g., 'Plugin: Entity')
    interactiveFn?: () => Promise<any>; // Function to execute in interactive mode
}

/**
 * A positional argument on a CLI command.
 *
 * @since 3.8.0
 */
export interface CliCommandArgument {
    name: string;
    description: string;
    required?: boolean;
}

/**
 * Values of the shared options that are in scope for a command, i.e. the root
 * options registered by a CLI plugin plus the options of every command the
 * command is nested in.
 *
 * The CLI host builds this from the parsed command line and passes it to the
 * action as the final argument, so a command never has to read or reparse
 * `process.argv`.
 *
 * Keys are Commander attribute names: the long flag without `--`, camel-cased.
 * `--api-token <token>` is therefore `apiToken`.
 *
 * @since 3.8.0
 */
export interface CliCommandContext<TInheritedOptions extends Record<string, any> = Record<string, any>> {
    /**
     * Values of the shared options in scope. A shared option is declared at
     * exactly one level — a flag declared on a command with subcommands that an
     * ancestor already shares is rejected at registration — so values do not
     * compete. Where a
     * command declares the same flag as a shared option, both read the same
     * value. A value supplied on the command line always beats a default.
     * Options that were neither supplied nor given a default value are omitted.
     */
    inheritedOptions: TInheritedOptions;
    /**
     * The names of the commands leading to this action, e.g.
     * `['config', 'server', 'set']` for `vendure config server set`.
     */
    commandPath: string[];
}

/**
 * A CLI command that runs an action.
 *
 * @since 3.8.0
 */
export interface CliCommandDefinition {
    name: string;
    description: string;
    arguments?: CliCommandArgument[];
    options?: CliCommandOption[];
    /**
     * Set to `true` to deliberately replace a top-level command of the same
     * name — a built-in, or one registered by an earlier plugin. Without it a
     * name collision is reported as an error and the plugin is skipped, so a
     * command can never be replaced by accident.
     *
     * @since 3.8.0
     */
    replaces?: boolean;
    /**
     * Commander calling convention: positional arguments are passed first
     * (in the order they are declared in `arguments`), followed by the
     * parsed options object, followed by the Command instance itself.
     * The CLI host appends a {@link CliCommandContext} as the final argument.
     * E.g. for `vendure codemod <transform> [path]`:
     *   action(transform, path, options, command, context)
     *
     * May return a numeric process exit code. The CLI host calls
     * `process.exit` after the action settles so plugins can wrap built-ins
     * without a premature exit.
     */
    action: CliCommandAction;
    /**
     * Commands nested under this one, e.g. the `plan` in `vendure deploy plan`.
     * Unlike a {@link CliCommandGroupDefinition}, the command keeps an action
     * of its own: running it without a subcommand runs that action rather than
     * printing help. Its `options` are shared with every command below it —
     * see {@link hasCliSubcommands}.
     *
     * A command with subcommands cannot also declare `arguments`: the first word
     * after the command name would be ambiguous, since it could equally name a
     * subcommand or fill an argument. Declaring both is rejected when the plugin
     * is registered. Take options instead, which are never ambiguous.
     *
     * A word that names no subcommand is therefore always a mistake, and is
     * reported as an unknown command rather than reaching the action, exactly as
     * it would be on a group.
     *
     * @since 3.8.0
     */
    subcommands?: CliCommandNode[];
}

/**
 * A command implementation, as the CLI host invokes it.
 *
 * @since 3.8.0
 */
export type CliCommandAction = (...args: any[]) => Promise<void | number>;

/**
 * A command that exists only to group subcommands, e.g. the `config` in
 * `vendure config server set`. A group has no action of its own: running it
 * without a subcommand prints its help. For a command that has subcommands
 * *and* runs an action, see {@link CliCommandDefinition.subcommands}.
 *
 * @since 3.8.0
 */
export interface CliCommandGroupDefinition {
    name: string;
    description: string;
    /**
     * Options shared by every command in this group. They are accepted both on
     * the group itself (`vendure config --profile x server set a b`) and on any
     * command below it (`vendure config server set a b --profile x`), and their
     * values reach actions via {@link CliCommandContext.inheritedOptions}.
     */
    options?: CliCommandOption[];
    subcommands: CliCommandNode[];
    /**
     * See {@link CliCommandDefinition.replaces}. Replacing a group replaces its
     * whole subtree.
     */
    replaces?: boolean;
}

/**
 * A node in a CLI command tree: a command that runs an action, a group of
 * further commands, or a command that does both.
 *
 * @since 3.8.0
 */
export type CliCommandNode = CliCommandDefinition | CliCommandGroupDefinition;

/**
 * A node that has commands nested under it, whether or not it also runs an
 * action of its own.
 */
export type CliCommandParent = CliCommandNode & { subcommands: CliCommandNode[] };

/**
 * Whether a node has commands nested under it.
 *
 * A node with subcommands shares its own `options` with every command below it,
 * whether or not it also runs an action. That is the distinction the option
 * scoping and tree walking need, and it is wider than {@link isCliCommandGroup},
 * which excludes a node that runs an action of its own.
 */
export function hasCliSubcommands(node: CliCommandNode): node is CliCommandParent {
    return Array.isArray(node.subcommands);
}

/**
 * Whether a node runs an action of its own. True of a plain command and of a
 * command that also has subcommands; false of a pure group.
 */
export function isRunnableCliCommand(node: CliCommandNode): node is CliCommandDefinition {
    return typeof (node as CliCommandDefinition).action === 'function';
}

/**
 * Whether a node exists only to group subcommands. A command that has both an
 * action and subcommands is not a group: see
 * {@link CliCommandDefinition.subcommands}.
 */
export function isCliCommandGroup(node: CliCommandNode): node is CliCommandGroupDefinition {
    return hasCliSubcommands(node) && !isRunnableCliCommand(node);
}

/**
 * What the host hands a {@link CliCommandDecorator}.
 *
 * @since 3.8.0
 */
export interface CliCommandDecoratorInput {
    /**
     * The command as it stands before this decorator: the original definition
     * plus every extension already applied to it. Read its `options`,
     * `arguments` and `description` to see what other plugins have contributed.
     *
     * This is a frozen deep copy, so `subcommands` tells a decorator whether the
     * command it is wrapping has commands nested under it without handing over
     * the nodes the registry goes on to use. Writing to any part of it throws.
     */
    command: Readonly<CliCommandDefinition>;
    /**
     * The action of that command. Call it to run everything beneath this
     * decorator, ending in the original implementation. Never import the
     * original action directly: `next` is what makes several plugins able to
     * wrap the same command.
     */
    next: CliCommandAction;
}

/**
 * Builds a replacement action that wraps the one it is given. The host calls it
 * once, when the plugin is registered.
 *
 * @since 3.8.0
 */
export type CliCommandDecorator = (input: CliCommandDecoratorInput) => CliCommandAction;

/**
 * Where each value sits, counting back from the end of a command action's
 * arguments. The host appends the context after the arguments Commander
 * supplies, so code inside the host that reads the tail before that point uses
 * offsets one smaller than these.
 */
const ACTION_TAIL_OFFSETS = { context: 1, command: 2, options: 3 } as const;

/**
 * Reads the {@link CliCommandContext} the host appends to a command action's
 * arguments. Use it instead of indexing into the argument list, which a plugin
 * has to do when it takes `...args` in order to forward them to `next`.
 *
 * @since 3.8.0
 */
export function readCommandContext<TInheritedOptions extends Record<string, any> = Record<string, any>>(
    args: readonly unknown[],
): CliCommandContext<TInheritedOptions> {
    const context = args[args.length - ACTION_TAIL_OFFSETS.context] as
        | CliCommandContext<TInheritedOptions>
        | undefined;
    if (!context || !Array.isArray(context.commandPath)) {
        throw new Error('No CliCommandContext found. Pass the full argument list a command action received.');
    }
    return context;
}

/**
 * Reads the parsed options Commander passed to a command action. See
 * {@link readCommandContext}.
 *
 * @since 3.8.0
 */
export function readCommandOptions<TOptions extends Record<string, any> = Record<string, any>>(
    args: readonly unknown[],
): TOptions {
    const options = args[args.length - ACTION_TAIL_OFFSETS.options];
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
        throw new Error('No parsed options found. Pass the full argument list a command action received.');
    }
    return options as TOptions;
}

/**
 * Adds to a command that is already registered instead of replacing it, so
 * that several plugins can contribute to the same command.
 *
 * Extensions are applied in `vendure.cli.plugins` order, so the last listed
 * plugin wraps the others and its decorator runs first.
 *
 * An extension contributes options, a description and action decoration. It
 * cannot add positional arguments: Commander passes one argument slot per
 * declared positional, so an appended argument would shift the options,
 * command and context an existing action receives.
 *
 * @since 3.8.0
 */
export interface CliCommandExtension {
    /**
     * The command to extend: `'dev'`, or `['config', 'server', 'set']` for a
     * nested one.
     */
    command: string | string[];
    /**
     * Replaces the description shown in help. When more than one plugin sets
     * it, the last listed plugin wins and the host writes a notice naming both.
     */
    description?: string;
    /**
     * Options added to the command, keeping the options already declared on it.
     */
    options?: CliCommandOption[];
    /**
     * Wraps the command's action.
     */
    decorate?: CliCommandDecorator;
}

/**
 * Project-level CLI plugin discovery settings under `package.json#vendure.cli`.
 *
 * Plugin packages are discovered from direct dependencies that declare
 * `vendure.cliPlugin`, but are only **loaded** when listed in `plugins`
 * (explicit activation). Use `vendure plugins` to manage this list.
 *
 * @since 3.8.0
 */
export interface ProjectCliPluginConfig {
    /**
     * Allowlist of packages to load as CLI plugins, in registration order.
     * A name that is already taken is rejected unless the command sets
     * `replaces: true`; among plugins that do, the last listed wins. Command
     * extensions are applied in the same order, and all of them are kept.
     * Each must be a direct dependency and declare `vendure.cliPlugin`.
     * When missing or empty, no plugins are loaded — disabling a plugin is
     * simply not listing it.
     */
    plugins?: string[];
}
