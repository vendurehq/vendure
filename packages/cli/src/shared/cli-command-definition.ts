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
 */
export interface ProjectCliPluginConfig {
    /**
     * When set and non-empty, only these packages are loaded as CLI plugins
     * (each must still declare `vendure.cliPlugin`).
     */
    plugins?: string[];
    /**
     * Package names to skip even if they declare a CLI plugin entry.
     */
    exclude?: string[];
}
