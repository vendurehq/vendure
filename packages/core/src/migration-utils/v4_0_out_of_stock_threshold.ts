import { QueryRunner } from 'typeorm';

import { copyGlobalSettingToChannels, globalStockSettings } from './v4_0_global_stock_settings';

/**
 * @description
 * The result of {@link migrateOutOfStockThresholdToChannels}.
 *
 * @docsCategory migration
 * @since 4.0.0
 */
export interface OutOfStockThresholdMigrationResult {
    /** The pre-v4 value read from `global_settings.outOfStockThreshold`, or undefined if already migrated. */
    globalOutOfStockThreshold: number | undefined;
    /** Channels whose stored `outOfStockThreshold` differed from the global value and was overwritten. */
    overwrittenChannels: Array<{ code: string; previous: number }>;
}

/**
 * @description
 * v4.0 data migration for the per-Channel out-of-stock threshold.
 *
 * Before v4, `GlobalSettings.outOfStockThreshold` was used by every ProductVariant with
 * `useGlobalOutOfStockThreshold`, and `Channel.outOfStockThreshold` existed but was never read.
 * From v4 the Channel value is used, and `GlobalSettings.outOfStockThreshold` is removed from the
 * API. This helper copies the global value to every Channel, so that every variant keeps its
 * current threshold, then sets the `global_settings.outOfStockThreshold` column to `NULL` to record
 * that the copy has been done. The column itself is kept (see
 * `GlobalSettings.legacyOutOfStockThreshold`), so neither `synchronize` nor a generated migration
 * drops the value before it is copied.
 *
 * Channels whose stored value differed are overwritten (it had no effect before) and are
 * returned and logged, so you can set them again on purpose after the upgrade.
 *
 * Table names honour the `entityPrefix` of the connection options and, on Postgres, the
 * `schema` option. The helper throws if the `global_settings` table cannot be found, rather than
 * treating that as "already migrated".
 *
 * Call it from your v4 migration, after the generated statements. Vendure v4 refuses to start
 * until it has run. It can be run again: the copy is skipped once done.
 *
 * @docsCategory migration
 * @since 4.0.0
 */
export async function migrateOutOfStockThresholdToChannels(
    queryRunner: QueryRunner,
): Promise<OutOfStockThresholdMigrationResult> {
    const { globalValue, overwrittenChannels } = await copyGlobalSettingToChannels(
        queryRunner,
        globalStockSettings.outOfStockThreshold,
    );
    return { globalOutOfStockThreshold: globalValue, overwrittenChannels };
}
