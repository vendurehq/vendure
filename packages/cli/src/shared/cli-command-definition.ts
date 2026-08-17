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

export interface CliCommandDefinition {
    name: string;
    description: string;
    arguments?: CliCommandArgument[];
    options?: CliCommandOption[];
    /**
     * Commander calling convention: positional arguments are passed first
     * (in the order they are declared in `arguments`), followed by the
     * parsed options object, followed by the Command instance itself.
     * E.g. for `vendure codemod <transform> [path]`:
     *   action(transform, path, options, command)
     *
     * May return a numeric process exit code. The CLI host calls
     * `process.exit` after the action settles so plugins can wrap built-ins
     * without a premature exit.
     */
    action: (...args: any[]) => Promise<void | number>;
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
