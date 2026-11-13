import { MigrationInterface, QueryRunner } from 'typeorm';

export class SharedOptionGroups1772713755008 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<any> {
        // 1. Create the new join tables
        await queryRunner.query(
            'CREATE TABLE `product_option_channels_channel` (`productOptionId` int NOT NULL, `channelId` int NOT NULL, INDEX `IDX_8dbe001861ca34ae8b687e6bae` (`productOptionId`), INDEX `IDX_717e7792b8f31c319b6c7b8135` (`channelId`), PRIMARY KEY (`productOptionId`, `channelId`)) ENGINE=InnoDB',
            undefined,
        );
        await queryRunner.query(
            'CREATE TABLE `product_option_group_channels_channel` (`productOptionGroupId` int NOT NULL, `channelId` int NOT NULL, INDEX `IDX_4fbe6303db2827370c0ec2d027` (`productOptionGroupId`), INDEX `IDX_d689965b8c58ebf316fce60fab` (`channelId`), PRIMARY KEY (`productOptionGroupId`, `channelId`)) ENGINE=InnoDB',
            undefined,
        );
        await queryRunner.query(
            'CREATE TABLE `product_option_groups_product_option_group` (`productId` int NOT NULL, `productOptionGroupId` int NOT NULL, INDEX `IDX_9148fe2c2fd83f5b59d391088c` (`productId`), INDEX `IDX_9b03a92219b0684dbd4403e624` (`productOptionGroupId`), PRIMARY KEY (`productId`, `productOptionGroupId`)) ENGINE=InnoDB',
            undefined,
        );

        // 2. Add foreign key constraints to the new join tables
        await queryRunner.query(
            'ALTER TABLE `product_option_channels_channel` ADD CONSTRAINT `FK_8dbe001861ca34ae8b687e6baef` FOREIGN KEY (`productOptionId`) REFERENCES `product_option`(`id`) ON DELETE CASCADE ON UPDATE CASCADE',
            undefined,
        );
        await queryRunner.query(
            'ALTER TABLE `product_option_channels_channel` ADD CONSTRAINT `FK_717e7792b8f31c319b6c7b81352` FOREIGN KEY (`channelId`) REFERENCES `channel`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION',
            undefined,
        );
        await queryRunner.query(
            'ALTER TABLE `product_option_group_channels_channel` ADD CONSTRAINT `FK_4fbe6303db2827370c0ec2d0276` FOREIGN KEY (`productOptionGroupId`) REFERENCES `product_option_group`(`id`) ON DELETE CASCADE ON UPDATE CASCADE',
            undefined,
        );
        await queryRunner.query(
            'ALTER TABLE `product_option_group_channels_channel` ADD CONSTRAINT `FK_d689965b8c58ebf316fce60fab2` FOREIGN KEY (`channelId`) REFERENCES `channel`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION',
            undefined,
        );
        await queryRunner.query(
            'ALTER TABLE `product_option_groups_product_option_group` ADD CONSTRAINT `FK_9148fe2c2fd83f5b59d391088c5` FOREIGN KEY (`productId`) REFERENCES `product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE',
            undefined,
        );
        await queryRunner.query(
            'ALTER TABLE `product_option_groups_product_option_group` ADD CONSTRAINT `FK_9b03a92219b0684dbd4403e6246` FOREIGN KEY (`productOptionGroupId`) REFERENCES `product_option_group`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION',
            undefined,
        );

        // 3. Migrate data BEFORE dropping the FK column
        // Populate Product <-> ProductOptionGroup join table from existing FK
        await queryRunner.query(
            `INSERT INTO product_option_groups_product_option_group (productId, productOptionGroupId)
             SELECT productId, id FROM product_option_group WHERE productId IS NOT NULL`,
            undefined,
        );

        // Populate ProductOptionGroup channel assignments (inherit from parent product's channels)
        await queryRunner.query(
            `INSERT INTO product_option_group_channels_channel (productOptionGroupId, channelId)
             SELECT DISTINCT pog.id, pc.channelId
             FROM product_option_group pog
             INNER JOIN product_channels_channel pc ON pc.productId = pog.productId
             WHERE pog.productId IS NOT NULL`,
            undefined,
        );

        // Populate ProductOption channel assignments (inherit from parent group's channels)
        await queryRunner.query(
            `INSERT INTO product_option_channels_channel (productOptionId, channelId)
             SELECT DISTINCT po.id, pogc.channelId
             FROM product_option po
             INNER JOIN product_option_group_channels_channel pogc ON pogc.productOptionGroupId = po.groupId`,
            undefined,
        );

        // Handle orphaned option groups (NULL productId) — assign to default channel
        await queryRunner.query(
            `INSERT INTO product_option_group_channels_channel (productOptionGroupId, channelId)
             SELECT pog.id, (SELECT id FROM channel WHERE code = '__default_channel__')
             FROM product_option_group pog
             WHERE pog.id NOT IN (SELECT productOptionGroupId FROM product_option_group_channels_channel)`,
            undefined,
        );

        // Handle orphaned options (groups with no channel assignment before this step)
        await queryRunner.query(
            `INSERT IGNORE INTO product_option_channels_channel (productOptionId, channelId)
             SELECT po.id, (SELECT id FROM channel WHERE code = '__default_channel__')
             FROM product_option po
             WHERE po.id NOT IN (SELECT productOptionId FROM product_option_channels_channel)`,
            undefined,
        );

        // 4. Now safe to drop the old FK column
        await queryRunner.query(
            "ALTER TABLE `product_option_group` DROP FOREIGN KEY `FK_a6e91739227bf4d442f23c52c75`",
            undefined,
        );
        await queryRunner.query(
            'DROP INDEX `IDX_a6e91739227bf4d442f23c52c7` ON `product_option_group`',
            undefined,
        );
        await queryRunner.query(
            "ALTER TABLE `product_option_group` DROP COLUMN `productId`",
            undefined,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<any> {
        // Re-add the productId column
        await queryRunner.query(
            'ALTER TABLE `product_option_group` ADD `productId` int NULL',
            undefined,
        );

        // Restore FK data from join table (take the first product for each group)
        await queryRunner.query(
            `UPDATE product_option_group pog
             INNER JOIN (
               SELECT productOptionGroupId, MIN(productId) as productId
               FROM product_option_groups_product_option_group
               GROUP BY productOptionGroupId
             ) jt ON jt.productOptionGroupId = pog.id
             SET pog.productId = jt.productId`,
            undefined,
        );

        // Re-add index and FK
        await queryRunner.query(
            'CREATE INDEX `IDX_a6e91739227bf4d442f23c52c7` ON `product_option_group` (`productId`)',
            undefined,
        );
        await queryRunner.query(
            'ALTER TABLE `product_option_group` ADD CONSTRAINT `FK_a6e91739227bf4d442f23c52c75` FOREIGN KEY (`productId`) REFERENCES `product`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION',
            undefined,
        );

        // Drop join tables and their constraints
        await queryRunner.query(
            'ALTER TABLE `product_option_groups_product_option_group` DROP FOREIGN KEY `FK_9b03a92219b0684dbd4403e6246`',
            undefined,
        );
        await queryRunner.query(
            'ALTER TABLE `product_option_groups_product_option_group` DROP FOREIGN KEY `FK_9148fe2c2fd83f5b59d391088c5`',
            undefined,
        );
        await queryRunner.query(
            'ALTER TABLE `product_option_group_channels_channel` DROP FOREIGN KEY `FK_d689965b8c58ebf316fce60fab2`',
            undefined,
        );
        await queryRunner.query(
            'ALTER TABLE `product_option_group_channels_channel` DROP FOREIGN KEY `FK_4fbe6303db2827370c0ec2d0276`',
            undefined,
        );
        await queryRunner.query(
            'ALTER TABLE `product_option_channels_channel` DROP FOREIGN KEY `FK_717e7792b8f31c319b6c7b81352`',
            undefined,
        );
        await queryRunner.query(
            'ALTER TABLE `product_option_channels_channel` DROP FOREIGN KEY `FK_8dbe001861ca34ae8b687e6baef`',
            undefined,
        );
        await queryRunner.query(
            'DROP INDEX `IDX_9b03a92219b0684dbd4403e624` ON `product_option_groups_product_option_group`',
            undefined,
        );
        await queryRunner.query(
            'DROP INDEX `IDX_9148fe2c2fd83f5b59d391088c` ON `product_option_groups_product_option_group`',
            undefined,
        );
        await queryRunner.query(
            'DROP TABLE `product_option_groups_product_option_group`',
            undefined,
        );
        await queryRunner.query(
            'DROP INDEX `IDX_d689965b8c58ebf316fce60fab` ON `product_option_group_channels_channel`',
            undefined,
        );
        await queryRunner.query(
            'DROP INDEX `IDX_4fbe6303db2827370c0ec2d027` ON `product_option_group_channels_channel`',
            undefined,
        );
        await queryRunner.query(
            'DROP TABLE `product_option_group_channels_channel`',
            undefined,
        );
        await queryRunner.query(
            'DROP INDEX `IDX_717e7792b8f31c319b6c7b8135` ON `product_option_channels_channel`',
            undefined,
        );
        await queryRunner.query(
            'DROP INDEX `IDX_8dbe001861ca34ae8b687e6bae` ON `product_option_channels_channel`',
            undefined,
        );
        await queryRunner.query('DROP TABLE `product_option_channels_channel`', undefined);
    }
}
