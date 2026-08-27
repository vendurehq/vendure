/* eslint-disable no-console */
import { QueryRunner } from 'typeorm';

/**
 * @description
 * Removes duplicate rows from one or more translation tables, keeping only the most recently
 * updated row per `(baseId, languageCode)` pair.
 *
 * Prior to the fix for a race condition in `TranslatableSaver.update()`, two concurrent
 * updates could both add a translation for the same language before either had committed,
 * resulting in two rows for the same `(baseId, languageCode)` pair. This is no longer
 * possible going forward, but a unique constraint on translation tables cannot be added to an
 * existing database that already contains such duplicates without first removing them.
 *
 * This applies to any table backing a `Translation<T>` entity used with `TranslatableSaver`,
 * including translation tables defined by plugins for their own custom translatable entities —
 * not just the 13 core tables shown below.
 *
 * **You normally do not need to call this yourself.** When `vendure migrate generate` detects that
 * the generated migration adds the unique constraint to one or more translation tables, it inserts
 * a `deduplicateTranslations` call for exactly those tables at the top of `up()`, ahead of the DDL.
 * Call it manually only if you write migrations by hand, or if you split the generated migration and
 * need the de-duplication to run ahead of a constraint in a separate file. It accepts either a
 * single table name or an array of table names, and is a no-op for tables without duplicates.
 *
 * The generated migration looks like this on Postgres (constraint names are deterministic, so
 * `vendure migrate generate` will produce these exact names):
 *
 * ```ts
 * import { MigrationInterface, QueryRunner } from 'typeorm';
 * import { deduplicateTranslations } from '\@vendure/core';
 *
 * export class AddTranslationUniqueConstraints1234567890 implements MigrationInterface {
 *     public async up(queryRunner: QueryRunner): Promise<any> {
 *         // --- Inserted by `vendure migrate generate`: remove pre-existing duplicate rows ---
 *         await deduplicateTranslations(queryRunner, [
 *             'product_translation',
 *             'product_variant_translation',
 *             'product_option_translation',
 *             'product_option_group_translation',
 *             'collection_translation',
 *             'facet_translation',
 *             'facet_value_translation',
 *             'asset_translation',
 *             'api_key_translation',
 *             'payment_method_translation',
 *             'promotion_translation',
 *             'region_translation',
 *             'shipping_method_translation',
 *             // Translation tables of your own plugins' translatable entities are included too,
 *             // since they receive the same constraint.
 *         ]);
 *
 *         // --- Auto-generated DDL continues (Postgres) ---
 *         await queryRunner.query(`ALTER TABLE "product_translation" ADD CONSTRAINT "UQ_dcc35f0d2b8d422634e878b813c" UNIQUE ("languageCode", "baseId")`);
 *         await queryRunner.query(`ALTER TABLE "product_variant_translation" ADD CONSTRAINT "UQ_33042b9e7ea5dcf5ec09a5a4130" UNIQUE ("languageCode", "baseId")`);
 *         await queryRunner.query(`ALTER TABLE "product_option_translation" ADD CONSTRAINT "UQ_bd426ff614344b6759d327fe58c" UNIQUE ("languageCode", "baseId")`);
 *         await queryRunner.query(`ALTER TABLE "product_option_group_translation" ADD CONSTRAINT "UQ_bb3992fff02944c061363d9d015" UNIQUE ("languageCode", "baseId")`);
 *         await queryRunner.query(`ALTER TABLE "collection_translation" ADD CONSTRAINT "UQ_858c112351f7714960a2dfcff91" UNIQUE ("languageCode", "baseId")`);
 *         await queryRunner.query(`ALTER TABLE "facet_translation" ADD CONSTRAINT "UQ_c9174d39ac643e5f14b73ad6cb5" UNIQUE ("languageCode", "baseId")`);
 *         await queryRunner.query(`ALTER TABLE "facet_value_translation" ADD CONSTRAINT "UQ_084f223aa69bcd7683e727e3130" UNIQUE ("languageCode", "baseId")`);
 *         await queryRunner.query(`ALTER TABLE "asset_translation" ADD CONSTRAINT "UQ_0dad4e3837a685fea5062da3d96" UNIQUE ("languageCode", "baseId")`);
 *         await queryRunner.query(`ALTER TABLE "api_key_translation" ADD CONSTRAINT "UQ_0a5a4e1c3fb9547a20f34ef2240" UNIQUE ("languageCode", "baseId")`);
 *         await queryRunner.query(`ALTER TABLE "payment_method_translation" ADD CONSTRAINT "UQ_5ee20e71a427f7d86e921083777" UNIQUE ("languageCode", "baseId")`);
 *         await queryRunner.query(`ALTER TABLE "promotion_translation" ADD CONSTRAINT "UQ_0d74bcbf35d65e5d7c2a7947ae1" UNIQUE ("languageCode", "baseId")`);
 *         await queryRunner.query(`ALTER TABLE "region_translation" ADD CONSTRAINT "UQ_fc1a4a3618bcd16cc50dd50dfeb" UNIQUE ("languageCode", "baseId")`);
 *         await queryRunner.query(`ALTER TABLE "shipping_method_translation" ADD CONSTRAINT "UQ_6f2a231486b87fd9d337bf9d60b" UNIQUE ("languageCode", "baseId")`);
 *     }
 *
 *     public async down(queryRunner: QueryRunner): Promise<any> {
 *         // Auto-generated reverse DDL — drops the constraints added above.
 *         // ...
 *     }
 * }
 * ```
 *
 * On MySQL/MariaDB, unique constraints are implemented as unique indexes, so the generated DDL
 * instead looks like `` CREATE UNIQUE INDEX `UQ_dcc35f0d2b8d422634e878b813c` ON `product_translation`
 * (`languageCode`, `baseId`) `` (same deterministic names as above). On SQLite, adding a unique
 * constraint requires TypeORM to recreate the whole table, so the generated migration will
 * contain a much longer sequence of statements for each table; the generated
 * `deduplicateTranslations` call still precedes them.
 *
 * @docsCategory migration
 */
export async function deduplicateTranslations(
    queryRunner: QueryRunner,
    translationTableNames: string | string[],
): Promise<void> {
    const tableNames = Array.isArray(translationTableNames) ? translationTableNames : [translationTableNames];
    for (const tableName of tableNames) {
        await deduplicateTranslationTable(queryRunner, tableName);
    }
}

async function deduplicateTranslationTable(
    queryRunner: QueryRunner,
    translationTableName: string,
): Promise<void> {
    const hasTable = await queryRunner.hasTable(translationTableName);
    if (!hasTable) {
        console.log(`The ${translationTableName} table does not exist. Skipping de-duplication.`);
        return;
    }

    const esc = (name: string) => queryRunner.connection.driver.escape(name);
    const table = esc(translationTableName);

    const duplicateCounts: Array<{ count: string | number }> = await queryRunner.query(
        `SELECT COUNT(*) AS ${esc('count')} FROM (
            SELECT ${esc('baseId')}
            FROM ${table}
            GROUP BY ${esc('baseId')}, ${esc('languageCode')}
            HAVING COUNT(*) > 1
         ) AS ${esc('duplicates')}`,
    );
    const duplicateCount = Number(duplicateCounts[0].count);
    if (duplicateCount === 0) {
        console.log(`No duplicate rows found in ${translationTableName}. Skipping de-duplication.`);
        return;
    }

    // Keep the most recently updated row per (baseId, languageCode) and delete the rest.
    // The subquery is wrapped in a derived table so that MySQL, which does not allow a table
    // to be referenced directly in the subquery of a DELETE against that same table, can run it.
    await queryRunner.query(
        `DELETE FROM ${table}
         WHERE ${esc('id')} IN (
             SELECT ${esc('id')} FROM (
                 SELECT
                     ${esc('id')},
                     ROW_NUMBER() OVER (
                         PARTITION BY ${esc('baseId')}, ${esc('languageCode')}
                         ORDER BY ${esc('updatedAt')} DESC, ${esc('id')} DESC
                     ) AS ${esc('rowNumber')}
                 FROM ${table}
             ) AS ${esc('ranked')}
             WHERE ${esc('ranked')}.${esc('rowNumber')} > 1
         )`,
    );

    console.log(
        `Removed ${duplicateCount} duplicate translation group(s) from ${translationTableName}, ` +
            `keeping the most recently updated row per (baseId, languageCode).`,
    );
}
