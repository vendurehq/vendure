import { TransactionalConnection } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { QueryRunner } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { migrateAssetTranslationData } from '../src/migration-utils/v3_6_asset_translations';

// TODO: Remove this test file (and the migration helper it tests) once v3.6 has been stable
// for a while. The migration is a one-time operation from the old `name` column on `asset`
// to the new `asset_translation` table. Once all users have upgraded past v3.6, nobody will
// ever run this migration again, and the test will only add maintenance overhead as the
// schema evolves.
describe('migrateAssetTranslationData()', () => {
    const { server } = createTestEnvironment(testConfig());
    let queryRunner: QueryRunner;
    let esc: (name: string) => string;

    // Snapshots of the original translation data, taken before any modifications
    let originalTranslations: Array<{
        id: number;
        languageCode: string;
        name: string;
        baseId: number;
    }>;
    let defaultLanguageCode: string;

    beforeAll(async () => {
        await server.init({
            initialData,
            customerCount: 1,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
        });
        const rawConnection = server.app.get(TransactionalConnection).rawConnection;
        queryRunner = rawConnection.createQueryRunner();
        esc = (name: string) => rawConnection.driver.escape(name);

        // Get the default language code from the default channel
        const channels: Array<{ defaultLanguageCode: string }> = await queryRunner.query(
            `SELECT ${esc('defaultLanguageCode')} FROM ${esc('channel')} WHERE ${esc('code')} = '__default_channel__'`,
        );
        defaultLanguageCode = channels[0].defaultLanguageCode;

        // Snapshot existing translations
        originalTranslations = await queryRunner.query(
            `SELECT ${esc('id')}, ${esc('languageCode')}, ${esc('name')}, ${esc('baseId')}
             FROM ${esc('asset_translation')}`,
        );
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        if (queryRunner?.isReleased === false) {
            await queryRunner.release();
        }
        await server.destroy();
    });

    /**
     * Simulates the pre-migration database state:
     * 1. Adds a `name` column back to `asset`
     * 2. Populates it from the existing translations
     * 3. Clears the `asset_translation` table
     */
    async function simulatePreMigrationState() {
        await queryRunner.query(`ALTER TABLE ${esc('asset')} ADD ${esc('name')} varchar(255) NULL`);
        for (const row of originalTranslations) {
            await queryRunner.query(
                `UPDATE ${esc('asset')}
                 SET ${esc('name')} = '${row.name.replace(/'/g, "''")}'
                 WHERE ${esc('id')} = ${row.baseId}`,
            );
        }
        await queryRunner.query(`DELETE FROM ${esc('asset_translation')}`);
    }

    /**
     * Restores the database to its original state after a test:
     * 1. Restores translation rows from the snapshot
     * 2. Drops the temporary `name` column from `asset`
     */
    async function restoreOriginalState() {
        await queryRunner.query(`DELETE FROM ${esc('asset_translation')}`);

        for (const row of originalTranslations) {
            await queryRunner.query(
                `INSERT INTO ${esc('asset_translation')} (${esc('id')}, ${esc('languageCode')}, ${esc('name')}, ${esc('baseId')})
                 VALUES (${row.id}, '${row.languageCode}', '${row.name.replace(/'/g, "''")}', ${row.baseId})`,
            );
        }

        const hasName = await queryRunner.hasColumn('asset', 'name');
        if (hasName) {
            await queryRunner.query(`ALTER TABLE ${esc('asset')} DROP COLUMN ${esc('name')}`);
        }
    }

    it('should skip if name column does not exist', async () => {
        const hasName = await queryRunner.hasColumn('asset', 'name');
        expect(hasName).toBe(false);
        // Should not throw
        await migrateAssetTranslationData(queryRunner);
    });

    // Reproduces https://github.com/vendurehq/vendure/issues/4647 (OSS-496):
    // on a fresh install with no asset data and no default channel yet,
    // the migration should be a no-op rather than throwing.
    it('should skip if there are no assets to migrate, even without a default channel', async () => {
        try {
            // Rename the default channel to simulate it not existing. If the
            // function still queried the channel table for __default_channel__,
            // it would throw.
            await queryRunner.query(
                `UPDATE ${esc('channel')} SET ${esc('code')} = '__tmp_renamed__' WHERE ${esc('code')} = '__default_channel__'`,
            );
            await queryRunner.query(`ALTER TABLE ${esc('asset')} ADD ${esc('name')} varchar(255) NULL`);

            const beforeRows: Array<{ c: string | number }> = await queryRunner.query(
                `SELECT COUNT(*) AS ${esc('c')} FROM ${esc('asset_translation')}`,
            );

            // All asset.name values are NULL — nothing to migrate. Should not throw.
            await migrateAssetTranslationData(queryRunner);

            // And no asset_translation rows should have been inserted.
            const afterRows: Array<{ c: string | number }> = await queryRunner.query(
                `SELECT COUNT(*) AS ${esc('c')} FROM ${esc('asset_translation')}`,
            );
            expect(Number(afterRows[0].c)).toBe(Number(beforeRows[0].c));
        } finally {
            if (await queryRunner.hasColumn('asset', 'name')) {
                await queryRunner.query(`ALTER TABLE ${esc('asset')} DROP COLUMN ${esc('name')}`);
            }
            await queryRunner.query(
                `UPDATE ${esc('channel')} SET ${esc('code')} = '__default_channel__' WHERE ${esc('code')} = '__tmp_renamed__'`,
            );
        }
    });

    it('should populate asset_translation from name column', async () => {
        try {
            await simulatePreMigrationState();

            // Verify preconditions
            expect(await queryRunner.hasColumn('asset', 'name')).toBe(true);
            const emptyTranslations = await queryRunner.query(`SELECT * FROM ${esc('asset_translation')}`);
            expect(emptyTranslations).toHaveLength(0);

            // Run the migration
            await migrateAssetTranslationData(queryRunner);

            // Verify: translation rows created for every asset
            const translations: Array<{ languageCode: string; name: string; baseId: number }> =
                await queryRunner.query(
                    `SELECT ${esc('languageCode')}, ${esc('name')}, ${esc('baseId')}
                     FROM ${esc('asset_translation')}`,
                );

            expect(translations.length).toBe(originalTranslations.length);

            for (const original of originalTranslations) {
                expect(translations).toContainEqual(
                    expect.objectContaining({
                        languageCode: defaultLanguageCode,
                        name: original.name,
                        baseId: original.baseId,
                    }),
                );
            }
        } finally {
            await restoreOriginalState();
        }
    });

    it('should be idempotent when called twice', async () => {
        try {
            await simulatePreMigrationState();
            await migrateAssetTranslationData(queryRunner);
            // Running a second time should not throw or produce duplicate rows
            await migrateAssetTranslationData(queryRunner);

            const translations = await queryRunner.query(
                `SELECT ${esc('baseId')} FROM ${esc('asset_translation')}`,
            );
            expect(translations.length).toBe(originalTranslations.length);
        } finally {
            await restoreOriginalState();
        }
    });

    it('should use the default channel language code, not other channels', async () => {
        try {
            // Create a second channel with a different language code
            const cols = [
                esc('code'),
                esc('token'),
                esc('defaultLanguageCode'),
                esc('defaultCurrencyCode'),
                esc('pricesIncludeTax'),
                esc('trackInventory'),
                esc('outOfStockThreshold'),
            ].join(', ');
            await queryRunner.query(
                `INSERT INTO ${esc('channel')} (${cols})
                 VALUES ('second-channel', 'second-channel-token', 'de', 'EUR', FALSE, TRUE, 0)`,
            );

            await simulatePreMigrationState();
            await migrateAssetTranslationData(queryRunner);

            // All translations should use the default channel's language, not 'de'
            const translations: Array<{ languageCode: string }> = await queryRunner.query(
                `SELECT DISTINCT ${esc('languageCode')} FROM ${esc('asset_translation')}`,
            );

            expect(translations).toHaveLength(1);
            expect(translations[0].languageCode).toBe(defaultLanguageCode);
            expect(translations[0].languageCode).not.toBe('de');
        } finally {
            // Clean up second channel
            await queryRunner.query(`DELETE FROM ${esc('channel')} WHERE ${esc('code')} = 'second-channel'`);
            await restoreOriginalState();
        }
    });

    it('should skip assets with NULL names', async () => {
        try {
            await simulatePreMigrationState();

            // Set the first asset's name to NULL to simulate corrupt/incomplete data
            const assets: Array<{ id: number }> = await queryRunner.query(
                `SELECT ${esc('id')} FROM ${esc('asset')} ORDER BY ${esc('id')} LIMIT 1`,
            );
            const nullAssetId = assets[0].id;
            await queryRunner.query(
                `UPDATE ${esc('asset')} SET ${esc('name')} = NULL WHERE ${esc('id')} = ${nullAssetId}`,
            );

            // Should not throw
            await migrateAssetTranslationData(queryRunner);

            // The NULL-named asset should NOT get a translation row (NOT NULL constraint)
            const translations: Array<{ baseId: number }> = await queryRunner.query(
                `SELECT ${esc('baseId')} FROM ${esc('asset_translation')}`,
            );
            expect(translations.length).toBe(originalTranslations.length - 1);
            expect(translations.map(t => t.baseId)).not.toContain(nullAssetId);
        } finally {
            await restoreOriginalState();
        }
    });

    it('should handle partial migration (crash recovery)', async () => {
        try {
            await simulatePreMigrationState();

            // Pre-insert a translation for one asset to simulate a partial migration
            const firstAsset: Array<{ id: number; name: string; createdAt: string; updatedAt: string }> =
                await queryRunner.query(
                    `SELECT ${esc('id')}, ${esc('name')}, ${esc('createdAt')}, ${esc('updatedAt')}
                     FROM ${esc('asset')} ORDER BY ${esc('id')} LIMIT 1`,
                );
            const a = firstAsset[0];
            const escapedName = a.name.replace(/'/g, "''");
            const insertCols = [
                esc('createdAt'),
                esc('updatedAt'),
                esc('languageCode'),
                esc('name'),
                esc('baseId'),
            ].join(', ');
            // MariaDB/MySQL reject ISO 8601 "T" and "Z" — use "YYYY-MM-DD HH:mm:ss" which
            // is valid across SQLite, Postgres, MySQL, and MariaDB.
            const toDbTimestamp = (d: Date | string) =>
                new Date(d).toISOString().replace('T', ' ').replace('Z', '');
            const createdAt = toDbTimestamp(a.createdAt);
            const updatedAt = toDbTimestamp(a.updatedAt);
            await queryRunner.query(
                `INSERT INTO ${esc('asset_translation')} (${insertCols})
                 VALUES ('${createdAt}', '${updatedAt}',
                         '${defaultLanguageCode}', '${escapedName}', ${a.id})`,
            );

            // Run the migration — should fill in the rest without duplicating the existing one
            await migrateAssetTranslationData(queryRunner);

            const translations: Array<{ baseId: number }> = await queryRunner.query(
                `SELECT ${esc('baseId')} FROM ${esc('asset_translation')}`,
            );
            expect(translations.length).toBe(originalTranslations.length);

            // Verify no duplicates
            const baseIds = translations.map(t => t.baseId);
            expect(new Set(baseIds).size).toBe(baseIds.length);
        } finally {
            await restoreOriginalState();
        }
    });

    it('should handle asset names with special characters', async () => {
        try {
            await simulatePreMigrationState();

            // Insert an asset with a tricky name
            const specialName = 'it\'s a "test" — asset (1)';
            const assetCols = [
                esc('name'),
                esc('type'),
                esc('mimeType'),
                esc('width'),
                esc('height'),
                esc('fileSize'),
                esc('source'),
                esc('preview'),
            ].join(', ');
            await queryRunner.query(
                `INSERT INTO ${esc('asset')} (${assetCols})
                 VALUES ('${specialName.replace(/'/g, "''")}', 'IMAGE',
                         'image/jpeg', 100, 100, 1000,
                         'test-source', 'test-preview')`,
            );
            const inserted: Array<{ id: number }> = await queryRunner.query(
                `SELECT ${esc('id')} FROM ${esc('asset')} WHERE ${esc('source')} = 'test-source'`,
            );
            // Assign the asset to the default channel
            const defaultChannel: Array<{ id: number }> = await queryRunner.query(
                `SELECT ${esc('id')} FROM ${esc('channel')} WHERE ${esc('code')} = '__default_channel__'`,
            );
            await queryRunner.query(
                `INSERT INTO ${esc('asset_channels_channel')} (${esc('assetId')}, ${esc('channelId')})
                 VALUES (${inserted[0].id}, ${defaultChannel[0].id})`,
            );

            await migrateAssetTranslationData(queryRunner);

            const translation: Array<{ name: string }> = await queryRunner.query(
                `SELECT ${esc('name')} FROM ${esc('asset_translation')} WHERE ${esc('baseId')} = ${inserted[0].id}`,
            );
            expect(translation).toHaveLength(1);
            expect(translation[0].name).toBe(specialName);
        } finally {
            // Clean up the test asset
            const subquery =
                `SELECT ${esc('id')} FROM ${esc('asset')}` + ` WHERE ${esc('source')} = 'test-source'`;
            await queryRunner.query(
                `DELETE FROM ${esc('asset_channels_channel')}` + ` WHERE ${esc('assetId')} IN (${subquery})`,
            );
            await queryRunner.query(
                `DELETE FROM ${esc('asset_translation')}` + ` WHERE ${esc('baseId')} IN (${subquery})`,
            );
            await queryRunner.query(`DELETE FROM ${esc('asset')} WHERE ${esc('source')} = 'test-source'`);
            await restoreOriginalState();
        }
    });
});
