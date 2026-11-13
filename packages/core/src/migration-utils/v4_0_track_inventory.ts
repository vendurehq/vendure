/* eslint-disable no-console */
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { QueryRunner } from 'typeorm';

import { qualifiedTableName } from './v4_0_role_assignments';

export interface TrackInventoryMigrationResult {
    /** The value read from `global_settings.trackInventory`, or undefined if already migrated. */
    globalTrackInventory: boolean | undefined;
    /** Channels whose stored `trackInventory` differed from the global value and was overwritten. */
    overwrittenChannels: Array<{ code: string; previous: boolean }>;
}

/**
 * @description
 * v4.0 data migration for granular inventory tracking (#2908).
 *
 * Before v4, `GlobalSettings.trackInventory` was the default for every ProductVariant set to
 * `INHERIT`, and `Channel.trackInventory` existed but was never read. From v4 the Channel value
 * is the default, and `GlobalSettings.trackInventory` is removed. This helper copies the global
 * value to every Channel, so that every variant keeps its current behaviour.
 *
 * Channels whose stored value differed are overwritten (it had no effect before) and are
 * returned and logged, so you can set them again on purpose after the upgrade.
 *
 * The new `stock_level.trackInventory` column needs no data: its default, `INHERIT`, keeps the
 * variant setting in force. The new `stock_movement.tracked` column is filled by
 * {@link backfillStockMovementTracking}.
 *
 * Table names honour the `entityPrefix` of the connection options and, on Postgres, the
 * `schema` option. The helper throws if the `global_settings` table cannot be found, rather than
 * treating that as "already migrated".
 *
 * **Call this at the start of your migration's `up()`, before the generated statement that drops
 * `global_settings.trackInventory`.** It is a no-op once that column has gone. Then call
 * {@link backfillStockMovementTracking} at the end of `up()`.
 *
 * @since 4.0.0
 */
export async function migrateTrackInventoryToChannels(
    queryRunner: QueryRunner,
): Promise<TrackInventoryMigrationResult> {
    const esc = (name: string) => queryRunner.connection.driver.escape(name);
    const escTable = (qualified: string) => qualified.split('.').map(esc).join('.');
    const globalSettingsTable = qualifiedTableName(queryRunner, 'global_settings');
    const channelTable = qualifiedTableName(queryRunner, 'channel');
    if (!(await queryRunner.hasTable(globalSettingsTable))) {
        throw new Error(
            `[v4 trackInventory] Table "${globalSettingsTable}" not found. Check the entityPrefix and ` +
                'schema of your dbConnectionOptions.',
        );
    }
    const result: TrackInventoryMigrationResult = {
        globalTrackInventory: undefined,
        overwrittenChannels: [],
    };
    if (!(await queryRunner.hasColumn(globalSettingsTable, 'trackInventory'))) {
        console.log('[v4 trackInventory] global_settings.trackInventory not found; nothing to migrate.');
        return result;
    }
    const settings: Array<{ value: unknown }> = await queryRunner.query(
        `SELECT ${esc('trackInventory')} AS ${esc('value')} FROM ${escTable(globalSettingsTable)}`,
    );
    if (!settings.length) {
        return result;
    }
    const globalValue = toBoolean(settings[0].value);
    result.globalTrackInventory = globalValue;
    const literal = globalValue ? 'TRUE' : 'FALSE';

    const channels: Array<{ code: string; value: unknown }> = await queryRunner.query(
        `SELECT ${esc('code')} AS ${esc('code')}, ${esc('trackInventory')} AS ${esc('value')} FROM ${escTable(channelTable)}`,
    );
    result.overwrittenChannels = channels
        .filter(c => toBoolean(c.value) !== globalValue)
        .map(c => ({ code: c.code, previous: toBoolean(c.value) }));

    await queryRunner.query(`UPDATE ${escTable(channelTable)} SET ${esc('trackInventory')} = ${literal}`);

    console.log(
        `[v4 trackInventory] Copied GlobalSettings.trackInventory (${String(globalValue)}) to ` +
            `${channels.length} Channel(s).`,
    );
    for (const { code, previous } of result.overwrittenChannels) {
        console.log(
            `[v4 trackInventory] Channel "${code}" had trackInventory = ${String(previous)}, which had ` +
                'no effect before v4. It is now ' +
                `${String(globalValue)}. Set it again after the upgrade if you want the Channel to differ.`,
        );
    }
    return result;
}

function toBoolean(value: unknown): boolean {
    // sqlite and mysql return 0/1, postgres returns a boolean.
    return value === true || value === 1 || value === '1' || value === 't' || value === 'true';
}

/**
 * @description
 * Second step of the v4.0 granular inventory tracking migration (#2908): fills
 * `stock_movement.tracked` for movements recorded before v4.0, with the rule that applied when
 * they were recorded. Before v4.0 a movement changed the StockLevel figures if the
 * ProductVariant's `trackInventory` was `TRUE`, or `INHERIT` with the global setting on. Channels
 * and StockLevels played no part.
 *
 * Without this, those movements have `tracked = NULL` and follow the *current* setting, so an
 * Order still open at the upgrade would be released or sold by a rule different from the one it
 * was allocated by, the very leak v4.0 fixes. StockAdjustments always changed `stockOnHand`, so
 * they are set to `TRUE`.
 *
 * The former global value is read from the default Channel, which
 * {@link migrateTrackInventoryToChannels} has set to it. **Call this at the end of your
 * migration's `up()`**, after the generated statement that adds `stock_movement.tracked` and
 * after `migrateTrackInventoryToChannels()`. Only rows still `NULL` are touched, so it is safe to
 * run more than once.
 *
 * @returns the number of rows it set
 * @since 4.0.0
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
                'backfillStockMovementTracking() after the statement which adds it.',
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
