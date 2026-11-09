/**
 * Spike OSS-1002 (#2908): tests the v4.0 trackInventory migration on a database rolled back to
 * the pre-v4 schema, with pre-v4 data: GlobalSettings.trackInventory = false, Channels whose
 * (previously unused) trackInventory differs, and existing StockLevels and StockMovements.
 *
 * The "generated" schema migration is produced the same way `generateMigration()` does it
 * (`createSchemaBuilder().log()`), so this works on every driver the e2e suite runs on.
 */
import { TransactionalConnection } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { DataSource, QueryRunner, TableColumn } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { migrateTrackInventoryToChannels } from '../src/migration-utils/v4_0_track_inventory';

describe('migrateTrackInventoryToChannels() (OSS-1002)', () => {
    const { server } = createTestEnvironment(testConfig());
    let rawConnection: DataSource;
    let queryRunner: QueryRunner;
    let esc: (name: string) => string;
    let stockLevelCount: number;
    let stockMovementCount: number;

    const asBool = (v: unknown) => v === true || v === 1 || v === '1';

    beforeAll(async () => {
        await server.init({
            initialData,
            customerCount: 1,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-stock-control-multi.csv'),
        });
        rawConnection = server.app.get(TransactionalConnection).rawConnection;
        queryRunner = rawConnection.createQueryRunner();
        esc = (name: string) => rawConnection.driver.escape(name);

        // Roll the schema back to v3.x for the three columns this change touches.
        await queryRunner.addColumn(
            'global_settings',
            new TableColumn({ name: 'trackInventory', type: 'boolean', default: true }),
        );
        await queryRunner.dropColumn('stock_level', 'trackInventory');
        await queryRunner.dropColumn('stock_movement', 'tracked');

        // Pre-v4 data: inventory not tracked by default. Channel.trackInventory was ignored, so
        // its values are whatever was stored: the default (true) or a value set via the API.
        await queryRunner.query(`UPDATE ${esc('global_settings')} SET ${esc('trackInventory')} = FALSE`);
        const cols = [
            'code',
            'token',
            'defaultLanguageCode',
            'defaultCurrencyCode',
            'pricesIncludeTax',
            'trackInventory',
            'outOfStockThreshold',
        ]
            .map(esc)
            .join(', ');
        await queryRunner.query(
            `INSERT INTO ${esc('channel')} (${cols}) VALUES
             ('vendor-a', 'vendor-a-token', 'en', 'USD', FALSE, TRUE, 0),
             ('vendor-b', 'vendor-b-token', 'en', 'EUR', FALSE, FALSE, 0)`,
        );

        stockLevelCount = Number(
            (await queryRunner.query(`SELECT COUNT(*) AS ${esc('c')} FROM ${esc('stock_level')}`))[0].c,
        );
        stockMovementCount = Number(
            (await queryRunner.query(`SELECT COUNT(*) AS ${esc('c')} FROM ${esc('stock_movement')}`))[0].c,
        );
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await queryRunner?.release();
        await server.destroy();
    });

    it('the rolled-back database differs from the v4 entities', async () => {
        const log = await rawConnection.driver.createSchemaBuilder().log();
        const sql = log.upQueries.map(q => q.query).join('\n');
        expect(sql).toContain('trackInventory');
        expect(sql).toContain('tracked');
        expect(stockLevelCount).toBeGreaterThan(0);
        expect(stockMovementCount).toBeGreaterThan(0);
    });

    it('copies GlobalSettings.trackInventory to every Channel and reports overwritten ones', async () => {
        const result = await migrateTrackInventoryToChannels(queryRunner);
        expect(result.globalTrackInventory).toBe(false);
        expect(result.overwrittenChannels.map(c => c.code).sort()).toEqual([
            '__default_channel__',
            'vendor-a',
        ]);
        const channels: Array<{ code: string; value: unknown }> = await queryRunner.query(
            `SELECT ${esc('code')} AS ${esc('code')}, ${esc('trackInventory')} AS ${esc('value')} FROM ${esc('channel')}`,
        );
        expect(channels.length).toBe(3);
        expect(channels.every(c => asBool(c.value) === false)).toBe(true);
    });

    it('then the generated schema migration applies and leaves no further diff', async () => {
        const log = await rawConnection.driver.createSchemaBuilder().log();
        for (const q of log.upQueries) {
            await queryRunner.query(q.query, q.parameters);
        }
        const after = await rawConnection.driver.createSchemaBuilder().log();
        expect(after.upQueries.map(q => q.query)).toEqual([]);
        expect(await queryRunner.hasColumn('global_settings', 'trackInventory')).toBe(false);
    });

    it('keeps every StockLevel and StockMovement, defaulting the new columns', async () => {
        const levels: Array<{ v: string }> = await queryRunner.query(
            `SELECT ${esc('trackInventory')} AS ${esc('v')} FROM ${esc('stock_level')}`,
        );
        expect(levels.length).toBe(stockLevelCount);
        expect(levels.every(l => l.v === 'INHERIT')).toBe(true);

        const movements: Array<{ v: unknown }> = await queryRunner.query(
            `SELECT ${esc('tracked')} AS ${esc('v')} FROM ${esc('stock_movement')}`,
        );
        expect(movements.length).toBe(stockMovementCount);
        expect(movements.every(m => m.v === null)).toBe(true);
    });

    it('is a no-op when run again', async () => {
        const result = await migrateTrackInventoryToChannels(queryRunner);
        expect(result.globalTrackInventory).toBeUndefined();
    });
});
