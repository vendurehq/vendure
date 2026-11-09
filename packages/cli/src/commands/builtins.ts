import { CliCommandDefinition, CliCommandNode, isRunnableCliCommand } from '../shared/cli-command-definition';

import { addCommandDef } from './add/command';
import { authCommandDef } from './auth/command';
import { buildCommandDef } from './build/command';
import { codemodCommandDef } from './codemod/command';
import { consoleCommandDef } from './console/command';
import { devCommandDef } from './dev/command';
import { doctorCommandDef } from './doctor/command';
import { migrateCommandDef } from './migrate/command';
import { pluginsCommandDef } from './plugins/command';
import { schemaCommandDef } from './schema/command';
import { startCommandDef } from './start/command';

/**
 * Built-in CLI commands in registration order.
 * Each command owns its definition next to its implementation (`commands/<name>/command.ts`).
 */
export const builtinCommandDefs: CliCommandNode[] = [
    addCommandDef,
    devCommandDef,
    buildCommandDef,
    startCommandDef,
    migrateCommandDef,
    codemodCommandDef,
    schemaCommandDef,
    doctorCommandDef,
    consoleCommandDef,
    authCommandDef,
    pluginsCommandDef,
];

/**
 * Built-in command definitions keyed by name, for reading a command's metadata.
 * Command groups such as `auth`, which have no action of their own, are not included.
 *
 * Do not call `builtinCommands.<name>.action(...)` to wrap a command: that
 * binds to the built-in and skips whatever other plugins have added. Use
 * `extendCommands` and call the `next` action the host hands the decorator.
 */
export const builtinCommands: Readonly<Record<string, CliCommandDefinition>> = Object.freeze(
    Object.fromEntries(
        builtinCommandDefs.filter(isRunnableCliCommand).map(command => [command.name, command]),
    ),
);
