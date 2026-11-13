/**
 * #2908: tests the v4.0 trackInventory migration helpers on a database rolled back to
 * the pre-v4 schema, with pre-v4 data: GlobalSettings.trackInventory = false, Channels whose
 * (previously unused) trackInventory differs, and existing StockLevels and StockMovements.
 *
 * The "generated" schema migration is produced the same way `generateMigration()` does it
 * (`createSchemaBuilder().log()`), so this works on every driver the e2e suite runs on.
 */
import { mergeConfig, TransactionalConnection } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { DataSource, QueryRunner, TableColumn } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import {
    backfillStockMovementTracking,
    migrateTrackInventoryToChannels,
} from '../src/migration-utils/v4_0_track_inventory';

describe('v4.0 trackInventory migration helpers', () => {
    // Runs with a table prefix, so the helpers must honour `entityPrefix`.
    const PREFIX = 'vdr_';
    const { server } = createTestEnvironment(
        mergeConfig(testConfig(), { dbConnectionOptions: { entityPrefix: PREFIX } as any }),
    );
    const table = (name: string) => PREFIX + name;
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
            table('global_settings'),
            new TableColumn({ name: 'trackInventory', type: 'boolean', default: true }),
        );
        await queryRunner.dropColumn(table('stock_level'), 'trackInventory');
        await queryRunner.dropColumn(table('stock_movement'), 'tracked');

        // Pre-v4 data: inventory not tracked by default. Channel.trackInventory was ignored, so
        // its values are whatever was stored: the default (true) or a value set via the API.
        await queryRunner.query(
            `UPDATE ${esc(table('global_settings'))} SET ${esc('trackInventory')} = FALSE`,
        );
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
            `INSERT INTO ${esc(table('channel'))} (${cols}) VALUES
             ('vendor-a', 'vendor-a-token', 'en', 'USD', FALSE, TRUE, 0),
             ('vendor-b', 'vendor-b-token', 'en', 'EUR', FALSE, FALSE, 0)`,
        );

        // Pre-v4 stock movements of an open Order: variants 1, 2 and 3 track inventory
        // TRUE, FALSE and INHERIT (with the global setting off).
        for (const [id, flag] of [
            [1, 'TRUE'],
            [2, 'FALSE'],
            [3, 'INHERIT'],
        ] as const) {
            await queryRunner.query(
                `UPDATE ${esc(table('product_variant'))} SET ${esc('trackInventory')} = '${flag}' WHERE ${esc('id')} = ${id}`,
            );
        }
        const movementCols = ['type', 'discriminator', 'quantity', 'productVariantId', 'stockLocationId']
            .map(esc)
            .join(', ');
        await queryRunner.query(
            `INSERT INTO ${esc(table('stock_movement'))} (${movementCols}) VALUES
             ('ALLOCATION', 'Allocation', 1, 1, 1),
             ('ALLOCATION', 'Allocation', 1, 2, 1),
             ('ALLOCATION', 'Allocation', 1, 3, 1),
             ('SALE', 'Sale', -1, 1, 1)`,
        );

        stockLevelCount = Number(
            (await queryRunner.query(`SELECT COUNT(*) AS ${esc('c')} FROM ${esc(table('stock_level'))}`))[0]
                .c,
        );
        stockMovementCount = Number(
            (
                await queryRunner.query(`SELECT COUNT(*) AS ${esc('c')} FROM ${esc(table('stock_movement'))}`)
            )[0].c,
        );
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await queryRunner?.release();
        await server.destroy();
    });

    // #2908 — the rolled-back database differs from the v4 entities
    it('the rolled-back database differs from the v4 entities', async () => {
        const log = await rawConnection.driver.createSchemaBuilder().log();
        const sql = log.upQueries.map(q => q.query).join('\n');
        expect(sql).toContain('trackInventory');
        expect(sql).toContain('tracked');
        expect(stockLevelCount).toBeGreaterThan(0);
        expect(stockMovementCount).toBeGreaterThan(0);
    });

    // #2908 — copies GlobalSettings.trackInventory to every Channel and reports overwritten ones
    it('copies GlobalSettings.trackInventory to every Channel and reports overwritten ones', async () => {
        const result = await migrateTrackInventoryToChannels(queryRunner);
        expect(result.globalTrackInventory).toBe(false);
        expect(result.overwrittenChannels.map(c => c.code).sort()).toEqual([
            '__default_channel__',
            'vendor-a',
        ]);
        const channels: Array<{ code: string; value: unknown }> = await queryRunner.query(
            `SELECT ${esc('code')} AS ${esc('code')}, ${esc('trackInventory')} AS ${esc('value')} FROM ${esc(table('channel'))}`,
        );
        expect(channels.length).toBe(3);
        expect(channels.every(c => asBool(c.value) === false)).toBe(true);
    });

    // #2908 — then the generated schema migration applies and leaves no further diff
    it('then the generated schema migration applies and leaves no further diff', async () => {
        const log = await rawConnection.driver.createSchemaBuilder().log();
        for (const q of log.upQueries) {
            await queryRunner.query(q.query, q.parameters);
        }
        const after = await rawConnection.driver.createSchemaBuilder().log();
        expect(after.upQueries.map(q => q.query)).toEqual([]);
        expect(await queryRunner.hasColumn(table('global_settings'), 'trackInventory')).toBe(false);
    });

    // #2908 — keeps every StockLevel and StockMovement, defaulting the new columns
    it('keeps every StockLevel and StockMovement, defaulting the new columns', async () => {
        const levels: Array<{ v: string }> = await queryRunner.query(
            `SELECT ${esc('trackInventory')} AS ${esc('v')} FROM ${esc(table('stock_level'))}`,
        );
        expect(levels.length).toBe(stockLevelCount);
        expect(levels.every(l => l.v === 'INHERIT')).toBe(true);

        const movements: Array<{ v: unknown }> = await queryRunner.query(
            `SELECT ${esc('tracked')} AS ${esc('v')} FROM ${esc(table('stock_movement'))}`,
        );
        expect(movements.length).toBe(stockMovementCount);
        expect(movements.every(m => m.v === null)).toBe(true);
    });

    // #2908 — movements recorded before v4.0 get the tracked state of the pre-v4 rule
    // (variant flag, else the former global setting), so open Orders keep their behaviour.
    it('backfills stock_movement.tracked with the pre-v4 rule', async () => {
        const filled = await backfillStockMovementTracking(queryRunner);
        expect(filled).toBe(stockMovementCount);
        const rows: Array<{ type: string; variant: unknown; tracked: unknown }> = await queryRunner.query(
            `SELECT ${esc('type')} AS ${esc('type')}, ${esc('productVariantId')} AS ${esc('variant')},
                    ${esc('tracked')} AS ${esc('tracked')} FROM ${esc(table('stock_movement'))}`,
        );
        const trackedOf = (type: string, variant: number) =>
            asBool(rows.find(r => r.type === type && Number(r.variant) === variant)?.tracked);
        expect(trackedOf('ALLOCATION', 1)).toBe(true);
        expect(trackedOf('ALLOCATION', 2)).toBe(false);
        expect(trackedOf('ALLOCATION', 3)).toBe(false);
        expect(trackedOf('SALE', 1)).toBe(true);
        expect(rows.filter(r => r.type === 'ADJUSTMENT').every(r => asBool(r.tracked))).toBe(true);
        expect(rows.every(r => r.tracked !== null)).toBe(true);
        // Only NULL rows are touched, so a second run does nothing.
        expect(await backfillStockMovementTracking(queryRunner)).toBe(0);
    });

    // #2908 — a wrong table prefix must fail loudly rather than skip the copy
    it('throws rather than no-op when the global_settings table cannot be found', async () => {
        const options = rawConnection.options as any;
        options.entityPrefix = 'wrong_';
        try {
            await expect(migrateTrackInventoryToChannels(queryRunner)).rejects.toThrow(
                'wrong_global_settings',
            );
        } finally {
            options.entityPrefix = PREFIX;
        }
    });

    // #2908 — is a no-op when run again
    it('is a no-op when run again', async () => {
        const result = await migrateTrackInventoryToChannels(queryRunner);
        expect(result.globalTrackInventory).toBeUndefined();
    });
});
