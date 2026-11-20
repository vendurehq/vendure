import { CommandContext, CommandPlan } from '@vendure/common/lib/command';

import { describeDatabase, lastAppliedMigration, loadProjectConfig } from './revert-migration.project.js';

/**
 * Names what a revert would undo: the config file, the database, and the last migration the
 * database has applied. The consent's digest covers all three, so a consent given for one
 * database or one migration never applies to another.
 */
export async function plan(input: { config?: string }, _ctx: CommandContext): Promise<CommandPlan> {
    const { config, configPath } = await loadProjectConfig(input.config);
    return {
        preview: {
            action: 'Revert the last applied database migration',
            config: configPath,
            database: describeDatabase(config),
            lastAppliedMigration: await lastAppliedMigration(config),
        },
        consents: ['revertMigration'],
    };
}
