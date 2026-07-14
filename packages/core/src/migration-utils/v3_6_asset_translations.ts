/* eslint-disable no-console */
// This one-time v3.6 migration helper must remain exported indefinitely: user migrations
// import it directly, so removing the export would break compilation of any committed
// migration that calls it. The guard against the already-migrated state makes it a safe no-op
// once the migration has run.
import { QueryRunner } from 'typeorm';

/**
 * @description
 * Populates the new `asset_translation` table with data from the existing `name`
 * column on `asset`, using the default channel's language code.
 *
 * Call this from your migration's `up()` method **after** the `asset_translation`
 * table has been created and **before** the `name` column is dropped from `asset`.
 *
 * ```ts
 * import { MigrationInterface, QueryRunner } from 'typeorm';
 * import { migrateAssetTranslationData } from '\@vendure/core';
 *
 * export class V36Migration1234567890 implements MigrationInterface {
 *     public async up(queryRunner: QueryRunner): Promise<any> {
 *         // --- Auto-generated DDL starts here ---
 *         // (Create asset_translation table)
 *         // ...
 *
 *         // --- Populate new table with existing data ---
 *         await migrateAssetTranslationData(queryRunner);
 *
 *         // --- Auto-generated DDL continues ---
 *         // (Drop name column from asset)
 *         // ...
 *     }
 *
 *     public async down(queryRunner: QueryRunner): Promise<any> {
 *         // Auto-generated reverse DDL
 *     }
 * }
 * ```
 *
 * @since 3.6.0
 * @docsCategory migration
 */
export async function migrateAssetTranslationData(queryRunner: QueryRunner): Promise<void> {
    const hasName = await queryRunner.hasColumn('asset', 'name');
    if (!hasName) {
        console.log(
            'The name column on asset does not exist. ' + 'Skipping data migration (already completed?).',
        );
        return;
    }

    const esc = (name: string) => queryRunner.connection.driver.escape(name);

    // 1. If there is no asset data to migrate, skip entirely. This covers the
    // fresh-install case where migrations run against an empty database before
    // the default channel has been populated.
    const assetCounts: Array<{ count: string | number }> = await queryRunner.query(
        `SELECT COUNT(*) AS ${esc('count')} FROM ${esc('asset')} WHERE ${esc('name')} IS NOT NULL`,
    );
    const assetCount = Number(assetCounts[0].count);
    if (assetCount === 0) {
        console.log('No asset rows with a name to migrate. Skipping asset translation data migration.');
        return;
    }

    // 2. Get the default language code from the default channel
    const rows: Array<{ defaultLanguageCode: string }> = await queryRunner.query(
        `SELECT ${esc('defaultLanguageCode')} FROM ${esc('channel')} WHERE ${esc('code')} = '__default_channel__'`,
    );
    if (!rows?.length) {
        throw new Error(
            'Could not find the default channel. The __default_channel__ must exist before running this migration.',
        );
    }
    const defaultLanguageCode = rows[0].defaultLanguageCode;

    // 3. Copy asset names into the asset_translation table
    await queryRunner.query(
        `INSERT INTO ${esc('asset_translation')} (${esc('createdAt')}, ${esc('updatedAt')}, ${esc('languageCode')}, ${esc('name')}, ${esc('baseId')})
         SELECT a.${esc('createdAt')}, a.${esc('updatedAt')}, '${defaultLanguageCode}', a.${esc('name')}, a.${esc('id')}
         FROM ${esc('asset')} a
         WHERE a.${esc('name')} IS NOT NULL
         AND NOT EXISTS (
             SELECT 1 FROM ${esc('asset_translation')} t
             WHERE t.${esc('baseId')} = a.${esc('id')}
         )`,
    );

    console.log('Successfully migrated Asset name data to asset_translation table.');
}
