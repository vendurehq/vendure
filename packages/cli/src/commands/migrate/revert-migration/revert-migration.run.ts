import { CommandContext, fail, isErrorResult } from '@vendure/common/lib/command';

import { requireProjectCore, withCoreRunningInCli } from '../../../shared/project-core.js';
import { lastAppliedMigration, openMigrationProject } from '../migration-project.js';

import { databaseUnreadable, revertFailed } from './revert-migration.errors.js';

/** Reverts the last applied migration. The host has already checked the consent. */
export async function run(input: { config?: string }, ctx: CommandContext) {
    const project = await openMigrationProject(input.config, ctx);
    if (isErrorResult(project)) {
        return project;
    }
    const { config } = project;
    let migration: string | null;
    try {
        migration = await lastAppliedMigration(config);
    } catch (e) {
        return fail(databaseUnreadable, { message: e instanceof Error ? e.message : String(e) });
    }
    if (migration === null) {
        return { reverted: false, migration: null };
    }
    ctx.progress('Reverting the last migration');
    try {
        await withCoreRunningInCli(() => requireProjectCore().revertLastMigration(config));
    } catch (e) {
        return fail(revertFailed, { message: e instanceof Error ? e.message : String(e) });
    }
    return { reverted: true, migration };
}
