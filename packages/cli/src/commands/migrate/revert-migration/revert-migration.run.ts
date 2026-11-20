import { CommandContext, fail } from '@vendure/common/lib/command';

import { requireProjectCore } from '../../../shared/project-core.js';

import { revertFailed } from './revert-migration.errors.js';
import { lastAppliedMigration, loadProjectConfig } from './revert-migration.project.js';

/** Reverts the last applied migration. The host has already checked the consent. */
export async function run(input: { config?: string }, ctx: CommandContext) {
    const { config } = await loadProjectConfig(input.config);
    const migration = await lastAppliedMigration(config);
    ctx.progress('Reverting the last migration');
    // With this set, the core function throws instead of printing the error and setting an exit code.
    process.env.VENDURE_RUNNING_IN_CLI = 'true';
    try {
        await requireProjectCore().revertLastMigration(config);
    } catch (e) {
        return fail(revertFailed, { message: e instanceof Error ? e.message : String(e) });
    } finally {
        delete process.env.VENDURE_RUNNING_IN_CLI;
    }
    return { reverted: true, migration };
}
