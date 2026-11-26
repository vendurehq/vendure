import { CommandContext, fail, isErrorResult } from '@vendure/common/lib/command';
import type { MigrationDiagnostic } from '@vendure/core';

import { requireProjectCore, withCoreRunningInCli } from '../../../shared/project-core.js';
import { openMigrationProject } from '../migration-project.js';

import { runFailed } from './run-migration.errors.js';

/** Runs the pending migrations, and reports what the database still lacks afterwards. */
export async function run(input: { config?: string }, ctx: CommandContext) {
    const project = await openMigrationProject(input.config, ctx.signal);
    if (isErrorResult(project)) {
        return project;
    }
    const { config } = project;
    ctx.progress('Running migrations');
    const diagnostics: MigrationDiagnostic[] = [];
    let migrationsRan: string[];
    try {
        migrationsRan = await withCoreRunningInCli(() =>
            requireProjectCore().runMigrations(config, {
                onDiagnostic: diagnostic => diagnostics.push(diagnostic),
            }),
        );
    } catch (e) {
        return fail(runFailed, { message: e instanceof Error ? e.message : String(e) });
    }
    return {
        migrationsRan,
        diagnostics: diagnostics.map(({ code, lines }) => ({ code, lines })),
    };
}
