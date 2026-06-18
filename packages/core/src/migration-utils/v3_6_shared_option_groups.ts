/* eslint-disable no-console */
// TODO: Remove this file once v3.6 has been stable for a while. It is a one-time
// migration helper and will not be needed after all users have upgraded past v3.6.
import { QueryRunner } from 'typeorm';

/**
 * @description
 * Populates the new join tables for shared, channel-aware ProductOptionGroups
 * using data from the existing `productId` FK column on `product_option_group`.
 *
 * Call this from your migration's `up()` method **after** the new join tables
 * have been created and **before** the `productId` column is dropped.
 *
 * ```ts
 * import { MigrationInterface, QueryRunner } from 'typeorm';
 * import { migrateProductOptionGroupData } from '\@vendure/core';
 *
 * export class SharedOptionGroups1234567890 implements MigrationInterface {
 *     public async up(queryRunner: QueryRunner): Promise<any> {
 *         // --- Auto-generated DDL starts here ---
 *         // (Create new join tables and FK constraints)
 *         // ...
 *
 *         // --- Populate new tables with existing data ---
 *         await migrateProductOptionGroupData(queryRunner);
 *
 *         // --- Auto-generated DDL continues ---
 *         // (Drop old productId FK and column)
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
export async function migrateProductOptionGroupData(queryRunner: QueryRunner): Promise<void> {
    const hasProductId = await queryRunner.hasColumn('product_option_group', 'productId');
    if (!hasProductId) {
        console.log(
            'The productId column on product_option_group does not exist. ' +
                'Skipping data migration (already completed?).',
        );
        return;
    }

    const esc = (name: string) => queryRunner.connection.driver.escape(name);

    // 1. Populate Product <-> ProductOptionGroup join table from existing FK
    await queryRunner.query(
        `INSERT INTO ${esc('product_option_groups_product_option_group')} (${esc('productId')}, ${esc('productOptionGroupId')})
         SELECT ${esc('productId')}, ${esc('id')} FROM ${esc('product_option_group')} pog
         WHERE pog.${esc('productId')} IS NOT NULL
         AND NOT EXISTS (
             SELECT 1 FROM ${esc('product_option_groups_product_option_group')} j
             WHERE j.${esc('productId')} = pog.${esc('productId')} AND j.${esc('productOptionGroupId')} = pog.${esc('id')}
         )`,
    );

    // 2. Populate ProductOptionGroup channel assignments (inherit from parent product's channels)
    await queryRunner.query(
        `INSERT INTO ${esc('product_option_group_channels_channel')} (${esc('productOptionGroupId')}, ${esc('channelId')})
         SELECT DISTINCT pog.${esc('id')}, pc.${esc('channelId')}
         FROM ${esc('product_option_group')} pog
         INNER JOIN ${esc('product_channels_channel')} pc ON pc.${esc('productId')} = pog.${esc('productId')}
         WHERE pog.${esc('productId')} IS NOT NULL
         AND NOT EXISTS (
             SELECT 1 FROM ${esc('product_option_group_channels_channel')} j
             WHERE j.${esc('productOptionGroupId')} = pog.${esc('id')} AND j.${esc('channelId')} = pc.${esc('channelId')}
         )`,
    );

    // 3. Populate ProductOption channel assignments (inherit from parent group's channels)
    await queryRunner.query(
        `INSERT INTO ${esc('product_option_channels_channel')} (${esc('productOptionId')}, ${esc('channelId')})
         SELECT DISTINCT po.${esc('id')}, pogc.${esc('channelId')}
         FROM ${esc('product_option')} po
         INNER JOIN ${esc('product_option_group_channels_channel')} pogc ON pogc.${esc('productOptionGroupId')} = po.${esc('groupId')}
         WHERE NOT EXISTS (
             SELECT 1 FROM ${esc('product_option_channels_channel')} j
             WHERE j.${esc('productOptionId')} = po.${esc('id')} AND j.${esc('channelId')} = pogc.${esc('channelId')}
         )`,
    );

    // 4. Handle orphaned option groups (NULL productId) — assign to default channel
    await queryRunner.query(
        `INSERT INTO ${esc('product_option_group_channels_channel')} (${esc('productOptionGroupId')}, ${esc('channelId')})
         SELECT pog.${esc('id')}, (SELECT ${esc('id')} FROM ${esc('channel')} WHERE ${esc('code')} = '__default_channel__')
         FROM ${esc('product_option_group')} pog
         WHERE pog.${esc('id')} NOT IN (SELECT ${esc('productOptionGroupId')} FROM ${esc('product_option_group_channels_channel')})`,
    );

    // 5. Handle orphaned options — assign to default channel
    await queryRunner.query(
        `INSERT INTO ${esc('product_option_channels_channel')} (${esc('productOptionId')}, ${esc('channelId')})
         SELECT po.${esc('id')}, (SELECT ${esc('id')} FROM ${esc('channel')} WHERE ${esc('code')} = '__default_channel__')
         FROM ${esc('product_option')} po
         WHERE po.${esc('id')} NOT IN (SELECT ${esc('productOptionId')} FROM ${esc('product_option_channels_channel')})`,
    );

    console.log('Successfully migrated ProductOptionGroup data to new join tables.');
}
