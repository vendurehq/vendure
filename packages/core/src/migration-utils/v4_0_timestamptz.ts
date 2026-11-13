/* eslint-disable no-console */
// One-time v4.0 migration helper: converts Postgres `timestamp` columns to `timestamptz`.
// It must stay exported: user migrations import it directly. Every function is a no-op on a
// database that has already been migrated, and on databases other than Postgres.
import { QueryRunner } from 'typeorm';
import { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata';

/**
 * @description
 * One column that {@link migrateTimestampColumnsToTimestamptz} converts.
 *
 * @docsCategory migration
 */
export interface TimestampColumnToMigrate {
    table: string;
    column: string;
    /**
     * `true` for `createdAt`, `updatedAt` and other columns that the database fills with `now()` /
     * `CURRENT_TIMESTAMP`. Pre-v4 these hold wall-clock time in the **Postgres session** timezone.
     * All other columns hold wall-clock time in the **Node.js process** timezone.
     */
    filledByDatabase: boolean;
    precision?: number;
}

/**
 * @description
 * Options for {@link migrateTimestampColumnsToTimestamptz}.
 *
 * @docsCategory migration
 */
export interface TimestamptzMigrationOptions {
    /**
     * The IANA timezone that the Vendure server and worker processes ran in (their `TZ`
     * environment variable) while they wrote the existing data, e.g. `'UTC'` or `'Europe/Vienna'`.
     * The values of `Date` columns such as `Order.orderPlacedAt` are wall-clock times in this zone.
     */
    processTimezone: string;
    /**
     * The Postgres session timezone (`SHOW timezone`, usually the server's `timezone` setting) while
     * the existing data was written. The values of `createdAt` and `updatedAt` are wall-clock times
     * in this zone, because Postgres fills them with `now()`.
     *
     * @default the current session timezone of the migration connection
     */
    databaseTimezone?: string;
    /**
     * Sets `lock_timeout` for the migration. Each table is locked (`ACCESS EXCLUSIVE`) while it is
     * converted. A timeout makes the migration fail rather than queue behind long-running queries.
     *
     * @default undefined (no timeout)
     */
    lockTimeout?: string;
    /**
     * Logs each statement and its duration.
     *
     * @default true
     */
    log?: boolean;
}

const UTC_ZONES = new Set(['UTC', 'Etc/UTC', 'Etc/UCT', 'UCT', 'GMT', 'Etc/GMT', 'Etc/Universal', 'Universal', 'Zulu', 'Etc/Zulu']);

function isUtc(zone: string) {
    return UTC_ZONES.has(zone) || /^[+-]?0{1,2}(:?00)?$/.test(zone);
}

/**
 * @description
 * Lists the columns which are `timestamptz` in the current entity metadata but still
 * `timestamp without time zone` in the database. These are the columns which
 * {@link migrateTimestampColumnsToTimestamptz} converts.
 *
 * @docsCategory migration
 */
export async function findTimestampColumnsToMigrate(queryRunner: QueryRunner): Promise<TimestampColumnToMigrate[]> {
    if (queryRunner.connection.options.type !== 'postgres') {
        return [];
    }
    const actual: Array<{ table_name: string; column_name: string }> = await queryRunner.query(
        `SELECT table_name, column_name FROM information_schema.columns
         WHERE table_schema = current_schema() AND data_type = 'timestamp without time zone'`,
    );
    const legacy = new Set(actual.map(r => `${r.table_name}.${r.column_name}`));
    const result: TimestampColumnToMigrate[] = [];
    const seen = new Set<string>();
    for (const metadata of queryRunner.connection.entityMetadatas) {
        for (const column of metadata.columns) {
            if (!isTimestamptz(column)) {
                continue;
            }
            const key = `${metadata.tableName}.${column.databaseName}`;
            if (!legacy.has(key) || seen.has(key)) {
                continue;
            }
            seen.add(key);
            result.push({
                table: metadata.tableName,
                column: column.databaseName,
                filledByDatabase: column.isCreateDate || column.isUpdateDate || column.isDeleteDate,
                precision: column.precision ?? undefined,
            });
        }
    }
    return result.sort((a, b) => (a.table + a.column).localeCompare(b.table + b.column));
}

function isTimestamptz(column: ColumnMetadata) {
    return column.type === 'timestamptz' || column.type === 'timestamp with time zone';
}

/**
 * @description
 * Converts the Postgres `timestamp` columns of all entities to `timestamptz`. Needed when upgrading
 * an existing Postgres database to Vendure v4, which uses `timestamptz` by default (see
 * `EntityOptions.timestampColumnType`).
 *
 * :::danger
 * Call this helper **instead of** the `ALTER TABLE ... DROP COLUMN` / `ADD COLUMN` statements that
 * TypeORM generates for this change. Those statements delete every stored date.
 * :::
 *
 * A `timestamp` value has no timezone. Pre-v4 Vendure wrote two kinds of value into these columns:
 *
 * - `createdAt`, `updatedAt` and other database-filled columns hold wall-clock time in the Postgres
 *   **session** timezone (`databaseTimezone`).
 * - All other dates (e.g. `orderPlacedAt`, `deletedAt`, custom fields) hold wall-clock time in the
 *   timezone of the **Node.js process** (`processTimezone`).
 *
 * If both were UTC (the recommended setup, and the default of most containers and managed
 * databases), pass `'UTC'`. Then Postgres (12+) changes the type without rewriting the tables.
 * Otherwise every table with such a column is rewritten once, under an `ACCESS EXCLUSIVE` lock.
 *
 * Use {@link previewTimestamptzMigration} first to see which columns change and to check the
 * timezones against your data.
 *
 * @example
 * ```ts
 * import { migrateTimestampColumnsToTimestamptz } from '\@vendure/core';
 *
 * export class Timestamptz1700000000000 implements MigrationInterface {
 *     public async up(queryRunner: QueryRunner) {
 *         await migrateTimestampColumnsToTimestamptz(queryRunner, { processTimezone: 'UTC' });
 *     }
 *     public async down(queryRunner: QueryRunner) {
 *         await revertTimestamptzMigration(queryRunner, { processTimezone: 'UTC' });
 *     }
 * }
 * ```
 *
 * @docsCategory migration
 * @since 4.0.0
 */
export async function migrateTimestampColumnsToTimestamptz(
    queryRunner: QueryRunner,
    options: TimestamptzMigrationOptions,
): Promise<TimestampColumnToMigrate[]> {
    const columns = await findTimestampColumnsToMigrate(queryRunner);
    if (!columns.length) {
        return [];
    }
    const databaseTimezone = await resolveZone(
        queryRunner,
        options.databaseTimezone ?? (await currentTimezone(queryRunner)),
    );
    const processTimezone = await resolveZone(queryRunner, options.processTimezone);
    if (options.lockTimeout) {
        await queryRunner.query(`SET LOCAL lock_timeout = '${options.lockTimeout.replace(/'/g, '')}'`);
    }
    // With the session in UTC, Postgres 12+ converts timestamp -> timestamptz without a rewrite
    // when no USING clause is given.
    await queryRunner.query(`SET LOCAL timezone = 'UTC'`);
    for (const [table, tableColumns] of groupByTable(columns)) {
        const clauses = tableColumns.map(c => {
            const zone = c.filledByDatabase ? databaseTimezone : processTimezone;
            const type = `timestamp${c.precision != null ? `(${c.precision})` : ''} with time zone`;
            const using = isUtc(zone) ? '' : ` USING ${wallTimeToInstant(`"${c.column}"`, zone)}`;
            return `ALTER COLUMN "${c.column}" TYPE ${type}${using}`;
        });
        await run(queryRunner, `ALTER TABLE "${table}" ${clauses.join(', ')}`, options.log);
    }
    return columns;
}

/**
 * @description
 * The reverse of {@link migrateTimestampColumnsToTimestamptz}, for the `down()` method of the
 * migration. Converts the `timestamptz` columns back to `timestamp`, as wall-clock time in the
 * same zones.
 *
 * @docsCategory migration
 * @since 4.0.0
 */
export async function revertTimestamptzMigration(
    queryRunner: QueryRunner,
    options: TimestamptzMigrationOptions,
): Promise<void> {
    if (queryRunner.connection.options.type !== 'postgres') {
        return;
    }
    const databaseTimezone = await resolveZone(
        queryRunner,
        options.databaseTimezone ?? (await currentTimezone(queryRunner)),
    );
    const processTimezone = await resolveZone(queryRunner, options.processTimezone);
    const actual: Array<{ table_name: string; column_name: string }> = await queryRunner.query(
        `SELECT table_name, column_name FROM information_schema.columns
         WHERE table_schema = current_schema() AND data_type = 'timestamp with time zone'`,
    );
    const current = new Set(actual.map(r => `${r.table_name}.${r.column_name}`));
    const columns: TimestampColumnToMigrate[] = [];
    for (const metadata of queryRunner.connection.entityMetadatas) {
        for (const column of metadata.columns) {
            const key = `${metadata.tableName}.${column.databaseName}`;
            if (isTimestamptz(column) && current.has(key) && !columns.some(c => `${c.table}.${c.column}` === key)) {
                columns.push({
                    table: metadata.tableName,
                    column: column.databaseName,
                    filledByDatabase: column.isCreateDate || column.isUpdateDate || column.isDeleteDate,
                    precision: column.precision ?? undefined,
                });
            }
        }
    }
    await queryRunner.query(`SET LOCAL timezone = 'UTC'`);
    for (const [table, tableColumns] of groupByTable(columns)) {
        const clauses = tableColumns.map(c => {
            const zone = c.filledByDatabase ? databaseTimezone : processTimezone;
            const type = `timestamp${c.precision != null ? `(${c.precision})` : ''} without time zone`;
            const using = isUtc(zone) ? '' : ` USING "${c.column}" AT TIME ZONE ${quote(zone)}`;
            return `ALTER COLUMN "${c.column}" TYPE ${type}${using}`;
        });
        await run(queryRunner, `ALTER TABLE "${table}" ${clauses.join(', ')}`, options.log);
    }
}

/**
 * @description
 * The result of {@link previewTimestamptzMigration}.
 *
 * @docsCategory migration
 */
export interface TimestamptzMigrationPreview {
    /** The current session timezone of the migration connection. */
    sessionTimezone: string;
    columns: TimestampColumnToMigrate[];
    /**
     * For each month, the median difference between `order.orderPlacedAt` (written in the process
     * timezone) and the `createdAt` of the order's first payment (written by the database in the
     * session timezone, a few milliseconds earlier). The difference is the offset of the process
     * timezone minus the offset of the session timezone, in hours. `0` everywhere means both were
     * the same. A value that changes with daylight saving time (e.g. `1` in winter and `2` in
     * summer) identifies a zone such as Europe/Vienna.
     */
    offsetByMonth: Array<{ month: string; hours: number; orders: number }>;
}

/**
 * @description
 * Lists the columns which {@link migrateTimestampColumnsToTimestamptz} would convert, and estimates
 * the difference between the timezone of the Node.js process and the timezone of Postgres from your
 * orders. Changes nothing.
 *
 * @docsCategory migration
 * @since 4.0.0
 */
export async function previewTimestamptzMigration(queryRunner: QueryRunner): Promise<TimestamptzMigrationPreview> {
    const columns = await findTimestampColumnsToMigrate(queryRunner);
    const sessionTimezone = await currentTimezone(queryRunner);
    let offsetByMonth: TimestamptzMigrationPreview['offsetByMonth'] = [];
    try {
        const rows: Array<{ month: string; seconds: string; orders: string }> = await queryRunner.query(
            `SELECT to_char(date_trunc('month', o."orderPlacedAt"), 'YYYY-MM') AS month,
                    percentile_cont(0.5) WITHIN GROUP (
                        ORDER BY extract(epoch FROM (o."orderPlacedAt"::timestamp - p."createdAt"::timestamp))
                    ) AS seconds,
                    count(*) AS orders
             FROM "order" o
             JOIN (SELECT "orderId", min("createdAt") AS "createdAt" FROM "payment" GROUP BY "orderId") p
               ON p."orderId" = o.id
             WHERE o."orderPlacedAt" IS NOT NULL
             GROUP BY 1 ORDER BY 1`,
        );
        offsetByMonth = rows.map(r => ({
            month: r.month,
            hours: Math.round((Number(r.seconds) / 3600) * 4) / 4,
            orders: Number(r.orders),
        }));
    } catch (e) {
        // No orders or payments table (e.g. a plugin-only schema).
    }
    return { sessionTimezone, columns, offsetByMonth };
}

async function currentTimezone(queryRunner: QueryRunner): Promise<string> {
    const [row] = await queryRunner.query(`SELECT current_setting('TimeZone') AS tz`);
    return row.tz;
}

/**
 * Node.js (ICU) reports some zones by their old names, e.g. `Asia/Calcutta`. Recent tzdata builds
 * of Postgres no longer know these.
 */
const ICU_LEGACY_ZONES: Record<string, string> = {
    'Asia/Calcutta': 'Asia/Kolkata',
    'Asia/Saigon': 'Asia/Ho_Chi_Minh',
    'Asia/Katmandu': 'Asia/Kathmandu',
    'Asia/Rangoon': 'Asia/Yangon',
    'Europe/Kiev': 'Europe/Kyiv',
    'Atlantic/Faeroe': 'Atlantic/Faroe',
    'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
    'Pacific/Truk': 'Pacific/Chuuk',
    'Pacific/Ponape': 'Pacific/Pohnpei',
};

async function resolveZone(queryRunner: QueryRunner, zone: string): Promise<string> {
    if (isUtc(zone)) {
        return 'UTC';
    }
    for (const candidate of [zone, ICU_LEGACY_ZONES[zone]].filter(Boolean)) {
        try {
            await queryRunner.query(`SELECT now() AT TIME ZONE ${quote(candidate)}`);
            return candidate;
        } catch (e) {
            // try the next name
        }
    }
    throw new Error(`"${zone}" is not a timezone known to Postgres (see pg_timezone_names).`);
}

/**
 * `col AT TIME ZONE zone`, except for wall-clock times which occur twice (the repeated hour when
 * daylight saving time ends). For those, Postgres picks the later instant, but node-postgres (and
 * so pre-v4 Vendure) read them as the earlier one. This picks the earlier one, so that no value
 * changes from what Vendure showed before the migration. Assumes a DST shift of one hour.
 */
function wallTimeToInstant(col: string, zone: string) {
    const z = quote(zone);
    const later = `(${col} AT TIME ZONE ${z})`;
    return `CASE WHEN ((${later} - interval '1 hour') AT TIME ZONE ${z}) = ${col} THEN ${later} - interval '1 hour' ELSE ${later} END`;
}

function groupByTable(columns: TimestampColumnToMigrate[]) {
    const map = new Map<string, TimestampColumnToMigrate[]>();
    for (const c of columns) {
        map.set(c.table, [...(map.get(c.table) ?? []), c]);
    }
    return map;
}

function quote(value: string) {
    return `'${value.replace(/'/g, "''")}'`;
}

async function run(queryRunner: QueryRunner, sql: string, log = true) {
    const start = Date.now();
    await queryRunner.query(sql);
    if (log) {
        console.log(`${sql} (${Date.now() - start} ms)`);
    }
}
