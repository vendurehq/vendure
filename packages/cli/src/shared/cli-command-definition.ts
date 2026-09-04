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

export interface CliCommandArgument {
    name: string;
    description: string;
    required?: boolean;
}

/**
 * Values of the shared options that are in scope for a command, i.e. the root
 * options registered by a CLI plugin plus the options of every command group
 * the command is nested in.
 *
 * The CLI host builds this from the parsed command line and passes it to the
 * action as the final argument, so a command never has to read or reparse
 * `process.argv`.
 *
 * Keys are Commander attribute names: the long flag without `--`, camel-cased.
 * `--api-token <token>` is therefore `apiToken`.
 */
export interface CliCommandContext<TInheritedOptions extends Record<string, any> = Record<string, any>> {
    /**
     * Values of the shared options in scope, resolved with nearest-wins
     * precedence: a value given on the command itself overrides the same option
     * given on a parent group, which overrides the same option given at the root.
     * Options that were neither supplied nor given a default value are omitted.
     */
    inheritedOptions: TInheritedOptions;
    /**
     * The names of the commands leading to this action, e.g.
     * `['config', 'server', 'set']` for `vendure config server set`.
     */
    commandPath: string[];
}

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
    action: (...args: any[]) => Promise<void | number>;
}

/**
 * A command that exists only to group subcommands, e.g. the `config` in
 * `vendure config server set`. A group has no action of its own: running it
 * without a subcommand prints its help.
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
 * A node in a CLI command tree: either a command that runs an action, or a
 * group of further commands.
 */
export type CliCommandNode = CliCommandDefinition | CliCommandGroupDefinition;

export function isCliCommandGroup(node: CliCommandNode): node is CliCommandGroupDefinition {
    return Array.isArray((node as CliCommandGroupDefinition).subcommands);
}

/**
 * Project-level CLI plugin discovery settings under `package.json#vendure.cli`.
 *
 * Plugin packages are discovered from direct dependencies that declare
 * `vendure.cliPlugin`, but are only **loaded** when listed in `plugins`
 * (explicit activation). Use `vendure plugins` to manage this list.
 */
export interface ProjectCliPluginConfig {
    /**
     * Allowlist of packages to load as CLI plugins, in registration order
     * (last listed wins when two plugins register the same command name).
     * Each must be a direct dependency and declare `vendure.cliPlugin`.
     * When missing or empty, no plugins are loaded — disabling a plugin is
     * simply not listing it.
     */
    plugins?: string[];
}
