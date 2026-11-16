/* eslint-disable no-console */
import { QueryRunner } from 'typeorm';

import { isMysqlDatabase, isPostgresDatabase } from '../connection/timezone-utils';

import { escTable, qualifiedTableName } from './v4_0_role_assignments';

/**
 * An `@EntityId()` column which gets a foreign key in v4.0 (#2318). Rows referring to a deleted
 * row must be cleaned up before the foreign key can be added.
 */
interface NewForeignKey {
    table: string;
    column: string;
    /** The table whose `id` the column holds. */
    references: string;
}

const ORDER_TAX_ZONE: NewForeignKey = { table: 'order', column: 'taxZoneId', references: 'zone' };
const PRICE_CHANNEL: NewForeignKey = {
    table: 'product_variant_price',
    column: 'channelId',
    references: 'channel',
};

interface ColumnToConvert {
    /** The table path, as used in SQL, e.g. `vdr_order` or `myschema.order` */
    tablePath: string;
    column: string;
    isNullable: boolean;
}

/**
 * @description
 * The result of {@link prepareEntityIdForeignKeys}.
 *
 * @docsCategory migration
 * @since 4.0.0
 */
export interface EntityIdForeignKeyMigrationResult {
    /**
     * The columns converted to the `uuid` type, as `table.column`. Only on PostgreSQL and on
     * MariaDB 10.7+ with the UUID id strategy; empty otherwise.
     */
    convertedColumns: string[];
    /** The number of Orders whose `taxZoneId` referred to a deleted Zone and was set to `NULL`. */
    clearedOrderTaxZones: number;
    /** The number of ProductVariantPrices of a deleted Channel which were deleted. */
    deletedProductVariantPrices: number;
}

/**
 * @description
 * v4.0 data migration for the new foreign keys on `order.taxZoneId` and
 * `product_variant_price.channelId`, and for the type of `@EntityId()` columns (#2318).
 *
 * Call it from your v4 migration **before** the generated statements, which add the foreign keys.
 * It does two things:
 *
 * 1. With the UUID id strategy on PostgreSQL, or on MariaDB 10.7+ (which has a native `uuid` type),
 *    it converts the `@EntityId()` columns which v3 created as `varchar` to `uuid`, keeping their
 *    data. These are `order.taxZoneId`, `product_variant_price.channelId`, and any such column of a
 *    plugin entity. The generated migration drops and re-adds these columns instead, which deletes
 *    their data, so delete those statements from it. On other databases, and with integer ids, the
 *    column types do not change.
 * 2. It removes the references to deleted rows, which the foreign keys would reject:
 *    - `order.taxZoneId` of a deleted Zone is set to `NULL`. The next tax calculation of the
 *      Order then uses the active tax Zone, as it would for any Zone change.
 *    - The ProductVariantPrices of a deleted Channel are deleted. Vendure deletes them along
 *      with the Channel, so these could not be read or changed anyway.
 *
 * The columns to convert are found from the entity metadata of the connection, so the migration
 * must run with your Vendure config, as `npx vendure migrate` does. The counts are returned and
 * logged. Table names honour the `entityPrefix` of the connection options and, on Postgres, the
 * `schema` option. It can be run again: it skips work which is done.
 *
 * Vendure v4 refuses to synchronize the schema until it has run.
 *
 * @docsCategory migration
 * @since 4.0.0
 */
export async function prepareEntityIdForeignKeys(
    queryRunner: QueryRunner,
): Promise<EntityIdForeignKeyMigrationResult> {
    const orderTable = qualifiedTableName(queryRunner, 'order');
    if (!(await queryRunner.hasTable(orderTable))) {
        throw new Error(
            `[v4 entity ids] Table "${orderTable}" not found. Check the entityPrefix and schema of ` +
                'your dbConnectionOptions.',
        );
    }
    const convertedColumns: string[] = [];
    // Converted first: PostgreSQL cannot compare a varchar column with a uuid primary key.
    for (const column of await findEntityIdColumnsToConvert(queryRunner)) {
        await convertToUuid(queryRunner, column);
        convertedColumns.push(`${column.tablePath}.${column.column}`);
        console.log(`[v4 entity ids] Converted ${column.tablePath}.${column.column} to uuid.`);
    }

    const clearedOrderTaxZones = await countOrphans(queryRunner, ORDER_TAX_ZONE);
    if (clearedOrderTaxZones) {
        await queryRunner.query(
            `UPDATE ${tableSql(queryRunner, ORDER_TAX_ZONE)} SET ${esc(queryRunner, 'taxZoneId')} = NULL ` +
                `WHERE ${orphanCondition(queryRunner, ORDER_TAX_ZONE)}`,
        );
    }
    console.log(
        `[v4 entity ids] Set order.taxZoneId to NULL on ${clearedOrderTaxZones} Order(s) of a deleted Zone.`,
    );

    const deletedProductVariantPrices = await countOrphans(queryRunner, PRICE_CHANNEL);
    if (deletedProductVariantPrices) {
        await queryRunner.query(
            `DELETE FROM ${tableSql(queryRunner, PRICE_CHANNEL)} WHERE ${orphanCondition(queryRunner, PRICE_CHANNEL)}`,
        );
    }
    console.log(
        `[v4 entity ids] Deleted ${deletedProductVariantPrices} ProductVariantPrice(s) of a deleted Channel.`,
    );

    return { convertedColumns, clearedOrderTaxZones, deletedProductVariantPrices };
}

/**
 * Throws if {@link prepareEntityIdForeignKeys} has work left to do. Vendure calls it before
 * synchronizing the schema: synchronize would drop and re-add the columns whose type changes,
 * deleting their data, and adding the foreign keys would fail on rows referring to deleted rows.
 * It only reads. Once the foreign keys exist it does not look for such rows, since the database
 * then rules them out.
 *
 * @internal
 */
export async function assertEntityIdColumnsMigrated(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable(qualifiedTableName(queryRunner, 'order')))) {
        // A new database
        return;
    }
    const toConvert = await findEntityIdColumnsToConvert(queryRunner);
    const problems: string[] = [];
    if (toConvert.length) {
        const columns = toConvert.map(c => `"${c.tablePath}"."${c.column}"`).join(', ');
        problems.push(
            `${columns} must be converted to uuid, which synchronizing would do by dropping and ` +
                're-creating them, deleting their data',
        );
    }
    for (const foreignKey of [ORDER_TAX_ZONE, PRICE_CHANNEL]) {
        const tablePath = qualifiedTableName(queryRunner, foreignKey.table);
        // Compared only once the types match: PostgreSQL cannot compare varchar with uuid.
        if (toConvert.some(c => c.column === foreignKey.column && c.tablePath === tablePath)) {
            continue;
        }
        if (await hasForeignKey(queryRunner, foreignKey)) {
            continue;
        }
        const count = await countOrphans(queryRunner, foreignKey);
        if (count) {
            problems.push(
                `${count} row(s) of "${foreignKey.table}" refer to a deleted ${foreignKey.references}, ` +
                    'so the new foreign key cannot be added',
            );
        }
    }
    if (problems.length) {
        throw new Error(
            `The v4 entity id migration has not run: ${problems.join('; ')}. Set synchronize to false ` +
                'and run a migration which calls prepareEntityIdForeignKeys() before the generated ' +
                'statements. See https://docs.vendure.io/current/framework/developer-guide/migrating-from-v3/entity-id-columns',
        );
    }
}

/**
 * Returns the columns which the entity metadata declares as `uuid` but which have another type
 * in the database. Under the UUID strategy, v3 created `@EntityId()` columns without a relation
 * as `varchar`. Only databases with a native `uuid` type have any: elsewhere, TypeORM stores a
 * `uuid` column as `varchar` anyway.
 */
async function findEntityIdColumnsToConvert(queryRunner: QueryRunner): Promise<ColumnToConvert[]> {
    const { driver, entityMetadatas } = queryRunner.connection;
    if (driver.normalizeType({ type: 'uuid' }) !== 'uuid') {
        return [];
    }
    // Several entities can share a table (single table inheritance, channel assignment entities)
    const uuidColumnsByTable = new Map<string, Set<string>>();
    for (const metadata of entityMetadatas) {
        if (metadata.tableType === 'view') {
            continue;
        }
        for (const column of metadata.columns) {
            if (!column.isVirtual && driver.normalizeType(column) === 'uuid') {
                const columns = uuidColumnsByTable.get(metadata.tablePath) ?? new Set<string>();
                columns.add(column.databaseName);
                uuidColumnsByTable.set(metadata.tablePath, columns);
            }
        }
    }
    if (!uuidColumnsByTable.size) {
        // Integer ids
        return [];
    }
    const tables = new Map(
        (await queryRunner.getTables([...uuidColumnsByTable.keys()])).map(t => [tableName(t.name), t]),
    );
    const result: ColumnToConvert[] = [];
    for (const [tablePath, columns] of uuidColumnsByTable) {
        const table = tables.get(tableName(tablePath));
        for (const column of columns) {
            const tableColumn = table?.findColumnByName(column);
            if (tableColumn && tableColumn.type !== 'uuid') {
                result.push({ tablePath, column, isNullable: tableColumn.isNullable });
            }
        }
    }
    return result;
}

async function convertToUuid(queryRunner: QueryRunner, column: ColumnToConvert) {
    const type = queryRunner.connection.driver.options.type;
    const table = escTable(queryRunner, column.tablePath);
    const name = esc(queryRunner, column.column);
    let sql: string;
    if (isPostgresDatabase(type) || type === 'cockroachdb') {
        sql = `ALTER TABLE ${table} ALTER COLUMN ${name} TYPE uuid USING ${name}::uuid`;
    } else if (isMysqlDatabase(type)) {
        // MariaDB 10.7+. MODIFY keeps the primary key and the indexes of the column.
        sql = `ALTER TABLE ${table} MODIFY ${name} uuid ${column.isNullable ? 'NULL' : 'NOT NULL'}`;
    } else {
        throw new Error(
            `[v4 entity ids] Converting ${column.tablePath}.${column.column} to uuid is not supported ` +
                `on "${type}". Convert it in your migration before the generated statements.`,
        );
    }
    try {
        await queryRunner.query(sql);
    } catch (e: any) {
        throw new Error(
            `[v4 entity ids] Could not convert ${column.tablePath}.${column.column} to uuid: ` +
                `${String(e?.message)}. If a value is rejected, each value of the column must be a ` +
                'UUID or NULL.',
        );
    }
}

async function hasForeignKey(queryRunner: QueryRunner, foreignKey: NewForeignKey): Promise<boolean> {
    const table = await queryRunner.getTable(qualifiedTableName(queryRunner, foreignKey.table));
    return !!table?.foreignKeys.some(
        fk => fk.columnNames.length === 1 && fk.columnNames[0] === foreignKey.column,
    );
}

/** The table name without the schema, as TypeORM reports it for tables of the current schema. */
function tableName(tablePath: string): string {
    return tablePath.split('.').pop() as string;
}

function tableSql(queryRunner: QueryRunner, foreignKey: NewForeignKey): string {
    return escTable(queryRunner, qualifiedTableName(queryRunner, foreignKey.table));
}

/** The condition matching rows which refer to a row that no longer exists. */
function orphanCondition(queryRunner: QueryRunner, foreignKey: NewForeignKey): string {
    const name = esc(queryRunner, foreignKey.column);
    const referenced = escTable(queryRunner, qualifiedTableName(queryRunner, foreignKey.references));
    // The outer table is referenced by its name without the schema, which every supported
    // database accepts inside a correlated subquery.
    const outer = esc(queryRunner, tableName(qualifiedTableName(queryRunner, foreignKey.table)));
    const ref = esc(queryRunner, 'referenced');
    return (
        `${outer}.${name} IS NOT NULL AND NOT EXISTS (` +
        `SELECT 1 FROM ${referenced} ${ref} WHERE ${ref}.${esc(queryRunner, 'id')} = ${outer}.${name})`
    );
}

async function countOrphans(queryRunner: QueryRunner, foreignKey: NewForeignKey): Promise<number> {
    const rows = await queryRunner.query(
        `SELECT COUNT(*) AS ${esc(queryRunner, 'c')} FROM ${tableSql(queryRunner, foreignKey)} ` +
            `WHERE ${orphanCondition(queryRunner, foreignKey)}`,
    );
    return Number(rows[0].c);
}

function esc(queryRunner: QueryRunner, name: string): string {
    return queryRunner.connection.driver.escape(name);
}
