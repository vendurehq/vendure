/* eslint-disable no-console */
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
 * The new `stock_level.trackInventory` column (default `INHERIT`) and the nullable
 * `stock_movement.tracked` column need no data: `INHERIT` keeps the variant setting in force,
 * and movements with `tracked = NULL` fall back to the current setting, as before v4.
 *
 * Table names honour the `entityPrefix` of the connection options and, on Postgres, the
 * `schema` option. The helper throws if the `global_settings` table cannot be found, rather than
 * treating that as "already migrated".
 *
 * **Call this at the start of your migration's `up()`, before the generated statement that drops
 * `global_settings.trackInventory`.** It is a no-op once that column has gone.
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
