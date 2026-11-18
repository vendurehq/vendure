/* eslint-disable no-console */
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { QueryRunner } from 'typeorm';

import { copyGlobalSettingToChannels, globalStockSettings } from './v4_0_global_stock_settings';
import { qualifiedTableName } from './v4_0_role_assignments';

/**
 * @description
 * The result of {@link migrateTrackInventoryToChannels}.
 *
 * @docsCategory migration
 * @since 4.0.0
 */
export interface TrackInventoryMigrationResult {
    /** The pre-v4 value read from `global_settings.trackInventory`, or undefined if already migrated. */
    globalTrackInventory: boolean | undefined;
    /** Channels whose stored `trackInventory` differed from the global value and was overwritten. */
    overwrittenChannels: Array<{ code: string; previous: boolean }>;
    /** The number of stock movements whose `tracked` state was filled in. */
    filledStockMovements: number;
}

/**
 * @description
 * v4.0 data migration for granular inventory tracking (#2908).
 *
 * Before v4, `GlobalSettings.trackInventory` was the default for every ProductVariant set to
 * `INHERIT`, and `Channel.trackInventory` existed but was never read. From v4 the Channel value
 * is the default, and `GlobalSettings.trackInventory` is removed from the API. This helper copies
 * the global value to every Channel, so that every variant keeps its current behaviour, then sets
 * the `global_settings.trackInventory` column to `NULL` to record that the copy has been done.
 * It then fills the new `StockMovement.tracked` for the stock movements recorded before v4.0,
 * with the rule that applied when they were recorded (see below).
 * The column itself is kept (see `GlobalSettings.legacyTrackInventory`), so neither
 * `synchronize` nor a generated migration drops the value before it is copied.
 *
 * Channels whose stored value differed are overwritten (it had no effect before) and are
 * returned and logged, so you can set them again on purpose after the upgrade.
 *
 * The new `stock_level.trackInventory` column needs no data: its default, `INHERIT`, keeps the
 * variant setting in force.
 *
 * Table names honour the `entityPrefix` of the connection options and, on Postgres, the
 * `schema` option. The helper throws if the `global_settings` table cannot be found, rather than
 * treating that as "already migrated".
 *
 * Call it from your v4 migration, after the generated statements. Vendure v4 refuses to start
 * until it has run. It can be run again, e.g. from a later migration once the last v3 server of a
 * rolling deployment has stopped: the copy is skipped once done, and only stock movements whose
 * `tracked` state is still empty are filled.
 *
 * @docsCategory migration
 * @since 4.0.0
 */
export async function migrateTrackInventoryToChannels(
    queryRunner: QueryRunner,
): Promise<TrackInventoryMigrationResult> {
    const result = await copyGlobalTrackInventoryToChannels(queryRunner);
    // Uses the default Channel's value, which the copy has just set to the v3 global value.
    result.filledStockMovements = await backfillStockMovementTracking(queryRunner);
    return result;
}

async function copyGlobalTrackInventoryToChannels(
    queryRunner: QueryRunner,
): Promise<TrackInventoryMigrationResult> {
    const { globalValue, overwrittenChannels } = await copyGlobalSettingToChannels(
        queryRunner,
        globalStockSettings.trackInventory,
    );
    return { globalTrackInventory: globalValue, overwrittenChannels, filledStockMovements: 0 };
}

/**
 * Fills `stock_movement.tracked` for movements recorded before v4.0, with the rule that applied
 * when they were recorded: a movement changed the StockLevel figures if the ProductVariant's
 * `trackInventory` was `TRUE`, or `INHERIT` with the global setting on. Channels and StockLevels
 * played no part. Without this, those movements follow the *current* setting, so an Order still
 * open at the upgrade would be released or sold by a rule different from the one it was
 * allocated by. StockAdjustments always changed `stockOnHand`, so they are set to `TRUE`.
 *
 * The former global value is read from the default Channel, which the copy has set to it. Only
 * rows still `NULL` are touched. Part of {@link migrateTrackInventoryToChannels}; exported for
 * tests only.
 *
 * @internal
 */
export async function backfillStockMovementTracking(queryRunner: QueryRunner): Promise<number> {
    const esc = (name: string) => queryRunner.connection.driver.escape(name);
    const escTable = (qualified: string) => qualified.split('.').map(esc).join('.');
    const movementTable = qualifiedTableName(queryRunner, 'stock_movement');
    const variantTable = qualifiedTableName(queryRunner, 'product_variant');
    const channelTable = qualifiedTableName(queryRunner, 'channel');
    if (!(await queryRunner.hasColumn(movementTable, 'tracked'))) {
        throw new Error(
            `[v4 trackInventory] Column "tracked" not found on "${movementTable}". Call ` +
                'migrateTrackInventoryToChannels() after the generated statements of your v4 migration.',
        );
    }
    // The outer table is referenced by its name without the schema, which every supported
    // database accepts inside a correlated subquery of an UPDATE.
    const outer = esc(movementTable.split('.').pop() as string);
    const countNull = async () =>
        Number(
            (
                await queryRunner.query(
                    `SELECT COUNT(*) AS ${esc('c')} FROM ${escTable(movementTable)} WHERE ${esc('tracked')} IS NULL`,
                )
            )[0].c,
        );
    const before = await countNull();
    await queryRunner.query(
        `UPDATE ${escTable(movementTable)} SET ${esc('tracked')} = TRUE
         WHERE ${esc('tracked')} IS NULL AND ${esc('type')} = 'ADJUSTMENT'`,
    );
    await queryRunner.query(
        `UPDATE ${escTable(movementTable)} SET ${esc('tracked')} = (
            SELECT CASE
                WHEN pv.${esc('trackInventory')} = 'TRUE' THEN TRUE
                WHEN pv.${esc('trackInventory')} = 'FALSE' THEN FALSE
                ELSE (
                    SELECT ch.${esc('trackInventory')} FROM ${escTable(channelTable)} ch
                    WHERE ch.${esc('code')} = '${DEFAULT_CHANNEL_CODE}'
                )
            END
            FROM ${escTable(variantTable)} pv
            WHERE pv.${esc('id')} = ${outer}.${esc('productVariantId')}
        )
        WHERE ${esc('tracked')} IS NULL
          AND ${esc('type')} IN ('ALLOCATION', 'SALE', 'RELEASE', 'CANCELLATION')`,
    );
    const filled = before - (await countNull());
    console.log(`[v4 trackInventory] Set stock_movement.tracked on ${filled} pre-v4 row(s).`);
    return filled;
}
