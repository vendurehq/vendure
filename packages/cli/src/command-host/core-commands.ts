import type { CommandDefinition } from '@vendure/common/lib/command';

import { addApiExtensionDefinition } from '../commands/add/api-extension/add-api-extension.command.js';
import { addCodegenDefinition } from '../commands/add/codegen/add-codegen.command.js';
import { addDashboardDefinition } from '../commands/add/dashboard/add-dashboard.command.js';
import { addEntityDefinition } from '../commands/add/entity/add-entity.command.js';
import { addJobQueueDefinition } from '../commands/add/job-queue/add-job-queue.command.js';
import { addPluginDefinition } from '../commands/add/plugin/create-new-plugin.command.js';
import { addServiceDefinition } from '../commands/add/service/add-service.command.js';
import { commandsDefinition } from '../commands/commands/commands.command.js';
import { devServerDefinitions } from '../commands/devserver/devserver.command.js';
import { doctorDefinition } from '../commands/doctor/doctor.command.js';
import { mcpInstallDefinition } from '../commands/mcp/install/mcp-install.command.js';
import { generateMigrationDefinition } from '../commands/migrate/generate-migration/generate-migration.command.js';
import { revertMigrationDefinition } from '../commands/migrate/revert-migration/revert-migration.command.js';
import { runMigrationDefinition } from '../commands/migrate/run-migration/run-migration.command.js';
import { storeCheckDefinition } from '../commands/store/check/store-check.command.js';

/**
 * The commands of `@vendure/cli` that are declared with `defineCommand`. The manifest build
 * writes them to `dist/vendure-commands.json`. The host loads this list only when a command runs.
 */
export const coreCommandDefinitions: CommandDefinition[] = [
    addApiExtensionDefinition,
    addCodegenDefinition,
    addDashboardDefinition,
    addEntityDefinition,
    addJobQueueDefinition,
    addPluginDefinition,
    addServiceDefinition,
    commandsDefinition,
    ...devServerDefinitions,
    doctorDefinition,
    mcpInstallDefinition,
    generateMigrationDefinition,
    revertMigrationDefinition,
    runMigrationDefinition,
    storeCheckDefinition,
];
