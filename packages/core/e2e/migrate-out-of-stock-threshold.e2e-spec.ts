/**
 * OSS-1299: tests the v4.0 out-of-stock threshold migration helper on a database rolled back to
 * the pre-v4 schema, with pre-v4 data: GlobalSettings.outOfStockThreshold = -3 (backorders
 * allowed), and Channels whose (previously unused) outOfStockThreshold differs.
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
    assertOutOfStockThresholdMigrated,
    migrateOutOfStockThresholdToChannels,
} from '../src/migration-utils/v4_0_out_of_stock_threshold';

describe('v4.0 outOfStockThreshold migration helper', () => {
    // Runs with a table prefix, so the helper must honour `entityPrefix`.
    const PREFIX = 'vdr_';
    const { server } = createTestEnvironment(
        mergeConfig(testConfig(), { dbConnectionOptions: { entityPrefix: PREFIX } as any }),
    );
    const table = (name: string) => PREFIX + name;
    let rawConnection: DataSource;
    let queryRunner: QueryRunner;
    let esc: (name: string) => string;

    const channelThresholds = async () => {
        const rows: Array<{ code: string; value: unknown }> = await queryRunner.query(
            `SELECT ${esc('code')} AS ${esc('code')}, ${esc('outOfStockThreshold')} AS ${esc('value')} FROM ${esc(table('channel'))}`,
        );
        return Object.fromEntries(rows.map(r => [r.code, Number(r.value)]));
    };

    beforeAll(async () => {
        await server.init({
            initialData,
            customerCount: 1,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
        });
        rawConnection = server.app.get(TransactionalConnection).rawConnection;
        queryRunner = rawConnection.createQueryRunner();
        esc = (name: string) => rawConnection.driver.escape(name);

        // Roll the column back to v3.x: NOT NULL, default 0. v4 keeps it (nullable) until its
        // value has been copied.
        await queryRunner.dropColumn(table('global_settings'), 'outOfStockThreshold');
        await queryRunner.addColumn(
            table('global_settings'),
            new TableColumn({ name: 'outOfStockThreshold', type: 'integer', default: 0 }),
        );

        // Pre-v4 data: backorders of up to 3 units. Channel.outOfStockThreshold was ignored, so
        // its values are whatever was stored: the default (0) or a value set via the API.
        await queryRunner.query(
            `UPDATE ${esc(table('global_settings'))} SET ${esc('outOfStockThreshold')} = -3`,
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
             ('vendor-a', 'vendor-a-token', 'en', 'USD', FALSE, TRUE, 5),
             ('vendor-b', 'vendor-b-token', 'en', 'EUR', FALSE, TRUE, -3)`,
        );
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await queryRunner?.release();
        await server.destroy();
    });

    // OSS-1299 — the rolled-back database differs from the v4 entities
    it('the rolled-back database differs from the v4 entities', async () => {
        const log = await rawConnection.driver.createSchemaBuilder().log();
        const sql = log.upQueries.map(q => q.query).join('\n');
        expect(sql).toContain('outOfStockThreshold');
    });

    // OSS-1299 — the helper needs the v4 schema, so calling it before the generated statements fails loudly
    it('refuses to copy before the generated statements have run', async () => {
        await expect(migrateOutOfStockThresholdToChannels(queryRunner)).rejects.toThrow('still NOT NULL');
    });

    // OSS-1299 — then the generated schema migration applies, keeps the value and leaves no further diff
    it('then the generated schema migration applies and keeps the v3 value', async () => {
        const log = await rawConnection.driver.createSchemaBuilder().log();
        for (const q of log.upQueries) {
            await queryRunner.query(q.query, q.parameters);
        }
        const after = await rawConnection.driver.createSchemaBuilder().log();
        expect(after.upQueries.map(q => q.query)).toEqual([]);
        // The column is kept, nullable, so the value survives until it has been copied.
        const legacy: Array<{ v: unknown }> = await queryRunner.query(
            `SELECT ${esc('outOfStockThreshold')} AS ${esc('v')} FROM ${esc(table('global_settings'))}`,
        );
        expect(Number(legacy[0].v)).toBe(-3);
    });

    // OSS-1299 — Vendure refuses to start while the v3 value has not been migrated
    it('assertOutOfStockThresholdMigrated() throws while the v3 value is pending', async () => {
        await expect(assertOutOfStockThresholdMigrated(queryRunner)).rejects.toThrow(
            'out-of-stock threshold data migration has not run',
        );
    });

    // OSS-1299 — copies GlobalSettings.outOfStockThreshold to every Channel and reports overwritten ones
    it('copies GlobalSettings.outOfStockThreshold to every Channel and reports overwritten ones', async () => {
        const result = await migrateOutOfStockThresholdToChannels(queryRunner);
        expect(result.globalOutOfStockThreshold).toBe(-3);
        expect(result.overwrittenChannels.sort((a, b) => a.code.localeCompare(b.code))).toEqual([
            { code: '__default_channel__', previous: 0 },
            { code: 'vendor-a', previous: 5 },
        ]);
        expect(await channelThresholds()).toEqual({
            __default_channel__: -3,
            'vendor-a': -3,
            'vendor-b': -3,
        });
        const legacy: Array<{ v: unknown }> = await queryRunner.query(
            `SELECT ${esc('outOfStockThreshold')} AS ${esc('v')} FROM ${esc(table('global_settings'))}`,
        );
        expect(legacy[0].v).toBeNull();
        await expect(assertOutOfStockThresholdMigrated(queryRunner)).resolves.toBeUndefined();
    });

    // OSS-1299 — a wrong table prefix must fail loudly rather than skip the copy
    it('throws rather than no-op when the global_settings table cannot be found', async () => {
        const options = rawConnection.options as any;
        options.entityPrefix = 'wrong_';
        try {
            await expect(migrateOutOfStockThresholdToChannels(queryRunner)).rejects.toThrow(
                'wrong_global_settings',
            );
        } finally {
            options.entityPrefix = PREFIX;
        }
    });

    // OSS-1299 — is a no-op when run again, so a Channel set after the upgrade is left alone
    it('is a no-op when run again', async () => {
        await queryRunner.query(
            `UPDATE ${esc(table('channel'))} SET ${esc('outOfStockThreshold')} = 2 WHERE ${esc('code')} = 'vendor-b'`,
        );
        const result = await migrateOutOfStockThresholdToChannels(queryRunner);
        expect(result.globalOutOfStockThreshold).toBeUndefined();
        expect(result.overwrittenChannels).toEqual([]);
        expect((await channelThresholds())['vendor-b']).toBe(2);
    });
});
