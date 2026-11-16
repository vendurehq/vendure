/* eslint-disable no-console */
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { QueryRunner } from 'typeorm';

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
 * The column itself is kept (see `GlobalSettings.legacyTrackInventory`), so neither
 * `synchronize` nor a generated migration drops the value before it is copied.
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
 * Call it from your v4 migration, after the generated statements, and then call
 * {@link backfillStockMovementTracking}. It is a no-op once the value has been copied. Vendure v4
 * refuses to start until it has run (see {@link assertTrackInventoryMigrated}).
 *
 * @docsCategory migration
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
        return result;
    }
    // The value is cleared once copied, which needs the v4 schema, where the column is nullable.
    const column = (await queryRunner.getTable(globalSettingsTable))?.findColumnByName('trackInventory');
    if (column && !column.isNullable) {
        throw new Error(
            '[v4 trackInventory] global_settings.trackInventory is still NOT NULL. Call ' +
                'migrateTrackInventoryToChannels() after the generated statements of your v4 migration.',
        );
    }
    const settings: Array<{ value: unknown }> = await queryRunner.query(
        `SELECT ${esc('trackInventory')} AS ${esc('value')} FROM ${escTable(globalSettingsTable)}
         WHERE ${esc('trackInventory')} IS NOT NULL`,
    );
    if (!settings.length) {
        // Already copied, or a database created by v4.
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
    // Clearing the value records that the copy has been done.
    await queryRunner.query(`UPDATE ${escTable(globalSettingsTable)} SET ${esc('trackInventory')} = NULL`);

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
 * @docsCategory migration
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

/**
 * @description
 * Throws if the v4.0 inventory tracking data migration has not run yet, i.e. if
 * `global_settings.trackInventory` still holds the pre-v4 value.
 *
 * Vendure calls it on startup. Without it, a v3 database upgraded without the migration helpers,
 * for example with `synchronize` left on, would start with every Channel's stored
 * `trackInventory` (usually `true`) in force instead of the v3 global setting: a shop which did not
 * track inventory would start allocating, and limiting sales by, stock it never maintained. It
 * only reads, and finds nothing on databases created by v4 or already migrated.
 *
 * @docsCategory migration
 * @since 4.0.0
 */
export async function assertTrackInventoryMigrated(queryRunner: QueryRunner): Promise<void> {
    const esc = (name: string) => queryRunner.connection.driver.escape(name);
    const escTable = (qualified: string) => qualified.split('.').map(esc).join('.');
    const globalSettingsTable = qualifiedTableName(queryRunner, 'global_settings');
    if (
        !(await queryRunner.hasTable(globalSettingsTable)) ||
        !(await queryRunner.hasColumn(globalSettingsTable, 'trackInventory'))
    ) {
        return;
    }
    const pending: unknown[] = await queryRunner.query(
        `SELECT 1 FROM ${escTable(globalSettingsTable)} WHERE ${esc('trackInventory')} IS NOT NULL`,
    );
    if (pending.length) {
        throw new Error(
            'The v4 inventory tracking data migration has not run: GlobalSettings.trackInventory still ' +
                'holds its v3 value. Call migrateTrackInventoryToChannels() and ' +
                'backfillStockMovementTracking() from your v4 migration. See ' +
                'https://docs.vendure.io/current/framework/developer-guide/migrating-from-v3/inventory-tracking',
        );
    }
}
