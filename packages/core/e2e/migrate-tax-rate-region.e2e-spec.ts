/* eslint-disable @typescript-eslint/no-non-null-assertion */
/**
 * Tests the v4.0 schema change for country tax rates on a database rolled back to the v3 schema:
 * `tax_rate` without the `regionId` column, and `order` and `channel` without `taxCountryCode`. `zoneId` was
 * already nullable in v3, so the generated migration only adds the columns, an index and a foreign
 * key, and existing zone rates are unchanged.
 *
 * The "generated" schema migration is produced the same way `generateMigration()` does it
 * (`createSchemaBuilder().log()`), so this works on every driver the e2e suite runs on.
 */
import { TransactionalConnection } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { DataSource, QueryRunner } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import {
    getProductsWithVariantPricesDocument,
    getTaxRatesListDocument,
    updateTaxRateDocument,
} from './graphql/shared-definitions';
import { addItemToOrderDocument, getActiveOrderWithPriceDataDocument } from './graphql/shop-definitions';

describe('v4.0 TaxRate region migration', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(testConfig());
    let rawConnection: DataSource;
    let queryRunner: QueryRunner;
    let esc: (name: string) => string;
    let ratesBefore: TaxRateRow[];

    type TaxRateRow = { id: string; zoneId: string | null; value: number; enabled: boolean };

    /**
     * SQLite rebuilds a table to change a column, which would cascade-delete the rows that refer to
     * it, such as the sessions and role assignments of a Channel. Migrations run with the foreign
     * keys off on SQLite, so this does the same.
     */
    const withoutSqliteForeignKeys = async (work: () => Promise<void>) => {
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
    };

    const taxRateRows = async (): Promise<TaxRateRow[]> => {
        const rows: any[] = await queryRunner.query(
            `SELECT ${['id', 'zoneId', 'value', 'enabled'].map(esc).join(', ')} FROM ${esc('tax_rate')} ORDER BY ${esc('id')}`,
        );
        return rows.map(r => ({
            id: String(r.id),
            zoneId: r.zoneId == null ? null : String(r.zoneId),
            value: Number(r.value),
            enabled: Boolean(r.enabled),
        }));
    };

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
        rawConnection = server.app.get(TransactionalConnection).rawConnection;
        queryRunner = rawConnection.createQueryRunner();
        esc = (name: string) => rawConnection.driver.escape(name);
        ratesBefore = await taxRateRows();

        // Roll tax_rate back to v3: no regionId column.
        const table = (await queryRunner.getTable('tax_rate'))!;
        for (const fk of table.foreignKeys.filter(f => f.columnNames.includes('regionId'))) {
            await queryRunner.dropForeignKey(table, fk);
        }
        for (const index of table.indices.filter(i => i.columnNames.includes('regionId'))) {
            await queryRunner.dropIndex(table, index);
        }
        await queryRunner.dropColumn(table, 'regionId');
        // ...and order and channel without taxCountryCode.
        await withoutSqliteForeignKeys(async () => {
            await queryRunner.dropColumn('order', 'taxCountryCode');
            await queryRunner.dropColumn('channel', 'taxCountryCode');
        });
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await queryRunner?.release();
        await server.destroy();
    });

    it('the rolled-back database differs from the v4 entities', async () => {
        const log = await rawConnection.driver.createSchemaBuilder().log();
        const sql = log.upQueries.map(q => q.query).join('\n');
        expect(sql).toContain('regionId');
        const taxCountryCodeQueries = log.upQueries
            .map(q => q.query)
            .filter(q => q.includes('taxCountryCode'));
        expect(taxCountryCodeQueries.some(q => q.includes('order'))).toBe(true);
        expect(taxCountryCodeQueries.some(q => q.includes('channel'))).toBe(true);
    });

    it('the generated schema migration applies and leaves no further diff', async () => {
        const log = await rawConnection.driver.createSchemaBuilder().log();
        await withoutSqliteForeignKeys(async () => {
            for (const q of log.upQueries) {
                await queryRunner.query(q.query, q.parameters);
            }
        });
        const after = await rawConnection.driver.createSchemaBuilder().log();
        expect(after.upQueries.map(q => q.query)).toEqual([]);
    });

    it('existing zone rates keep their zone and have no region', async () => {
        expect(ratesBefore.length).toBeGreaterThan(0);
        expect(ratesBefore.every(r => r.zoneId != null)).toBe(true);
        expect(await taxRateRows()).toEqual(ratesBefore);
        const regionIds: any[] = await queryRunner.query(
            `SELECT ${esc('regionId')} FROM ${esc('tax_rate')} WHERE ${esc('regionId')} IS NOT NULL`,
        );
        expect(regionIds).toEqual([]);
    });

    it('existing channels have no tax country', async () => {
        const rows: any[] = await queryRunner.query(`SELECT ${esc('taxCountryCode')} FROM ${esc('channel')}`);
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every(r => r.taxCountryCode == null)).toBe(true);
    });

    it('an existing zone rate still resolves for an order', async () => {
        const { taxRates } = await adminClient.query(getTaxRatesListDocument);
        const standardEurope = taxRates.items.find(r => r.name === 'Standard Tax Europe')!;
        expect(standardEurope.zone?.name).toBe('Europe');
        expect(standardEurope.region).toBeNull();
        // Saving a rate reloads the tax rate cache from the migrated table.
        await adminClient.query(updateTaxRateDocument, { input: { id: standardEurope.id, enabled: true } });

        const { products } = await adminClient.query(getProductsWithVariantPricesDocument);
        await shopClient.asAnonymousUser();
        await shopClient.query(addItemToOrderDocument, {
            productVariantId: products.items[0].variants[0].id,
            quantity: 1,
        });
        const { activeOrder } = await shopClient.query(getActiveOrderWithPriceDataDocument);
        expect(activeOrder!.lines[0].taxRate).toBe(standardEurope.value);
    });
});
