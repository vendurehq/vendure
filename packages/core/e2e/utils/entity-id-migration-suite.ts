import { ID } from '@vendure/common/lib/shared-types';
import {
    DefaultJobQueuePlugin,
    DefaultSearchPlugin,
    EntityId,
    EntityIdStrategy,
    mergeConfig,
    PluginCommonModule,
    TransactionalConnection,
    VendureConfig,
    VendurePlugin,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { DataSource, Entity, PrimaryColumn, Query, QueryRunner } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS } from '../../../../e2e-common/test-config';
import {
    assertEntityIdColumnsMigrated,
    prepareEntityIdForeignKeys,
} from '../../src/migration-utils/v4_0_entity_id_foreign_keys';
import { reindexDocument } from '../graphql/admin-definitions';
import { addItemToOrderDocument } from '../graphql/shop-definitions';

import { awaitRunningJobs } from './await-running-jobs';

/**
 * A plugin entity with `@EntityId()` columns without a relation, whose type v4.0 changes too. One
 * of them is part of a composite primary key, like the key of the search index, so the generated
 * migration also drops and re-adds the primary key around it.
 */
@Entity()
class EntityIdTestItem {
    @EntityId({ primary: true })
    productVariantId: ID;

    @PrimaryColumn()
    code: string;

    @EntityId({ nullable: true })
    otherVariantId: ID | null;
}

@VendurePlugin({ imports: [PluginCommonModule], entities: [EntityIdTestItem] })
class EntityIdTestPlugin {}

interface EntityIdMigrationSuiteOptions {
    entityIdStrategy: EntityIdStrategy<any>;
    /** An id which no row has, of the type the strategy uses. */
    missingId: string | number;
    entityPrefix?: string;
}

/** The options for `server.init()` of {@link entityIdMigrationSuite}. */
export const entityIdMigrationInitOptions = {
    initialData,
    customerCount: 1,
    productsCsvPath: path.join(__dirname, '../fixtures/e2e-products-minimal.csv'),
};

/**
 * The config for {@link entityIdMigrationSuite}. `testConfig()`, `createTestEnvironment()` and
 * `server.init()` must be called from the spec file itself, whose path determines the port and the
 * cached test database.
 */
export function entityIdMigrationConfig(
    baseConfig: Required<VendureConfig>,
    options: EntityIdMigrationSuiteOptions,
): Required<VendureConfig> {
    return mergeConfig(baseConfig, {
        entityOptions: { entityIdStrategy: options.entityIdStrategy },
        dbConnectionOptions: { entityPrefix: options.entityPrefix ?? '' } as any,
        plugins: [
            DefaultSearchPlugin.init({ bufferUpdates: false }),
            DefaultJobQueuePlugin,
            EntityIdTestPlugin,
        ],
    });
}

/**
 * #2318: tests the v4.0 entity id migration as the upgrade guide describes it, on a database rolled
 * back to the pre-v4 schema of the columns it touches and holding rows which refer to deleted rows:
 * generate the migration, delete the statements the guide names, call the helper, then run the
 * remaining statements. Run with both id strategies.
 *
 * The "generated" schema migration is produced the same way `generateMigration()` does it
 * (`createSchemaBuilder().log()`), so this works on every driver the e2e suite runs on.
 */
export function entityIdMigrationSuite(
    { server, adminClient, shopClient }: ReturnType<typeof createTestEnvironment>,
    options: EntityIdMigrationSuiteOptions,
) {
    const prefix = options.entityPrefix ?? '';
    const isUuid = options.entityIdStrategy.primaryKeyType === 'uuid';
    const table = (name: string) => prefix + name;
    /** The columns whose type the helper converts, where the database has a native uuid type. */
    const columnsToConvert = [
        { table: 'entity_id_test_item', column: 'productVariantId', nullable: false },
        { table: 'entity_id_test_item', column: 'otherVariantId', nullable: true },
        { table: 'order', column: 'taxZoneId', nullable: true },
        { table: 'product_variant_price', column: 'channelId', nullable: true },
    ];
    let rawConnection: DataSource;
    let queryRunner: QueryRunner;
    let esc: (name: string) => string;
    let typesChange: boolean;
    let generated: Query[];
    let validOrderId: string | number;
    let validTaxZoneId: string | number;
    let orphanedOrderId: string | number;
    let orphanedPriceId: string | number;
    let priceCount: number;
    let searchIndexCount: number;
    let testItems: EntityIdTestItem[];

    const count = async (name: string, where = '1 = 1') =>
        Number(
            (
                await queryRunner.query(
                    `SELECT COUNT(*) AS ${esc('c')} FROM ${esc(table(name))} WHERE ${where}`,
                )
            )[0].c,
        );
    const orderTaxZoneId = async (id: string | number) =>
        (
            await queryRunner.query(
                `SELECT ${esc('taxZoneId')} AS ${esc('z')} FROM ${esc(table('order'))} WHERE ${esc('id')} = '${id}'`,
            )
        )[0].z;
    const loadTestItems = async () =>
        (await rawConnection.getRepository(EntityIdTestItem).find())
            .map(i => ({ ...i, productVariantId: String(i.productVariantId) }))
            .sort((a, b) => a.productVariantId.localeCompare(b.productVariantId));

    /**
     * The statements the upgrade guide says to delete from the generated migration: those which drop
     * and re-add a converted column, and the primary key changes around one which is part of the key.
     */
    function isDeletedByGuide(query: string): boolean {
        if (!typesChange) {
            return false;
        }
        return columnsToConvert.some(({ table: t, column }) => {
            if (!query.startsWith(`ALTER TABLE ${esc(table(t))} `)) {
                return false;
            }
            const rest = query.slice(`ALTER TABLE ${esc(table(t))} `.length);
            return (
                rest.startsWith(`DROP COLUMN ${esc(column)}`) ||
                rest.startsWith(`ADD ${esc(column)} `) ||
                /^DROP CONSTRAINT "PK_|^DROP PRIMARY KEY|PRIMARY KEY \(/.test(rest)
            );
        });
    }

    /**
     * SQLite changes a table's foreign keys by re-creating the table, which fails while other
     * tables' foreign keys to it are enforced. TypeORM turns them off for schema sync in the same way.
     */
    async function withSqliteForeignKeysOff(work: () => Promise<void>) {
        const isSqlite = ['sqlite', 'sqljs', 'better-sqlite3'].includes(rawConnection.options.type);
        if (isSqlite) {
            await queryRunner.query('PRAGMA foreign_keys = OFF');
        }
        try {
            await work();
        } finally {
            if (isSqlite) {
                await queryRunner.query('PRAGMA foreign_keys = ON');
            }
        }
    }

    /** Drops the v4 foreign key on the column, and its index, as the v3 schema had neither. */
    async function dropForeignKeyAndIndex(tableName: string, column: string) {
        const t = await queryRunner.getTable(table(tableName));
        const fk = t?.foreignKeys.find(f => f.columnNames.length === 1 && f.columnNames[0] === column);
        if (fk) {
            await queryRunner.dropForeignKey(table(tableName), fk);
        }
        const t2 = await queryRunner.getTable(table(tableName));
        const indices =
            t2?.indices.filter(i => i.columnNames.length === 1 && i.columnNames[0] === column) ?? [];
        for (const index of indices) {
            await queryRunner.dropIndex(table(tableName), index);
        }
    }

    /** Gives the column the type v3 gave it under the UUID strategy, where that differs. */
    async function revertToVarchar(tableName: string, column: string, nullable: boolean) {
        if (rawConnection.options.type === 'postgres') {
            await queryRunner.query(
                `ALTER TABLE ${esc(table(tableName))} ALTER COLUMN ${esc(column)} TYPE character varying`,
            );
        } else {
            await queryRunner.query(
                `ALTER TABLE ${esc(table(tableName))} MODIFY ${esc(column)} varchar(255) ${nullable ? 'NULL' : 'NOT NULL'}`,
            );
        }
    }

    describe(`v4.0 entity id migration (${options.entityIdStrategy.primaryKeyType} ids)`, () => {
        beforeAll(async () => {
            await adminClient.asSuperAdmin();
            await adminClient.query(reindexDocument);
            await awaitRunningJobs(adminClient);
            rawConnection = server.app.get(TransactionalConnection).rawConnection;
            queryRunner = rawConnection.createQueryRunner();
            esc = (name: string) => rawConnection.driver.escape(name);
            typesChange = isUuid && rawConnection.driver.normalizeType({ type: 'uuid' }) === 'uuid';

            // Two active Orders, whose taxZoneId the OrderCalculator sets.
            const variantIds: Array<{ id: string }> = await queryRunner.query(
                `SELECT ${esc('id')} AS ${esc('id')} FROM ${esc(table('product_variant'))} ORDER BY ${esc('id')}`,
            );
            const orderIds: Array<string | number> = [];
            for (const variant of variantIds.slice(0, 2)) {
                await shopClient.asAnonymousUser();
                const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
                    productVariantId: String(variant.id),
                    quantity: 1,
                });
                orderIds.push((addItemToOrder as any).id);
            }
            [validOrderId, orphanedOrderId] = orderIds;
            validTaxZoneId = await orderTaxZoneId(validOrderId);
            const prices: Array<{ id: string | number }> = await queryRunner.query(
                `SELECT ${esc('id')} AS ${esc('id')} FROM ${esc(table('product_variant_price'))}`,
            );
            orphanedPriceId = prices[0].id;
            priceCount = prices.length;
            searchIndexCount = await count('search_index_item');
            // Two rows with the same `code`: dropping `productVariantId` from the primary key without
            // dropping the column would make them duplicates.
            const [v1, v2] = variantIds;
            await rawConnection.getRepository(EntityIdTestItem).save([
                { productVariantId: v1.id, code: 'a', otherVariantId: v2.id },
                { productVariantId: v2.id, code: 'a', otherVariantId: null },
            ]);
            testItems = await loadTestItems();

            // Roll the schema back to v3.x for the columns this change touches.
            await withSqliteForeignKeysOff(async () => {
                await dropForeignKeyAndIndex('order', 'taxZoneId');
                await dropForeignKeyAndIndex('product_variant_price', 'channelId');
            });
            if (typesChange) {
                for (const { table: t, column, nullable } of columnsToConvert) {
                    await revertToVarchar(t, column, nullable);
                }
            }

            // Rows referring to deleted rows, which v3 allowed.
            await queryRunner.query(
                `UPDATE ${esc(table('order'))} SET ${esc('taxZoneId')} = '${options.missingId}' WHERE ${esc('id')} = '${orphanedOrderId}'`,
            );
            await queryRunner.query(
                `UPDATE ${esc(table('product_variant_price'))} SET ${esc('channelId')} = '${options.missingId}' WHERE ${esc('id')} = '${orphanedPriceId}'`,
            );
        }, TEST_SETUP_TIMEOUT_MS);

        afterAll(async () => {
            await queryRunner?.release();
            await server.destroy();
        });

        // #2318 — the migration generated against the rolled-back database adds the foreign keys
        it('the migration generated against the v3 schema adds the foreign keys', async () => {
            generated = (await rawConnection.driver.createSchemaBuilder().log()).upQueries;
            const sql = generated.map(q => q.query).join('\n');
            const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const foreignKey = (column: string, references: string) =>
                new RegExp(
                    `FOREIGN KEY \\(${escapeRegExp(esc(column))}\\) REFERENCES ${escapeRegExp(esc(table(references)))}`,
                );
            expect(sql).toMatch(foreignKey('taxZoneId', 'zone'));
            expect(sql).toMatch(foreignKey('channelId', 'channel'));
            // The search index keeps varchar ids, so it is not part of the migration
            expect(sql).not.toContain('search_index_item');
            if (isUuid && rawConnection.options.type === 'postgres') {
                expect(typesChange).toBe(true);
            }
            if (typesChange) {
                // What the guide says to delete: these statements would delete the columns' data
                // A drop and an add per column, and for the column in the composite primary key also
                // the key changes around it: dropped, re-created without it, then dropped and
                // re-created with it.
                expect(generated.filter(q => isDeletedByGuide(q.query)).map(q => q.query)).toHaveLength(
                    columnsToConvert.length * 2 + 4,
                );
            }
        });

        // #2318 — synchronize would fail on the new foreign keys, or delete the data of the converted columns
        it('assertEntityIdColumnsMigrated() throws until the migration has run', async () => {
            await expect(assertEntityIdColumnsMigrated(queryRunner)).rejects.toThrow(
                typesChange ? /must be converted to uuid/ : /refer to a deleted zone/,
            );
        });

        // #2318 — the helper converts the column types and removes references to deleted rows
        it('prepareEntityIdForeignKeys() converts the columns and removes references to deleted rows', async () => {
            const result = await prepareEntityIdForeignKeys(queryRunner);
            expect(result.clearedOrderTaxZones).toBe(1);
            expect(result.deletedProductVariantPrices).toBe(1);
            expect(result.convertedColumns.sort()).toEqual(
                typesChange ? columnsToConvert.map(c => `${table(c.table)}.${c.column}`).sort() : [],
            );

            expect(await orderTaxZoneId(orphanedOrderId)).toBeNull();
            expect(String(await orderTaxZoneId(validOrderId))).toBe(String(validTaxZoneId));
            expect(await count('product_variant_price')).toBe(priceCount - 1);
            expect(await count('product_variant_price', `${esc('channelId')} IS NULL`)).toBe(0);
            expect(await loadTestItems()).toEqual(testItems);
            await expect(assertEntityIdColumnsMigrated(queryRunner)).resolves.toBeUndefined();
        });

        // #2318 — the rest of the generated migration applies, keeps the data and leaves no further diff
        it('the rest of the generated migration applies and leaves no further diff', async () => {
            await withSqliteForeignKeysOff(async () => {
                for (const q of generated.filter(g => !isDeletedByGuide(g.query))) {
                    await queryRunner.query(q.query, q.parameters);
                }
            });
            const after = await rawConnection.driver.createSchemaBuilder().log();
            expect(after.upQueries.map(q => q.query)).toEqual([]);
            expect(await count('product_variant_price')).toBe(priceCount - 1);
            expect(await count('search_index_item')).toBe(searchIndexCount);
            expect(await loadTestItems()).toEqual(testItems);
        });

        // #2318 — order.taxZoneId is set to NULL when its Zone is deleted
        it('sets order.taxZoneId to NULL when the Zone is deleted', async () => {
            const zone = await rawConnection.getRepository('Zone').save({ name: 'Temporary zone' });
            await rawConnection.getRepository('Order').update(validOrderId, { taxZoneId: zone.id });
            await rawConnection.getRepository('Zone').delete(zone.id);
            expect(await orderTaxZoneId(validOrderId)).toBeNull();
        });

        // #2318 — the new foreign key rejects a price of a Channel which does not exist
        it('rejects a price of a Channel which does not exist', async () => {
            await expect(
                queryRunner.query(
                    `UPDATE ${esc(table('product_variant_price'))} SET ${esc('channelId')} = '${options.missingId}'`,
                ),
            ).rejects.toThrow(/foreign key constraint/i);
        });

        // #2318 — the helper can be run again
        it('is a no-op when run again', async () => {
            await expect(prepareEntityIdForeignKeys(queryRunner)).resolves.toEqual({
                convertedColumns: [],
                clearedOrderTaxZones: 0,
                deletedProductVariantPrices: 0,
            });
        });
    });
}
