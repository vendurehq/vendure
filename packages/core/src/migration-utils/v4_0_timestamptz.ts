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
     */
    processTimezone: string;
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
     * Logs each statement and its duration.
     *
     * @default true
     */
    log?: boolean;
}

type ColumnWithMetadata = TimestampColumnToMigrate & { metadata: EntityMetadata; columnMetadata: ColumnMetadata };

/**
 * @description
 * Lists the columns which are `timestamptz` in the current entity metadata but still
 * `timestamp without time zone` in the database. These are the columns which
 * {@link migrateTimestampColumnsToTimestamptz} converts.
 *
 * @docsCategory migration
 */
export async function findTimestampColumnsToMigrate(queryRunner: QueryRunner): Promise<TimestampColumnToMigrate[]> {
    return (await findColumns(queryRunner, 'timestamp without time zone')).map(stripMetadata);
}

/**
 * The timestamptz columns of the entity metadata whose database type is `dataType`, in the schema
 * of their own entity (`dbConnectionOptions.schema` / `@Entity({ schema })`), not the session's
 * `search_path`: TypeORM qualifies table paths instead of setting `search_path`.
 */
async function findColumns(queryRunner: QueryRunner, dataType: string): Promise<ColumnWithMetadata[]> {
    const connection = queryRunner.connection;
    if (!isPostgresDatabase(connection.options.type)) {
        return [];
    }
    const currentSchema: string = (await queryRunner.query(`SELECT current_schema() AS schema`))[0].schema;
    const driverSchema: string | undefined = (connection.driver as { schema?: string }).schema;
    const rows: Array<{ table_schema: string; table_name: string; column_name: string }> = await queryRunner.query(
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
            if (!isTimestamptz(column)) {
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

function stripMetadata({ metadata, columnMetadata, ...column }: ColumnWithMetadata): TimestampColumnToMigrate {
    return column;
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
 * @docsCategory migration
 * @since 4.0.0
 */
export async function revertTimestamptzMigration(
    queryRunner: QueryRunner,
    options: TimestamptzMigrationOptions,
): Promise<void> {
    const columns = (await findColumns(queryRunner, 'timestamp with time zone')).filter(c =>
        isConvertedTimestampColumn(c.columnMetadata.target, c.columnMetadata.propertyName),
    );
    if (!columns.length) {
        return;
    }
    await convertColumns(queryRunner, options, columns, 'without time zone');
}

async function convertColumns(
    queryRunner: QueryRunner,
    options: TimestamptzMigrationOptions,
    columns: ColumnWithMetadata[],
    to: 'with time zone' | 'without time zone',
) {
    if (!queryRunner.isTransactionActive) {
        // `SET LOCAL` is ignored outside a transaction, and the UTC fast path depends on it.
        throw new Error(
            'The timestamptz migration must run inside a transaction. Use migrationsTransactionMode ' +
                "'each' or 'all', or call queryRunner.startTransaction() first.",
        );
    }
    // Read the session settings before changing them: they are the default databaseTimezone, and
    // they are restored afterwards so that later migrations in the same transaction are unaffected.
    const [{ tz: previousTimezone, lockTimeout: previousLockTimeout }] = await queryRunner.query(
        `SELECT current_setting('TimeZone') AS tz, current_setting('lock_timeout') AS "lockTimeout"`,
    );
    const databaseTimezone = await resolveZone(queryRunner, options.databaseTimezone ?? previousTimezone);
    const processTimezone = await resolveZone(queryRunner, options.processTimezone);
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
                .query(
                    `SELECT set_config('timezone', $1, true), set_config('lock_timeout', $2, true)`,
                    [previousTimezone, previousLockTimeout],
                )
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
    offsetByMonth: Array<{ month: string; hours: number; orders: number }>;
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
export async function previewTimestamptzMigration(queryRunner: QueryRunner): Promise<TimestamptzMigrationPreview> {
    const columns = await findColumns(queryRunner, 'timestamp without time zone');
    const [{ tz: sessionTimezone }] = await queryRunner.query(`SELECT current_setting('TimeZone') AS tz`);
    const order = columns.find(c => c.metadata.name === 'Order' && c.column === 'orderPlacedAt');
    const payment = columns.find(c => c.metadata.name === 'Payment' && c.column === 'createdAt');
    let offsetByMonth: TimestamptzMigrationPreview['offsetByMonth'] = [];
    if (order && payment) {
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
        offsetByMonth = rows.map(r => ({
            month: r.month,
            hours: Math.round((Number(r.seconds) / 3600) * 4) / 4,
            orders: Number(r.orders),
        }));
    }
    return { sessionTimezone, columns: columns.map(stripMetadata), offsetByMonth };
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
