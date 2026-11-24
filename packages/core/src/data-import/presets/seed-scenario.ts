import { INestApplicationContext } from '@nestjs/common';
import { createRequire } from 'module';
import path from 'path';

import { RequestContext } from '../../api/common/request-context';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { SeedSentinelService } from '../../service/helpers/seed-sentinel/seed-sentinel.service';

import { createSuperAdminContext } from './preset-context';
import { getPreset } from './preset-registry';
import { scenarioAlreadySeededError, scenarioInvalidError, scenarioPresetMismatchError } from './seed-errors';

/**
 * @description
 * A scenario pack: demo data that builds on a base-data preset. A package exports it as `scenario`
 * or as its default export.
 *
 * `seed` writes the transactional data. It runs in the transaction that also writes the
 * `vendure.seed.scenario` sentinel, so a failure leaves neither, and the scenario is tried again on
 * the next run. Work for the job queue, such as assets and the search index, goes in `afterCommit`,
 * which runs after the commit and must be safe to run twice.
 *
 * @docsCategory import-export
 * @docsPage Scenarios
 * @since 4.0.0
 */
export interface ScenarioPack {
    name: string;
    /** The name of the preset the scenario builds on, one of `listPresets()`. */
    preset: string;
    seed(ctx: RequestContext, app: INestApplicationContext): Promise<void>;
    afterCommit?(ctx: RequestContext, app: INestApplicationContext): Promise<void>;
}

/**
 * @description
 * Where a scenario comes from, as `.vendure/create.json` records it.
 *
 * @docsCategory import-export
 * @docsPage Scenarios
 * @since 4.0.0
 */
export interface ScenarioReference {
    name: string;
    package: string;
    version: string;
}

/**
 * @description
 * Checks that `value` is a {@link ScenarioPack} whose `preset` is a known preset. Throws a
 * {@link SeedError} with the code `core.scenario-invalid` otherwise.
 *
 * @docsCategory import-export
 * @docsPage Scenarios
 * @since 4.0.0
 */
export function validateScenarioPack(value: unknown, packageName: string): ScenarioPack {
    if (typeof value !== 'object' || value === null) {
        throw scenarioInvalidError(packageName, 'exports no scenario');
    }
    const pack = value as Partial<ScenarioPack>;
    if (typeof pack.name !== 'string' || !pack.name) {
        throw scenarioInvalidError(packageName, 'has no name');
    }
    if (typeof pack.preset !== 'string' || !getPreset(pack.preset)) {
        throw scenarioInvalidError(packageName, `declares an unknown preset "${String(pack.preset)}"`);
    }
    if (typeof pack.seed !== 'function') {
        throw scenarioInvalidError(packageName, 'has no seed function');
    }
    if (pack.afterCommit !== undefined && typeof pack.afterCommit !== 'function') {
        throw scenarioInvalidError(packageName, 'has an afterCommit that is not a function');
    }
    return pack as ScenarioPack;
}

/**
 * @description
 * Loads the scenario pack of a {@link ScenarioReference}, resolving the package from `projectDir`.
 *
 * @docsCategory import-export
 * @docsPage Scenarios
 * @since 4.0.0
 */
export function loadScenarioPack(
    reference: ScenarioReference,
    projectDir: string = process.cwd(),
): ScenarioPack {
    let mod: any;
    try {
        const projectRequire = createRequire(path.join(projectDir, 'package.json'));
        mod = projectRequire(reference.package);
    } catch (e: any) {
        throw scenarioInvalidError(
            reference.package,
            `could not be loaded from ${projectDir}: ${e instanceof Error ? e.message : String(e)}`,
        );
    }
    return validateScenarioPack(mod?.scenario ?? mod?.default ?? mod, reference.package);
}

/**
 * @description
 * Seeds a scenario pack into a database that was seeded with the pack's preset. It never applies
 * the preset itself.
 *
 * The pack's data and the `vendure.seed.scenario` sentinel are written in one transaction. Then the
 * pack's `afterCommit` runs. It refuses with a {@link SeedError}:
 *
 * - `core.scenario-preset-mismatch` when the `vendure.seed.preset` sentinel is absent or names
 *   another preset;
 * - `core.scenario-already-seeded` when the `vendure.seed.scenario` sentinel exists.
 *
 * @docsCategory import-export
 * @docsPage Scenarios
 * @since 4.0.0
 */
export async function seedScenario(
    app: INestApplicationContext,
    reference: ScenarioReference,
    pack: ScenarioPack,
): Promise<{ scenario: string; preset: string }> {
    if (pack.name !== reference.name) {
        throw scenarioInvalidError(
            reference.package,
            `declares the scenario "${pack.name}", but the record names "${reference.name}"`,
        );
    }
    const connection = app.get(TransactionalConnection);
    const sentinels = app.get(SeedSentinelService);
    const ctx = await createSuperAdminContext(app);

    await connection.withTransaction(ctx, async txCtx => {
        const appliedScenario = await sentinels.getScenarioSentinel(txCtx);
        if (appliedScenario) {
            throw scenarioAlreadySeededError(appliedScenario.name);
        }
        const appliedPreset = await sentinels.getPresetSentinel(txCtx);
        if (appliedPreset?.name !== pack.preset) {
            throw scenarioPresetMismatchError({
                scenario: reference.name,
                preset: pack.preset,
                appliedPreset: appliedPreset?.name,
            });
        }
        await pack.seed(txCtx, app);
        await sentinels.setScenarioSentinel(txCtx, {
            name: reference.name,
            package: reference.package,
            version: reference.version,
            appliedAt: new Date().toISOString(),
        });
    });
    if (pack.afterCommit) {
        await pack.afterCommit(ctx, app);
    }
    return { scenario: reference.name, preset: pack.preset };
}
