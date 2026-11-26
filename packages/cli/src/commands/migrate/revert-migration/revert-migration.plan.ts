import { CommandContext, CommandPlan, ErrorResult, fail, isErrorResult } from '@vendure/common/lib/command';

import { describeDatabase, lastAppliedMigration, openMigrationProject } from '../migration-project.js';

import { databaseUnreadable } from './revert-migration.errors.js';

/**
 * Names what a revert would undo: the config file, the database, and the last migration the
 * database has applied. The consent's digest covers all three, so a consent given for one
 * database or one migration never applies to another.
 */
export async function plan(
    input: { config?: string },
    ctx: CommandContext,
): Promise<CommandPlan | ErrorResult> {
    const project = await openMigrationProject(input.config, ctx);
    if (isErrorResult(project)) {
        return project;
    }
    const { config, configPath, resolvedBy } = project;
    let migration: string | null;
    try {
        migration = await lastAppliedMigration(config);
    } catch (e) {
        // A preview that cannot name the migration would let one consent cover any migration.
        return fail(databaseUnreadable, { message: e instanceof Error ? e.message : String(e) });
    }
    return {
        preview: {
            action: 'Revert the last applied database migration',
            config: configPath ?? `the config resolver of ${resolvedBy}`,
            database: describeDatabase(config),
            lastAppliedMigration: migration,
        },
        // With no migration applied, a revert changes nothing, so there is nothing to consent to.
        requiredConsents: migration === null ? [] : ['revertMigration'],
    };
}
