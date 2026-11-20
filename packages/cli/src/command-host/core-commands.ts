import type { CommandDefinition } from '@vendure/common/lib/command';

import { addCodegenCommand } from '../commands/add/codegen/add-codegen.command.js';
import { commandsCommand } from '../commands/commands/commands.command.js';
import { doctorCommand } from '../commands/doctor/doctor.command.js';
import { revertMigrationCommand } from '../commands/migrate/revert-migration/revert-migration.command.js';

/**
 * The commands of `@vendure/cli` that are declared with `defineCommand`. The manifest build
 * writes them to `dist/vendure-commands.json`. The host loads this list only when a command runs.
 */
export const coreCommandDefinitions: CommandDefinition[] = [
    addCodegenCommand,
    commandsCommand,
    doctorCommand,
    revertMigrationCommand,
];
