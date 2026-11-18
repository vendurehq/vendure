/* eslint-disable no-console */
import { QueryRunner } from 'typeorm';

import { qualifiedTableName } from './v4_0_role_assignments';

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
    const esc = (name: string) => queryRunner.connection.driver.escape(name);
    const escTable = (qualified: string) => qualified.split('.').map(esc).join('.');
    const globalSettingsTable = qualifiedTableName(queryRunner, 'global_settings');
    const channelTable = qualifiedTableName(queryRunner, 'channel');
    if (!(await queryRunner.hasTable(globalSettingsTable))) {
        throw new Error(
            `[v4 outOfStockThreshold] Table "${globalSettingsTable}" not found. Check the entityPrefix ` +
                'and schema of your dbConnectionOptions.',
        );
    }
    const result: OutOfStockThresholdMigrationResult = {
        globalOutOfStockThreshold: undefined,
        overwrittenChannels: [],
    };
    if (!(await queryRunner.hasColumn(globalSettingsTable, 'outOfStockThreshold'))) {
        return result;
    }
    // The value is cleared once copied, which needs the v4 schema, where the column is nullable.
    const column = (await queryRunner.getTable(globalSettingsTable))?.findColumnByName('outOfStockThreshold');
    if (column && !column.isNullable) {
        throw new Error(
            '[v4 outOfStockThreshold] global_settings.outOfStockThreshold is still NOT NULL. Call ' +
                'migrateOutOfStockThresholdToChannels() after the generated statements of your v4 migration.',
        );
    }
    const settings: Array<{ value: unknown }> = await queryRunner.query(
        `SELECT ${esc('outOfStockThreshold')} AS ${esc('value')} FROM ${escTable(globalSettingsTable)}
         WHERE ${esc('outOfStockThreshold')} IS NOT NULL`,
    );
    if (!settings.length) {
        // Already copied, or a database created by v4.
        return result;
    }
    const globalValue = toInteger(settings[0].value);
    result.globalOutOfStockThreshold = globalValue;

    const channels: Array<{ code: string; value: unknown }> = await queryRunner.query(
        `SELECT ${esc('code')} AS ${esc('code')}, ${esc('outOfStockThreshold')} AS ${esc('value')} FROM ${escTable(channelTable)}`,
    );
    result.overwrittenChannels = channels
        .filter(c => toInteger(c.value) !== globalValue)
        .map(c => ({ code: c.code, previous: toInteger(c.value) }));

    // An integer read from the database, so it is safe to inline.
    await queryRunner.query(
        `UPDATE ${escTable(channelTable)} SET ${esc('outOfStockThreshold')} = ${globalValue}`,
    );
    // Clearing the value records that the copy has been done.
    await queryRunner.query(
        `UPDATE ${escTable(globalSettingsTable)} SET ${esc('outOfStockThreshold')} = NULL`,
    );

    console.log(
        `[v4 outOfStockThreshold] Copied GlobalSettings.outOfStockThreshold (${globalValue}) to ` +
            `${channels.length} Channel(s).`,
    );
    for (const { code, previous } of result.overwrittenChannels) {
        console.log(
            `[v4 outOfStockThreshold] Channel "${code}" had outOfStockThreshold = ${previous}, which had ` +
                `no effect before v4. It is now ${globalValue}. Set it again after the upgrade if you ` +
                'want the Channel to differ.',
        );
    }
    return result;
}

function toInteger(value: unknown): number {
    // Some drivers return integers as strings (e.g. postgres bigint, mysql with bigNumberStrings).
    const n = Number(value);
    if (!Number.isInteger(n)) {
        throw new Error(`[v4 outOfStockThreshold] Expected an integer, got ${String(value)}`);
    }
    return n;
}

/**
 * @description
 * Throws if the v4.0 out-of-stock threshold data migration has not run yet, i.e. if
 * `global_settings.outOfStockThreshold` still holds the pre-v4 value.
 *
 * Vendure calls it on startup. Without it, a v3 database upgraded without the migration helper,
 * for example with `synchronize` left on, would start with every Channel's stored
 * `outOfStockThreshold` (usually 0) in force instead of the v3 global setting: a shop which kept
 * a reserve of each variant would start selling it, and one which allowed backorders with a
 * negative threshold would stop. It only reads, and finds nothing on databases created by v4 or
 * already migrated.
 *
 * @internal
 */
export async function assertOutOfStockThresholdMigrated(queryRunner: QueryRunner): Promise<void> {
    const esc = (name: string) => queryRunner.connection.driver.escape(name);
    const escTable = (qualified: string) => qualified.split('.').map(esc).join('.');
    const globalSettingsTable = qualifiedTableName(queryRunner, 'global_settings');
    if (
        !(await queryRunner.hasTable(globalSettingsTable)) ||
        !(await queryRunner.hasColumn(globalSettingsTable, 'outOfStockThreshold'))
    ) {
        return;
    }
    const pending: unknown[] = await queryRunner.query(
        `SELECT 1 FROM ${escTable(globalSettingsTable)} WHERE ${esc('outOfStockThreshold')} IS NOT NULL`,
    );
    if (pending.length) {
        throw new Error(
            'The v4 out-of-stock threshold data migration has not run: GlobalSettings.outOfStockThreshold ' +
                'still holds its v3 value. Call migrateOutOfStockThresholdToChannels() from your v4 migration. ' +
                'See https://docs.vendure.io/current/framework/developer-guide/migrating-from-v3/inventory-tracking',
        );
    }
}
