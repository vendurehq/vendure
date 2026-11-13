import { DataSource } from 'typeorm';

import { Logger } from '../config/logger/vendure-logger';
import { VendureConfig } from '../config/vendure-config';

import { getDatabaseType } from './database-type';
import { isMysqlDatabase, isPostgresDatabase, isUtcTimezone } from './timezone-utils';

const loggerCtx = 'DatabaseTimezone';

/**
 * @description
 * Checks the timezone settings that make stored timestamps wrong, and logs a warning that
 * names the effect and the fix (see #1719, #3409 and #1375).
 *
 * - **Postgres with `timestampColumnType: 'timestamp'`.** node-postgres writes and reads
 *   `timestamp` columns in the process timezone. `createdAt`/`updatedAt` defaults use the session
 *   timezone. Both must be UTC.
 * - **MySQL / MariaDB.** `datetime` columns are written in the TypeORM `timezone` (Vendure
 *   default `'Z'`), but `createdAt`/`updatedAt` come from `CURRENT_TIMESTAMP` in the session
 *   `time_zone`. They must match.
 *
 * Returns the warnings so that it can be tested.
 */
export async function checkDatabaseTimezone(
    dataSource: DataSource,
    config: VendureConfig,
    processZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
    processOffsetSeconds: number = -new Date().getTimezoneOffset() * 60,
): Promise<string[]> {
    const warnings: string[] = [];
    const processIsUtc = isUtcTimezone(processZone);
    const dbType = getDatabaseType(dataSource);
    try {
        if (isPostgresDatabase(dbType)) {
            warnings.push(...(await checkPostgres(dataSource, config, processZone, processIsUtc)));
        } else if (isMysqlDatabase(dbType)) {
            warnings.push(...(await checkMysql(dataSource, processZone, processIsUtc, processOffsetSeconds)));
        }
    } catch (e: any) {
        Logger.debug(`Could not check the database timezone: ${String(e?.message)}`, loggerCtx);
    }
    for (const warning of warnings) {
        Logger.warn(warning, loggerCtx);
    }
    return warnings;
}

async function checkPostgres(
    dataSource: DataSource,
    config: VendureConfig,
    processZone: string,
    processIsUtc: boolean,
): Promise<string[]> {
    if ((config.entityOptions?.timestampColumnType ?? 'timestamptz') !== 'timestamp') {
        return [];
    }
    const warnings: string[] = [];
    const [{ tz, offset }] = await dataSource.query(
        `SELECT current_setting('TimeZone') AS tz, EXTRACT(TIMEZONE FROM now())::int AS offset`,
    );
    if (!processIsUtc) {
        warnings.push(
            `The Node.js process timezone is "${processZone}", and timestampColumnType is "timestamp". ` +
                `Date values are stored in local wall-clock time: they shift when the process timezone ` +
                `changes, and the repeated hour when daylight saving time ends is stored ambiguously. ` +
                `Run the process with TZ=UTC, or migrate to "timestamptz".`,
        );
    }
    if (Number(offset) !== 0) {
        warnings.push(
            `The Postgres session timezone is "${String(tz)}", and timestampColumnType is "timestamp". ` +
                `createdAt and updatedAt are filled by the database in this timezone and will be ` +
                `${Number(offset) / 3600}h off. Set the server or role timezone to UTC, or migrate to "timestamptz".`,
        );
    }
    return warnings;
}

async function checkMysql(
    dataSource: DataSource,
    processZone: string,
    processIsUtc: boolean,
    processOffsetSeconds: number,
): Promise<string[]> {
    const warnings: string[] = [];
    const [{ tz, offset }] = await dataSource.query(
        `SELECT @@session.time_zone AS tz, TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) AS offset`,
    );
    const driverZone = (dataSource.options as { timezone?: string }).timezone ?? 'local';
    const driverOffsetSeconds =
        driverZone === 'local' ? processOffsetSeconds : isUtcTimezone(driverZone) ? 0 : parseOffset(driverZone);
    if (driverOffsetSeconds !== undefined && Math.abs(Number(offset) - driverOffsetSeconds) >= 60) {
        warnings.push(
            `The MySQL session time_zone is "${String(tz)}", but dates are written in "${driverZone}". ` +
                `createdAt and updatedAt are filled by the database (CURRENT_TIMESTAMP) and will be ` +
                `${(Number(offset) - driverOffsetSeconds) / 3600}h off. Set the server time_zone to '+00:00' ` +
                `(e.g. --default-time-zone=+00:00).`,
        );
    }
    if (driverZone === 'local' && !processIsUtc) {
        warnings.push(
            `dbConnectionOptions.timezone is "local" and the process timezone is "${processZone}". ` +
                `Dates are stored in local wall-clock time. Use the default timezone: 'Z'.`,
        );
    }
    return warnings;
}

function parseOffset(zone: string): number | undefined {
    const match = zone.match(/^([+-])(\d{2}):?(\d{2})$/);
    if (!match) {
        return undefined;
    }
    const seconds = Number(match[2]) * 3600 + Number(match[3]) * 60;
    return match[1] === '-' ? -seconds : seconds;
}
