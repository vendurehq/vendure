import { TransactionalConnection } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { QueryRunner } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { migrateProductOptionGroupData } from '../src/migration-utils/v3_6_shared_option_groups';

// TODO: Remove this test file (and the migration helper it tests) once v3.6 has been stable
// for a while. The migration is a one-time operation from the old productId FK to the new
// ManyToMany join table. Once all users have upgraded past v3.6, nobody will ever run this
// migration again, and the test will only add maintenance overhead as the schema evolves.
describe('migrateProductOptionGroupData()', () => {
    const { server } = createTestEnvironment(testConfig());
    let queryRunner: QueryRunner;
    let esc: (name: string) => string;

    // Snapshots of the original join table data, taken before any modifications
    let originalProductGroups: Array<{ productId: number; productOptionGroupId: number }>;
    let originalGroupChannels: Array<{ productOptionGroupId: number; channelId: number }>;
    let originalOptionChannels: Array<{ productOptionId: number; channelId: number }>;
    let defaultChannelId: number;
    let secondChannelId: number;

    beforeAll(async () => {
        await server.init({
            initialData,
            customerCount: 1,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
        });
        const rawConnection = server.app.get(TransactionalConnection).rawConnection;
        queryRunner = rawConnection.createQueryRunner();
        esc = (name: string) => rawConnection.driver.escape(name);

        // Get the default channel ID
        const channels: Array<{ id: number }> = await queryRunner.query(
            `SELECT ${esc('id')} FROM ${esc('channel')} WHERE ${esc('code')} = '__default_channel__'`,
        );
        defaultChannelId = channels[0].id;

        // Create a second channel and assign the product to it.
        // This exercises the multi-channel inheritance path in the migration.
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
             VALUES ('second-channel', 'second-channel-token', 'en', 'USD', FALSE, TRUE, 0)`,
        );
        const newChannels: Array<{ id: number }> = await queryRunner.query(
            `SELECT ${esc('id')} FROM ${esc('channel')} WHERE ${esc('code')} = 'second-channel'`,
        );
        secondChannelId = newChannels[0].id;

        // Assign the product to the second channel
        const products: Array<{ id: number }> = await queryRunner.query(
            `SELECT ${esc('id')} FROM ${esc('product')} LIMIT 1`,
        );
        await queryRunner.query(
            `INSERT INTO ${esc('product_channels_channel')} (${esc('productId')}, ${esc('channelId')})
             VALUES (${products[0].id}, ${secondChannelId})`,
        );

        // Also assign the option groups and options to the second channel
        // (mirroring what the application would do when a product is assigned to a channel)
        const optionGroups: Array<{ id: number }> = await queryRunner.query(
            `SELECT ${esc('productOptionGroupId')} as ${esc('id')}
             FROM ${esc('product_option_groups_product_option_group')}
             WHERE ${esc('productId')} = ${products[0].id}`,
        );
        for (const group of optionGroups) {
            await queryRunner.query(
                `INSERT INTO ${esc('product_option_group_channels_channel')} (${esc('productOptionGroupId')}, ${esc('channelId')})
                 VALUES (${group.id}, ${secondChannelId})`,
            );
            const options: Array<{ id: number }> = await queryRunner.query(
                `SELECT ${esc('id')} FROM ${esc('product_option')} WHERE ${esc('groupId')} = ${group.id}`,
            );
            for (const option of options) {
                await queryRunner.query(
                    `INSERT INTO ${esc('product_option_channels_channel')} (${esc('productOptionId')}, ${esc('channelId')})
                     VALUES (${option.id}, ${secondChannelId})`,
                );
            }
        }

        // Now snapshot the join table data (includes both channels)
        originalProductGroups = await queryRunner.query(
            `SELECT ${esc('productId')}, ${esc('productOptionGroupId')}
             FROM ${esc('product_option_groups_product_option_group')}`,
        );
        originalGroupChannels = await queryRunner.query(
            `SELECT ${esc('productOptionGroupId')}, ${esc('channelId')}
             FROM ${esc('product_option_group_channels_channel')}`,
        );
        originalOptionChannels = await queryRunner.query(
            `SELECT ${esc('productOptionId')}, ${esc('channelId')}
             FROM ${esc('product_option_channels_channel')}`,
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
     * 1. Adds a `productId` column to `product_option_group`
     * 2. Populates it from the snapshot
     * 3. Clears the join tables that migrateProductOptionGroupData will populate
     */
    async function simulatePreMigrationState() {
        await queryRunner.query(
            `ALTER TABLE ${esc('product_option_group')} ADD ${esc('productId')} int NULL`,
        );
        for (const row of originalProductGroups) {
            await queryRunner.query(
                `UPDATE ${esc('product_option_group')}
                 SET ${esc('productId')} = ${row.productId}
                 WHERE ${esc('id')} = ${row.productOptionGroupId}`,
            );
        }
        await queryRunner.query(`DELETE FROM ${esc('product_option_channels_channel')}`);
        await queryRunner.query(`DELETE FROM ${esc('product_option_group_channels_channel')}`);
        await queryRunner.query(`DELETE FROM ${esc('product_option_groups_product_option_group')}`);
    }

    /**
     * Restores the database to its original state after a test:
     * 1. Restores join table data from the snapshots
     * 2. Drops the temporary `productId` column via raw SQL
     *    (TypeORM's dropColumn() won't work because its metadata doesn't
     *    know about columns added via raw ALTER TABLE)
     *    Note: relies on SQLite >= 3.35.0 for ALTER TABLE DROP COLUMN support.
     */
    async function restoreOriginalState() {
        await queryRunner.query(`DELETE FROM ${esc('product_option_channels_channel')}`);
        await queryRunner.query(`DELETE FROM ${esc('product_option_group_channels_channel')}`);
        await queryRunner.query(`DELETE FROM ${esc('product_option_groups_product_option_group')}`);

        for (const row of originalProductGroups) {
            await queryRunner.query(
                `INSERT INTO ${esc('product_option_groups_product_option_group')}
                 (${esc('productId')}, ${esc('productOptionGroupId')}) VALUES (${row.productId}, ${row.productOptionGroupId})`,
            );
        }
        for (const row of originalGroupChannels) {
            await queryRunner.query(
                `INSERT INTO ${esc('product_option_group_channels_channel')}
                 (${esc('productOptionGroupId')}, ${esc('channelId')}) VALUES (${row.productOptionGroupId}, ${row.channelId})`,
            );
        }
        for (const row of originalOptionChannels) {
            await queryRunner.query(
                `INSERT INTO ${esc('product_option_channels_channel')}
                 (${esc('productOptionId')}, ${esc('channelId')}) VALUES (${row.productOptionId}, ${row.channelId})`,
            );
        }

        const hasProductId = await queryRunner.hasColumn('product_option_group', 'productId');
        if (hasProductId) {
            await queryRunner.query(
                `ALTER TABLE ${esc('product_option_group')} DROP COLUMN ${esc('productId')}`,
            );
        }
    }

    it('should skip if productId column does not exist', async () => {
        const hasProductId = await queryRunner.hasColumn('product_option_group', 'productId');
        expect(hasProductId).toBe(false);
        await migrateProductOptionGroupData(queryRunner);
    });

    it('should populate join tables from productId FK column', async () => {
        try {
            await simulatePreMigrationState();

            // Verify preconditions
            expect(await queryRunner.hasColumn('product_option_group', 'productId')).toBe(true);
            const emptyJoin: Array<{ productId: number; productOptionGroupId: number }> =
                await queryRunner.query(`SELECT * FROM ${esc('product_option_groups_product_option_group')}`);
            expect(emptyJoin).toHaveLength(0);

            // Run the migration
            await migrateProductOptionGroupData(queryRunner);

            // Verify: Product <-> ProductOptionGroup join table
            const productGroups: Array<{ productId: number; productOptionGroupId: number }> =
                await queryRunner.query(
                    `SELECT ${esc('productId')}, ${esc('productOptionGroupId')}
                     FROM ${esc('product_option_groups_product_option_group')}`,
                );
            expect(productGroups.length).toBe(originalProductGroups.length);
            for (const expected of originalProductGroups) {
                expect(productGroups).toContainEqual(
                    expect.objectContaining({
                        productId: expected.productId,
                        productOptionGroupId: expected.productOptionGroupId,
                    }),
                );
            }

            // Verify: ProductOptionGroup channel assignments (includes both channels)
            const groupChannels: Array<{ productOptionGroupId: number; channelId: number }> =
                await queryRunner.query(
                    `SELECT ${esc('productOptionGroupId')}, ${esc('channelId')}
                     FROM ${esc('product_option_group_channels_channel')}`,
                );
            expect(groupChannels.length).toBe(originalGroupChannels.length);
            for (const expected of originalGroupChannels) {
                expect(groupChannels).toContainEqual(
                    expect.objectContaining({
                        productOptionGroupId: expected.productOptionGroupId,
                        channelId: expected.channelId,
                    }),
                );
            }

            // Verify: ProductOption channel assignments (includes both channels)
            const optionChannels: Array<{ productOptionId: number; channelId: number }> =
                await queryRunner.query(
                    `SELECT ${esc('productOptionId')}, ${esc('channelId')}
                     FROM ${esc('product_option_channels_channel')}`,
                );
            expect(optionChannels.length).toBe(originalOptionChannels.length);
            for (const expected of originalOptionChannels) {
                expect(optionChannels).toContainEqual(
                    expect.objectContaining({
                        productOptionId: expected.productOptionId,
                        channelId: expected.channelId,
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
            await migrateProductOptionGroupData(queryRunner);
            // Running a second time should not throw or produce duplicate rows
            await migrateProductOptionGroupData(queryRunner);

            const productGroups = await queryRunner.query(
                `SELECT ${esc('productId')}, ${esc('productOptionGroupId')}
                 FROM ${esc('product_option_groups_product_option_group')}`,
            );
            expect(productGroups.length).toBe(originalProductGroups.length);

            const groupChannels = await queryRunner.query(
                `SELECT ${esc('productOptionGroupId')}, ${esc('channelId')}
                 FROM ${esc('product_option_group_channels_channel')}`,
            );
            expect(groupChannels.length).toBe(originalGroupChannels.length);

            const optionChannels = await queryRunner.query(
                `SELECT ${esc('productOptionId')}, ${esc('channelId')}
                 FROM ${esc('product_option_channels_channel')}`,
            );
            expect(optionChannels.length).toBe(originalOptionChannels.length);
        } finally {
            await restoreOriginalState();
        }
    });

    it('should assign orphaned option groups to default channel', async () => {
        try {
            await simulatePreMigrationState();

            // Get all option group IDs and pick one to orphan
            const allGroups: Array<{ id: number }> = await queryRunner.query(
                `SELECT ${esc('id')} FROM ${esc('product_option_group')}`,
            );
            const orphanGroupId = allGroups[0].id;

            // Get the orphan's options (to verify they also get default-channelled)
            const orphanOptions: Array<{ id: number }> = await queryRunner.query(
                `SELECT ${esc('id')} FROM ${esc('product_option')} WHERE ${esc('groupId')} = ${orphanGroupId}`,
            );

            // Set the group's productId to NULL to simulate an orphan
            await queryRunner.query(
                `UPDATE ${esc('product_option_group')}
                 SET ${esc('productId')} = NULL
                 WHERE ${esc('id')} = ${orphanGroupId}`,
            );

            await migrateProductOptionGroupData(queryRunner);

            // Verify: orphan is NOT in the product join table
            const orphanProductLinks: Array<{ productOptionGroupId: number }> = await queryRunner.query(
                `SELECT ${esc('productOptionGroupId')}
                     FROM ${esc('product_option_groups_product_option_group')}
                     WHERE ${esc('productOptionGroupId')} = ${orphanGroupId}`,
            );
            expect(orphanProductLinks).toHaveLength(0);

            // Verify: orphan group was assigned to exactly the default channel
            const orphanGroupChannels: Array<{ productOptionGroupId: number; channelId: number }> =
                await queryRunner.query(
                    `SELECT ${esc('productOptionGroupId')}, ${esc('channelId')}
                     FROM ${esc('product_option_group_channels_channel')}
                     WHERE ${esc('productOptionGroupId')} = ${orphanGroupId}`,
                );
            expect(orphanGroupChannels).toHaveLength(1);
            expect(orphanGroupChannels[0].channelId).toBe(defaultChannelId);

            // Verify: orphan's options were also assigned to the default channel
            for (const option of orphanOptions) {
                const optionChannels: Array<{ productOptionId: number; channelId: number }> =
                    await queryRunner.query(
                        `SELECT ${esc('productOptionId')}, ${esc('channelId')}
                         FROM ${esc('product_option_channels_channel')}
                         WHERE ${esc('productOptionId')} = ${option.id}`,
                    );
                expect(optionChannels).toHaveLength(1);
                expect(optionChannels[0].channelId).toBe(defaultChannelId);
            }

            // Verify: non-orphaned groups still migrated correctly
            const nonOrphanGroups = allGroups.filter(g => g.id !== orphanGroupId);
            for (const group of nonOrphanGroups) {
                const groupLinks: Array<{ productId: number }> = await queryRunner.query(
                    `SELECT ${esc('productId')}
                     FROM ${esc('product_option_groups_product_option_group')}
                     WHERE ${esc('productOptionGroupId')} = ${group.id}`,
                );
                expect(groupLinks.length).toBeGreaterThanOrEqual(1);
            }
        } finally {
            await restoreOriginalState();
        }
    });

    it('should inherit channel assignments from multi-channel products', async () => {
        try {
            await simulatePreMigrationState();
            await migrateProductOptionGroupData(queryRunner);

            // Verify that option groups were assigned to BOTH channels
            // (default + second-channel), not just one
            const groupChannels: Array<{ productOptionGroupId: number; channelId: number }> =
                await queryRunner.query(
                    `SELECT ${esc('productOptionGroupId')}, ${esc('channelId')}
                     FROM ${esc('product_option_group_channels_channel')}`,
                );

            // Each group should have entries for both channels
            const channelIdsPerGroup = new Map<number, number[]>();
            for (const row of groupChannels) {
                const existing = channelIdsPerGroup.get(row.productOptionGroupId) ?? [];
                existing.push(row.channelId);
                channelIdsPerGroup.set(row.productOptionGroupId, existing);
            }
            for (const [groupId, channelIds] of channelIdsPerGroup) {
                expect(channelIds, `group ${groupId} should be in both channels`).toContain(defaultChannelId);
                expect(channelIds, `group ${groupId} should be in both channels`).toContain(secondChannelId);
            }

            // Verify same for options
            const optionChannels: Array<{ productOptionId: number; channelId: number }> =
                await queryRunner.query(
                    `SELECT ${esc('productOptionId')}, ${esc('channelId')}
                     FROM ${esc('product_option_channels_channel')}`,
                );

            const channelIdsPerOption = new Map<number, number[]>();
            for (const row of optionChannels) {
                const existing = channelIdsPerOption.get(row.productOptionId) ?? [];
                existing.push(row.channelId);
                channelIdsPerOption.set(row.productOptionId, existing);
            }
            for (const [optionId, channelIds] of channelIdsPerOption) {
                expect(channelIds, `option ${optionId} should be in both channels`).toContain(
                    defaultChannelId,
                );
                expect(channelIds, `option ${optionId} should be in both channels`).toContain(
                    secondChannelId,
                );
            }
        } finally {
            await restoreOriginalState();
        }
    });
});
