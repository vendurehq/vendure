import { CliCommandDefinition } from './cli-command-definition';

/**
 * A CLI plugin that can add new commands or replace existing ones.
 *
 * Packages declare their plugin entry in `package.json`:
 *
 * ```json
 * {
 *   "vendure": {
 *     "cliPlugin": "./dist/cli-plugin.js"
 *   }
 * }
 * ```
 */
export interface CliPlugin {
    /**
     * Stable plugin id, typically the npm package name (e.g. `@vendure/cloud`).
     */
    id: string;
    /**
     * Commands to register. A command whose `name` matches a built-in
     * (or previously registered) command replaces it.
     */
    commands: CliCommandDefinition[];
}

/**
 * Validates and returns a CLI plugin definition for export from a plugin package.
 */
export function defineCliPlugin(plugin: CliPlugin): CliPlugin {
    if (!plugin || typeof plugin !== 'object') {
        throw new Error('defineCliPlugin: plugin must be an object');
    }
    if (typeof plugin.id !== 'string' || plugin.id.length === 0) {
        throw new Error('defineCliPlugin: plugin.id must be a non-empty string');
    }
    if (!Array.isArray(plugin.commands)) {
        throw new Error(`defineCliPlugin: plugin "${plugin.id}" must provide a commands array`);
    }
    for (const command of plugin.commands) {
        if (!command || typeof command.name !== 'string' || command.name.length === 0) {
            throw new Error(`defineCliPlugin: plugin "${plugin.id}" has a command with an invalid name`);
        }
        if (typeof command.action !== 'function') {
            throw new Error(
                `defineCliPlugin: plugin "${plugin.id}" command "${command.name}" must provide an action function`,
            );
        }
    }
    return plugin;
}

export function isCliPlugin(value: unknown): value is CliPlugin {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const candidate = value as Partial<CliPlugin>;
    return typeof candidate.id === 'string' && Array.isArray(candidate.commands);
}
