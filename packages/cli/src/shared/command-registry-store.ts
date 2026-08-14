import pc from 'picocolors';

import { CliCommandDefinition } from './cli-command-definition';
import { CliPlugin } from './cli-plugin';

/**
 * In-memory registry of CLI commands. Supports adding new commands and
 * replacing existing ones (last registration wins).
 */
export class CommandRegistry {
    private readonly commands = new Map<string, CliCommandDefinition>();

    /**
     * Registers built-in or plugin commands. When a command name already
     * exists, it is replaced and a short notice is written to stderr.
     */
    registerAll(commands: CliCommandDefinition[], source?: string): void {
        for (const command of commands) {
            this.register(command, source);
        }
    }

    register(command: CliCommandDefinition, source?: string): void {
        if (this.commands.has(command.name) && source) {
            process.stderr.write(
                pc.dim(`Replaced command "${command.name}" via ${source}\n`),
            );
        }
        this.commands.set(command.name, command);
    }

    /**
     * Applies all commands from a loaded CLI plugin.
     */
    applyPlugin(plugin: CliPlugin): void {
        this.registerAll(plugin.commands, plugin.id);
    }

    get(name: string): CliCommandDefinition | undefined {
        return this.commands.get(name);
    }

    has(name: string): boolean {
        return this.commands.has(name);
    }

    toArray(): CliCommandDefinition[] {
        return Array.from(this.commands.values());
    }
}
