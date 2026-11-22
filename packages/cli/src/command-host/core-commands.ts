import type { CommandDefinition } from '@vendure/common/lib/command';

import { addCodegenDefinition } from '../commands/add/codegen/add-codegen.command.js';
import { commandsDefinition } from '../commands/commands/commands.command.js';
import { doctorDefinition } from '../commands/doctor/doctor.command.js';
import { revertMigrationDefinition } from '../commands/migrate/revert-migration/revert-migration.command.js';

/**
 * The commands of `@vendure/cli` that are declared with `defineCommand`. The manifest build
 * writes them to `dist/vendure-commands.json`. The host loads this list only when a command runs.
 */
export const coreCommandDefinitions: CommandDefinition[] = [
    addCodegenDefinition,
    commandsDefinition,
    doctorDefinition,
    revertMigrationDefinition,
];
