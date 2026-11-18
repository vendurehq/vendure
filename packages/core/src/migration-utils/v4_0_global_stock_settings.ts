/* eslint-disable no-console */
import { QueryRunner } from 'typeorm';

import { qualifiedTableName } from './v4_0_role_assignments';

/**
 * A GlobalSettings column whose v3 value moves to every Channel in v4.0. The column keeps its
 * name on both tables.
 */
interface GlobalStockSetting<T> {
    /** The column on `global_settings` and on `channel`. */
    column: string;
    /** The exported helper which copies it, named in errors. */
    helper: string;
    /** Converts the value as returned by the driver. */
    parse: (value: unknown) => T;
    /** The value as an SQL literal. Only called with values read from the database. */
    toSql: (value: T) => string;
}

const trackInventorySetting: GlobalStockSetting<boolean> = {
    column: 'trackInventory',
    helper: 'migrateTrackInventoryToChannels',
    // sqlite and mysql return 0/1, postgres returns a boolean.
    parse: value => value === true || value === 1 || value === '1' || value === 't' || value === 'true',
    toSql: value => (value ? 'TRUE' : 'FALSE'),
};

const outOfStockThresholdSetting: GlobalStockSetting<number> = {
    column: 'outOfStockThreshold',
    helper: 'migrateOutOfStockThresholdToChannels',
    parse: value => {
        // Some drivers return integers as strings.
        const n = Number(value);
        if (!Number.isInteger(n)) {
            throw new Error(`[v4 outOfStockThreshold] Expected an integer, got ${String(value)}`);
        }
        return n;
    },
    toSql: value => String(value),
};

/** @internal */
export const globalStockSettings = {
    trackInventory: trackInventorySetting,
    outOfStockThreshold: outOfStockThresholdSetting,
};

/** @internal */
export interface GlobalSettingCopyResult<T> {
    /** The pre-v4 value, or undefined if already copied. */
    globalValue: T | undefined;
    /** Channels whose stored value differed from the global value and was overwritten. */
    overwrittenChannels: Array<{ code: string; previous: T }>;
}

/**
 * Copies the v3 value of a GlobalSettings column to every Channel, then sets the
 * `global_settings` column to `NULL` to record that the copy has been done. Skipped once done.
 * Throws if the `global_settings` table cannot be found, or if the column is still `NOT NULL`
 * (i.e. the generated statements of the v4 migration have not run yet).
 *
 * @internal
 */
export async function copyGlobalSettingToChannels<T>(
    queryRunner: QueryRunner,
    setting: GlobalStockSetting<T>,
): Promise<GlobalSettingCopyResult<T>> {
    const { column, helper } = setting;
    const label = `[v4 ${column}]`;
    const esc = (name: string) => queryRunner.connection.driver.escape(name);
    const escTable = (qualified: string) => qualified.split('.').map(esc).join('.');
    const globalSettingsTable = qualifiedTableName(queryRunner, 'global_settings');
    const channelTable = qualifiedTableName(queryRunner, 'channel');
    if (!(await queryRunner.hasTable(globalSettingsTable))) {
        throw new Error(
            `${label} Table "${globalSettingsTable}" not found. Check the entityPrefix and ` +
                'schema of your dbConnectionOptions.',
        );
    }
    const result: GlobalSettingCopyResult<T> = { globalValue: undefined, overwrittenChannels: [] };
    if (!(await queryRunner.hasColumn(globalSettingsTable, column))) {
        return result;
    }
    // The value is cleared once copied, which needs the v4 schema, where the column is nullable.
    const tableColumn = (await queryRunner.getTable(globalSettingsTable))?.findColumnByName(column);
    if (tableColumn && !tableColumn.isNullable) {
        throw new Error(
            `${label} global_settings.${column} is still NOT NULL. Call ${helper}() after the ` +
                'generated statements of your v4 migration.',
        );
    }
    const settings: Array<{ value: unknown }> = await queryRunner.query(
        `SELECT ${esc(column)} AS ${esc('value')} FROM ${escTable(globalSettingsTable)}
         WHERE ${esc(column)} IS NOT NULL`,
    );
    if (!settings.length) {
        // Already copied, or a database created by v4.
        return result;
    }
    const globalValue = setting.parse(settings[0].value);
    result.globalValue = globalValue;

    const channels: Array<{ code: string; value: unknown }> = await queryRunner.query(
        `SELECT ${esc('code')} AS ${esc('code')}, ${esc(column)} AS ${esc('value')} FROM ${escTable(channelTable)}`,
    );
    result.overwrittenChannels = channels
        .map(c => ({ code: c.code, previous: setting.parse(c.value) }))
        .filter(c => c.previous !== globalValue);

    await queryRunner.query(
        `UPDATE ${escTable(channelTable)} SET ${esc(column)} = ${setting.toSql(globalValue)}`,
    );
    // Clearing the value records that the copy has been done.
    await queryRunner.query(`UPDATE ${escTable(globalSettingsTable)} SET ${esc(column)} = NULL`);

    console.log(
        `${label} Copied GlobalSettings.${column} (${String(globalValue)}) to ${channels.length} Channel(s).`,
    );
    for (const { code, previous } of result.overwrittenChannels) {
        console.log(
            `${label} Channel "${code}" had ${column} = ${String(previous)}, which had no effect ` +
                `before v4. It is now ${String(globalValue)}. Set it again after the upgrade if you ` +
                'want the Channel to differ.',
        );
    }
    return result;
}

/**
 * @description
 * Throws if a v4.0 data migration which moves a GlobalSettings value to the Channels has not run
 * yet, i.e. if `global_settings.trackInventory` or `global_settings.outOfStockThreshold` still
 * holds its v3 value. The error names every helper still to be called.
 *
 * Vendure calls it on startup. Without it, a v3 database upgraded without the migration helpers,
 * for example with `synchronize` left on, would start with every Channel's stored value in force
 * instead of the v3 global one, values which v3 never read:
 *
 * - `trackInventory` (usually `true`): a shop which did not track inventory would start
 *   allocating, and limiting sales by, stock it never maintained.
 * - `outOfStockThreshold` (usually `0`): a shop which kept a reserve of each variant would start
 *   selling it, and one which allowed backorders with a negative threshold would stop.
 *
 * It only reads, and finds nothing on databases created by v4 or already migrated.
 *
 * @internal
 */
export async function assertGlobalStockSettingsMigrated(queryRunner: QueryRunner): Promise<void> {
    const esc = (name: string) => queryRunner.connection.driver.escape(name);
    const escTable = (qualified: string) => qualified.split('.').map(esc).join('.');
    const globalSettingsTable = qualifiedTableName(queryRunner, 'global_settings');
    if (!(await queryRunner.hasTable(globalSettingsTable))) {
        return;
    }
    const pending: Array<GlobalStockSetting<unknown>> = [];
    for (const setting of Object.values(globalStockSettings) as Array<GlobalStockSetting<unknown>>) {
        if (!(await queryRunner.hasColumn(globalSettingsTable, setting.column))) {
            continue;
        }
        const rows: unknown[] = await queryRunner.query(
            `SELECT 1 FROM ${escTable(globalSettingsTable)} WHERE ${esc(setting.column)} IS NOT NULL`,
        );
        if (rows.length) {
            pending.push(setting);
        }
    }
    if (pending.length) {
        throw new Error(
            'The v4 data migration of the stock settings has not run: GlobalSettings still holds the v3 ' +
                `value of ${pending.map(s => s.column).join(' and ')}. Call ` +
                `${pending.map(s => `${s.helper}()`).join(' and ')} from your v4 migration, after the ` +
                'generated statements. See ' +
                'https://docs.vendure.io/current/framework/developer-guide/migrating-from-v3/inventory-tracking',
        );
    }
}
