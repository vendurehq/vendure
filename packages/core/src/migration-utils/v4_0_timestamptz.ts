/* eslint-disable no-console */
// One-time v4.0 migration helper: converts Postgres `timestamp` columns to `timestamptz`.
// It must stay exported: user migrations import it directly. Every function is a no-op on a
// database that has already been migrated, and on databases other than Postgres.
import { QueryRunner } from 'typeorm';
import { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata';
import { EntityMetadata } from 'typeorm/metadata/EntityMetadata';

import { isPostgresDatabase, isUtcTimezone } from '../connection/timezone-utils';
import { isConvertedTimestampColumn } from '../entity/set-timestamp-column-types';

/**
 * @description
 * One column that {@link migrateTimestampColumnsToTimestamptz} converts.
 *
 * @docsCategory migration
 */
export interface TimestampColumnToMigrate {
    /** The Postgres schema of the table. */
    schema: string;
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
     *
     * @default the timezone of the process running the migration, which is usually the same
     * deployment as the server
     */
    processTimezone?: string;
    /**
     * The Postgres session timezone (`SHOW timezone`, usually the server's `timezone` setting) while
     * the existing data was written. The values of `createdAt` and `updatedAt` are wall-clock times
     * in this zone, because Postgres fills them with `now()`.
     *
     * @default the session timezone of the migration connection when the helper is called
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
     * Before changing anything, checks the two timezones against your orders: for each month
     * with at least 3 orders, `orderPlacedAt` (written in the process timezone) must be as far
     * from the `createdAt` of the order's first payment (written in the database timezone) as the
     * two zones are apart. Throws if any month disagrees, because the conversion would then shift
     * the values. Set to `false` only once you have checked the zones some other way.
     *
     * @default true
     */
    verify?: boolean;
    /**
     * Logs each statement and its duration.
     *
     * @default true
     */
    log?: boolean;
}

type ColumnWithMetadata = TimestampColumnToMigrate & {
    metadata: EntityMetadata;
    columnMetadata: ColumnMetadata;
};

/**
 * @description
 * Lists the columns which are `timestamptz` in the current entity metadata but still
 * `timestamp without time zone` in the database. These are the columns which
 * {@link migrateTimestampColumnsToTimestamptz} converts.
 *
 * @docsCategory migration
 */
export async function findTimestampColumnsToMigrate(
    queryRunner: QueryRunner,
): Promise<TimestampColumnToMigrate[]> {
    return (await findColumns(queryRunner, 'timestamp without time zone')).map(stripMetadata);
}

/**
 * The timestamptz columns of the entity metadata whose database type is `dataType`, in the schema
 * of their own entity (`dbConnectionOptions.schema` / `@Entity({ schema })`), not the session's
 * `search_path`: TypeORM qualifies table paths instead of setting `search_path`.
 */
async function findColumns(
    queryRunner: QueryRunner,
    dataType: string,
    declared: (column: ColumnMetadata) => boolean = isTimestamptz,
): Promise<ColumnWithMetadata[]> {
    const connection = queryRunner.connection;
    if (!isPostgresDatabase(connection.options.type)) {
        return [];
    }
    const currentSchema: string = (await queryRunner.query(`SELECT current_schema() AS schema`))[0].schema;
    const driverSchema: string | undefined = (connection.driver as { schema?: string }).schema;
    const rows: Array<{ table_schema: string; table_name: string; column_name: string }> =
        await queryRunner.query(
            `SELECT table_schema, table_name, column_name FROM information_schema.columns WHERE data_type = $1`,
            [dataType],
        );
    const actual = new Set(rows.map(r => `${r.table_schema}.${r.table_name}.${r.column_name}`));
    const result: ColumnWithMetadata[] = [];
    const seen = new Set<string>();
    for (const metadata of connection.entityMetadatas) {
        if (metadata.tableType === 'view') {
            continue;
        }
        const schema = metadata.schema ?? driverSchema ?? currentSchema;
        for (const column of metadata.columns) {
            if (!declared(column)) {
                continue;
            }
            const key = `${schema}.${metadata.tableName}.${column.databaseName}`;
            if (!actual.has(key) || seen.has(key)) {
                continue;
            }
            seen.add(key);
            result.push({
                schema,
                table: metadata.tableName,
                column: column.databaseName,
                // TypeORM fills @DeleteDateColumn with CURRENT_TIMESTAMP on soft delete. Vendure's own
                // `deletedAt` columns are plain Date columns, written by the application.
                filledByDatabase: column.isCreateDate || column.isUpdateDate || column.isDeleteDate,
                precision: column.precision ?? undefined,
                metadata,
                columnMetadata: column,
            });
        }
    }
    return result.sort((a, b) =>
        `${a.schema}.${a.table}.${a.column}`.localeCompare(`${b.schema}.${b.table}.${b.column}`),
    );
}

function stripMetadata({
    metadata,
    columnMetadata,
    ...column
}: ColumnWithMetadata): TimestampColumnToMigrate {
    return column;
}

/**
 * @description
 * Lists the columns which the entity metadata declares as `timestamp` but which are `timestamptz` in
 * the database, e.g. after switching `EntityOptions.timestampColumnType` back to `'timestamp'`
 * without reverting the migration. Synchronizing would drop and re-add them.
 *
 * @internal
 */
export async function findTimestamptzColumnsDeclaredAsTimestamp(
    queryRunner: QueryRunner,
): Promise<TimestampColumnToMigrate[]> {
    const driver = queryRunner.connection.driver;
    return (
        await findColumns(
            queryRunner,
            'timestamp with time zone',
            column => driver.normalizeType(column) === 'timestamp without time zone',
        )
    ).map(stripMetadata);
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
 * The helper must run inside a transaction, which is the default for migrations
 * (`migrationsTransactionMode: 'each'` or `'all'`). It changes the session's `timezone` and
 * `lock_timeout` while it runs, and restores them afterwards.
 *
 * Use {@link previewTimestamptzMigration} first to see which columns change and to check the
 * timezones against your data.
 *
 * @example
 * ```ts
 * import { migrateTimestampColumnsToTimestamptz, revertTimestamptzMigration } from '\@vendure/core';
 *
 * export class Timestamptz1700000000000 implements MigrationInterface {
 *     public async up(queryRunner: QueryRunner) {
 *         await migrateTimestampColumnsToTimestamptz(queryRunner);
 *     }
 *     public async down(queryRunner: QueryRunner) {
 *         await revertTimestamptzMigration(queryRunner);
 *     }
 * }
 * ```
 *
 * @docsCategory migration
 * @since 4.0.0
 */
export async function migrateTimestampColumnsToTimestamptz(
    queryRunner: QueryRunner,
    options: TimestamptzMigrationOptions = {},
): Promise<TimestampColumnToMigrate[]> {
    if (!(await findColumns(queryRunner, 'timestamp without time zone')).length) {
        return [];
    }
    await lockConversion(queryRunner);
    // Listed again under the lock: another process (e.g. the worker next to the server) may have
    // converted the columns meanwhile, and converting them twice would shift the values.
    const columns = await findColumns(queryRunner, 'timestamp without time zone');
    if (!columns.length) {
        return [];
    }
    await convertColumns(queryRunner, options, columns, 'with time zone');
    return columns.map(stripMetadata);
}

/**
 * @description
 * The reverse of {@link migrateTimestampColumnsToTimestamptz}, for the `down()` method of the
 * migration. Converts the columns which Vendure made `timestamptz` back to `timestamp`, as
 * wall-clock time in the same zones. Columns which an entity declares as `timestamptz` itself are
 * left alone. Like the migration, it must run inside a transaction.
 *
 * Which columns Vendure converted is recorded when the Vendure config is loaded (as `vendure migrate`
 * does), so call it from a migration run by Vendure, not from a bare TypeORM DataSource.
 *
 * @docsCategory migration
 * @since 4.0.0
 */
export async function revertTimestamptzMigration(
    queryRunner: QueryRunner,
    options: TimestamptzMigrationOptions = {},
): Promise<void> {
    const findConverted = async () =>
        (await findColumns(queryRunner, 'timestamp with time zone')).filter(c =>
            isConvertedTimestampColumn(c.columnMetadata.target, c.columnMetadata.propertyName),
        );
    if (!(await findConverted()).length) {
        return;
    }
    await lockConversion(queryRunner);
    const columns = await findConverted();
    if (!columns.length) {
        return;
    }
    await convertColumns(queryRunner, options, columns, 'without time zone');
}

/**
 * Serializes conversions across processes, until the end of the transaction. Requires one.
 */
async function lockConversion(queryRunner: QueryRunner) {
    if (!queryRunner.isTransactionActive) {
        // `SET LOCAL` and transaction-level advisory locks have no effect outside a transaction.
        throw new Error(
            'The timestamptz migration must run inside a transaction. Use migrationsTransactionMode ' +
                "'each' or 'all', or call queryRunner.startTransaction() first.",
        );
    }
    await queryRunner.query(`SELECT pg_advisory_xact_lock(hashtext('vendure:timestamptz-migration'))`);
}

async function convertColumns(
    queryRunner: QueryRunner,
    options: TimestamptzMigrationOptions,
    columns: ColumnWithMetadata[],
    to: 'with time zone' | 'without time zone',
) {
    // Read the session settings before changing them: they are the default databaseTimezone, and
    // they are restored afterwards so that later migrations in the same transaction are unaffected.
    const [{ tz: previousTimezone, lockTimeout: previousLockTimeout }] = await queryRunner.query(
        `SELECT current_setting('TimeZone') AS tz, current_setting('lock_timeout') AS "lockTimeout"`,
    );
    const databaseTimezone = await resolveZone(queryRunner, options.databaseTimezone ?? previousTimezone);
    const processTimezone = await resolveZone(
        queryRunner,
        options.processTimezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    if (to === 'with time zone' && options.verify !== false) {
        await verifyTimezones(queryRunner, columns, processTimezone, databaseTimezone);
    }
    if (options.lockTimeout) {
        await queryRunner.query(`SELECT set_config('lock_timeout', $1, true)`, [options.lockTimeout]);
    }
    // With the session in UTC, Postgres 12+ converts timestamp <-> timestamptz without a rewrite
    // when no USING clause is given.
    await queryRunner.query(`SELECT set_config('timezone', 'UTC', true)`);
    try {
        for (const tableColumns of groupByTable(columns).values()) {
            const clauses = tableColumns.map(c => {
                const zone = c.filledByDatabase ? databaseTimezone : processTimezone;
                const type = `timestamp${c.precision != null ? `(${c.precision})` : ''} ${to}`;
                const col = quoteIdent(c.column);
                const using = isUtcTimezone(zone)
                    ? ''
                    : to === 'with time zone'
                      ? ` USING ${wallTimeToInstant(col, zone)}`
                      : ` USING ${col} AT TIME ZONE ${quote(zone)}`;
                return `ALTER COLUMN ${col} TYPE ${type}${using}`;
            });
            const table = `${quoteIdent(tableColumns[0].schema)}.${quoteIdent(tableColumns[0].table)}`;
            await run(queryRunner, `ALTER TABLE ${table} ${clauses.join(', ')}`, options.log);
        }
    } finally {
        if (queryRunner.isTransactionActive) {
            await queryRunner
                .query(`SELECT set_config('timezone', $1, true), set_config('lock_timeout', $2, true)`, [
                    previousTimezone,
                    previousLockTimeout,
                ])
                .catch(() => {
                    // The transaction failed; it is rolled back, and the settings with it.
                });
        }
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
    offsetByMonth: Array<{
        month: string;
        hours: number;
        orders: number;
        /**
         * `false` when the median is not close to a whole quarter hour within ±14 hours, which a
         * timezone offset would be. That happens when payments are not created as the order is
         * placed, e.g. with an `OrderPlacedStrategy` which places orders before payment. Such months
         * are not checked.
         */
        conclusive: boolean;
    }>;
}

/**
 * @description
 * Lists the columns which {@link migrateTimestampColumnsToTimestamptz} would convert, and estimates
 * the difference between the timezone of the Node.js process and the timezone of Postgres from your
 * orders. Changes nothing, and does not abort a surrounding transaction.
 *
 * @docsCategory migration
 * @since 4.0.0
 */
export async function previewTimestamptzMigration(
    queryRunner: QueryRunner,
): Promise<TimestamptzMigrationPreview> {
    const columns = await findColumns(queryRunner, 'timestamp without time zone');
    const [{ tz: sessionTimezone }] = await queryRunner.query(`SELECT current_setting('TimeZone') AS tz`);
    const offsetByMonth = await measureOffsetByMonth(queryRunner, columns);
    return { sessionTimezone, columns: columns.map(stripMetadata), offsetByMonth };
}

/**
 * Per month, the median of `orderPlacedAt - first payment createdAt` in hours, rounded to 15 minutes.
 * Both columns must still be `timestamp`.
 */
async function measureOffsetByMonth(
    queryRunner: QueryRunner,
    columns: ColumnWithMetadata[],
): Promise<TimestamptzMigrationPreview['offsetByMonth']> {
    const order = columns.find(c => c.metadata.name === 'Order' && c.column === 'orderPlacedAt');
    const payment = columns.find(c => c.metadata.name === 'Payment' && c.column === 'createdAt');
    if (!order || !payment) {
        return [];
    }
    const orderTable = `${quoteIdent(order.schema)}.${quoteIdent(order.table)}`;
    const paymentTable = `${quoteIdent(payment.schema)}.${quoteIdent(payment.table)}`;
    const rows: Array<{ month: string; seconds: string; orders: string }> = await queryRunner.query(
        `SELECT to_char(date_trunc('month', o."orderPlacedAt"), 'YYYY-MM') AS month,
                percentile_cont(0.5) WITHIN GROUP (
                    ORDER BY extract(epoch FROM (o."orderPlacedAt" - p."createdAt"))
                ) AS seconds,
                count(*) AS orders
         FROM ${orderTable} o
         JOIN (SELECT "orderId", min("createdAt") AS "createdAt" FROM ${paymentTable} GROUP BY "orderId") p
           ON p."orderId" = o.id
         WHERE o."orderPlacedAt" IS NOT NULL
         GROUP BY 1 ORDER BY 1`,
    );
    return rows.map(r => {
        const seconds = Number(r.seconds);
        const hours = Math.round((seconds / 3600) * 4) / 4;
        return {
            month: r.month,
            hours,
            orders: Number(r.orders),
            conclusive:
                Math.abs(seconds - hours * 3600) <= MAX_SECONDS_FROM_QUARTER_HOUR && Math.abs(hours) <= 14,
        };
    });
}

const MIN_ORDERS_TO_VERIFY_A_MONTH = 3;
/** Payments are created a few milliseconds to seconds before the order is placed. */
const MAX_SECONDS_FROM_QUARTER_HOUR = 120;

/**
 * Throws if the orders contradict the two zones. See `TimestamptzMigrationOptions.verify`.
 */
async function verifyTimezones(
    queryRunner: QueryRunner,
    columns: ColumnWithMetadata[],
    processTimezone: string,
    databaseTimezone: string,
) {
    const mismatches: string[] = [];
    for (const { month, hours, orders, conclusive } of await measureOffsetByMonth(queryRunner, columns)) {
        if (orders < MIN_ORDERS_TO_VERIFY_A_MONTH || !conclusive) {
            continue;
        }
        const midMonth = new Date(`${month}-15T12:00:00Z`);
        const expected =
            (utcOffsetMinutes(processTimezone, midMonth) - utcOffsetMinutes(databaseTimezone, midMonth)) / 60;
        if (Math.abs(hours - expected) >= 0.5) {
            mismatches.push(
                `${month}: the orders show ${hours}h, the timezones give ${expected}h (${orders} orders)`,
            );
        }
    }
    if (mismatches.length) {
        throw new Error(
            `The existing dates do not look like they were written with processTimezone "${processTimezone}" ` +
                `and databaseTimezone "${databaseTimezone}". Converting would shift them. For each month, ` +
                `orderPlacedAt minus the first payment's createdAt should equal the offset of processTimezone ` +
                `minus the offset of databaseTimezone:\n  ${mismatches.join('\n  ')}\n` +
                `Pass the timezones the data was written in. If they changed over time, convert the ` +
                `affected rows by hand first, then pass verify: false. With synchronize: true, convert ` +
                `them with a migration instead.`,
        );
    }
}

/**
 * The UTC offset of a zone at an instant, in minutes. Throws if Node.js does not know the zone,
 * rather than skip the check.
 */
function utcOffsetMinutes(zone: string, at: Date): number {
    if (isUtcTimezone(zone)) {
        return 0;
    }
    let name: string | undefined;
    try {
        name = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
            .formatToParts(at)
            .find(p => p.type === 'timeZoneName')?.value;
    } catch (e) {
        // handled below
    }
    const match = name?.match(/^GMT(?:([+-])(\d{2}):(\d{2}))?$/);
    if (!match) {
        throw new Error(
            `Cannot check the timezone "${zone}": Node.js does not know it. Pass an IANA timezone ` +
                `(e.g. "Europe/Vienna") as processTimezone and databaseTimezone, or pass verify: false.`,
        );
    }
    const minutes = match[1] ? Number(match[2]) * 60 + Number(match[3]) : 0;
    return match[1] === '-' ? -minutes : minutes;
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

/**
 * Checks the name against `pg_timezone_names` rather than trying it, because a failed query would
 * abort the migration's transaction.
 */
async function resolveZone(queryRunner: QueryRunner, zone: string): Promise<string> {
    if (isUtcTimezone(zone)) {
        return 'UTC';
    }
    for (const candidate of [zone, ICU_LEGACY_ZONES[zone]].filter(Boolean)) {
        const rows = await queryRunner.query(`SELECT 1 FROM pg_timezone_names WHERE name = $1`, [candidate]);
        if (rows.length) {
            return candidate;
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

function groupByTable(columns: ColumnWithMetadata[]) {
    const map = new Map<string, ColumnWithMetadata[]>();
    for (const c of columns) {
        const key = `${c.schema}.${c.table}`;
        map.set(key, [...(map.get(key) ?? []), c]);
    }
    return map;
}

function quote(value: string) {
    return `'${value.replace(/'/g, "''")}'`;
}

function quoteIdent(value: string) {
    return `"${value.replace(/"/g, '""')}"`;
}

async function run(queryRunner: QueryRunner, sql: string, log = true) {
    const start = Date.now();
    await queryRunner.query(sql);
    if (log) {
        console.log(`${sql} (${Date.now() - start} ms)`);
    }
}
