import { CommandContext, fail, isErrorResult } from '@vendure/common/lib/command';

import { requireProjectCore } from '../../../shared/project-core.js';
import { migrationDirs, openMigrationProject } from '../migration-project.js';

import { generateFailed } from './generate-migration.errors.js';

/** Generates a migration from the difference between the entities and the database schema. */
export async function run(
    input: { name: string; outputDir?: string; fromEmpty?: boolean; config?: string },
    ctx: CommandContext,
) {
    const project = await openMigrationProject(input.config);
    if (isErrorResult(project)) {
        return project;
    }
    const outputDir = input.outputDir ?? migrationDirs(project)[0];
    ctx.progress(
        input.fromEmpty
            ? 'Generating a baseline migration from an empty shadow database'
            : 'Generating the migration',
    );
    // With this set, the core function prints nothing.
    process.env.VENDURE_RUNNING_IN_CLI = 'true';
    let file: string | undefined;
    try {
        file = await requireProjectCore().generateMigration(project.config, {
            name: input.name,
            outputDir,
            fromEmpty: input.fromEmpty,
        });
    } catch (e) {
        return fail(generateFailed, { message: e instanceof Error ? e.message : String(e) });
    } finally {
        delete process.env.VENDURE_RUNNING_IN_CLI;
    }
    return { file: file ?? null, outputDir };
}
