import { CommandContext, fail, isErrorResult } from '@vendure/common/lib/command';

import { requireProjectCore, withCoreRunningInCli } from '../../../shared/project-core.js';
import { defaultMigrationDir, openMigrationProject } from '../migration-project.js';

import { generateFailed } from './generate-migration.errors.js';

/** Generates a migration from the difference between the entities and the database schema. */
export async function run(
    input: { name: string; outputDir?: string; fromEmpty?: boolean; config?: string },
    ctx: CommandContext,
) {
    const project = await openMigrationProject(input.config, ctx);
    if (isErrorResult(project)) {
        return project;
    }
    const outputDir = input.outputDir ?? defaultMigrationDir(project);
    ctx.progress(
        input.fromEmpty
            ? 'Generating a baseline migration from an empty shadow database'
            : 'Generating the migration',
    );
    let file: string | undefined;
    try {
        file = await withCoreRunningInCli(() =>
            requireProjectCore().generateMigration(project.config, {
                name: input.name,
                outputDir,
                fromEmpty: input.fromEmpty,
            }),
        );
    } catch (e) {
        return fail(generateFailed, { message: e instanceof Error ? e.message : String(e) });
    }
    return { file: file ?? null, outputDir };
}
