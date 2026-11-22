import { CommandContext, fail } from '@vendure/common/lib/command';
import type { MigrationDiagnostic } from '@vendure/core';

import { requireProjectCore } from '../../../shared/project-core.js';
import { loadProjectConfig } from '../migration-project.js';

import { runFailed } from './run-migration.errors.js';

/** Runs the pending migrations, and reports what the database still lacks afterwards. */
export async function run(input: { config?: string }, ctx: CommandContext) {
    const { config } = await loadProjectConfig(input.config);
    ctx.progress('Running migrations');
    const diagnostics: MigrationDiagnostic[] = [];
    // With this set, the core function prints nothing, and throws instead of setting an exit code.
    process.env.VENDURE_RUNNING_IN_CLI = 'true';
    let migrationsRan: string[];
    try {
        migrationsRan = await requireProjectCore().runMigrations(config, {
            onDiagnostic: diagnostic => diagnostics.push(diagnostic),
        });
    } catch (e) {
        return fail(runFailed, { message: e instanceof Error ? e.message : String(e) });
    } finally {
        delete process.env.VENDURE_RUNNING_IN_CLI;
    }
    return {
        migrationsRan,
        diagnostics: diagnostics.map(({ code, lines }) => ({ code, lines })),
    };
}
