import { CurrencyCode, LanguageCode, Permission } from '@vendure/common/lib/generated-types';
import {
    CUSTOMER_ROLE_CODE,
    DEFAULT_CHANNEL_CODE,
    SUPER_ADMIN_ROLE_CODE,
    SUPER_ADMIN_USER_IDENTIFIER,
} from '@vendure/common/lib/shared-constants';
import {
    ConfigService,
    DefaultRolePermissionResolverStrategy,
    mergeConfig,
    RoleAssignmentMigrationService,
    RoleAssignmentPermissionResolverStrategy,
    RoleAssignmentPlugin,
    TransactionalConnection,
} from '@vendure/core';
import { preBootstrapConfig } from '@vendure/core/dist/bootstrap';
import {
    createErrorResultGuard,
    createTestEnvironment,
    E2E_DEFAULT_CHANNEL_TOKEN,
    ErrorResultGuard,
} from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { QueryRunner } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import {
    createAdministratorDocument,
    createChannelDocument,
    createRoleDocument,
} from './graphql/shared-definitions';

/**
 * These tests exercise the experimental `RoleAssignmentPlugin`: registering it in the
 * `plugins` array adds the `RoleAssignment` entity (and its `role_assignment` table) to the
 * schema and installs the `RoleAssignmentPermissionResolverStrategy` — permission resolution
 * is driven by assignments, not by the legacy `User -> Role -> Channel` relations. Writes to
 * the legacy relations are not yet mirrored into assignments; a manual re-run of the backfill
 * migration picks them up.
 *
 * The "plugin absent" assertions are checked via `preBootstrapConfig()` directly (rather
 * than by booting a second live server) because the e2e sqlite cache is keyed only by spec
 * filename — two differently-shaped live databases cannot safely share that cache within a
 * single file.
 */
describe('without the RoleAssignmentPlugin (default)', () => {
    it('does not register the RoleAssignment entity', async () => {
        const config = await preBootstrapConfig({ plugins: [] });

        expect(config.plugins).not.toContain(RoleAssignmentPlugin);
        expect((config.dbConnectionOptions.entities as any[]).some(e => e.name === 'RoleAssignment')).toBe(
            false,
        );
    });

    it('keeps the default role permission resolver strategy', async () => {
        const config = await preBootstrapConfig({ plugins: [] });

        expect(config.authOptions.rolePermissionResolverStrategy).toBeInstanceOf(
            DefaultRolePermissionResolverStrategy,
        );
    });
});

describe('with the RoleAssignmentPlugin registered', () => {
    const { server, adminClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            plugins: [RoleAssignmentPlugin],
        }),
    );
    let queryRunner: QueryRunner;

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        queryRunner = server.app.get(TransactionalConnection).rawConnection.createQueryRunner();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        if (queryRunner?.isReleased === false) {
            await queryRunner.release();
        }
        await server.destroy();
    });

    it('server boots successfully with the plugin registered', async () => {
        await adminClient.asSuperAdmin();
    });

    it('installs the RoleAssignmentPermissionResolverStrategy', () => {
        const configService = server.app.get(ConfigService);
        expect(configService.authOptions.rolePermissionResolverStrategy).toBeInstanceOf(
            RoleAssignmentPermissionResolverStrategy,
        );
    });

    it('creates the role_assignment table with the expected columns', async () => {
        expect(await queryRunner.hasTable('role_assignment')).toBe(true);

        const table = await getRoleAssignmentTable(queryRunner);
        const columnNames = table.columns.map(c => c.name).sort();
        expect(columnNames).toEqual(['channelId', 'createdAt', 'id', 'roleId', 'updatedAt', 'userId'].sort());
    });

    it('has non-nullable foreign key columns', async () => {
        const table = await getRoleAssignmentTable(queryRunner);
        for (const name of ['userId', 'roleId', 'channelId']) {
            expect(table.findColumnByName(name)?.isNullable).toBe(false);
        }
    });

    it('has a unique constraint on (userId, roleId, channelId)', async () => {
        const table = await getRoleAssignmentTable(queryRunner);
        // MySQL/MariaDB report unique constraints as unique indices rather than
        // in `table.uniques`, so both sources are checked.
        const uniqueColumnSets = [
            ...table.uniques.map(u => [...u.columnNames].sort()),
            ...table.indices.filter(i => i.isUnique).map(i => [...i.columnNames].sort()),
        ];
        expect(uniqueColumnSets).toContainEqual(['channelId', 'roleId', 'userId']);
    });

    it('has CASCADE foreign keys to user, role and channel', async () => {
        const table = await getRoleAssignmentTable(queryRunner);
        expect(table.foreignKeys).toHaveLength(3);
        for (const fk of table.foreignKeys) {
            expect(fk.onDelete).toBe('CASCADE');
        }
    });

    describe('legacy role migration', () => {
        const channelGuard: ErrorResultGuard<{ id: string }> = createErrorResultGuard(input => !!input.id);

        it('backfills the roles present at first boot', async () => {
            // The migration runs on the first boot with a still-empty role_assignment table.
            // In the test environment that first boot happens during initial data population,
            // at which point only the superadmin exists (the seed customer is created later
            // in the populate flow), so exactly one assignment is expected. Once the table
            // is non-empty, subsequent boots skip the migration.
            const assignments = await getAssignments(queryRunner);
            expect(assignments).toEqual([
                {
                    identifier: SUPER_ADMIN_USER_IDENTIFIER,
                    roleCode: SUPER_ADMIN_ROLE_CODE,
                    channelCode: DEFAULT_CHANNEL_CODE,
                },
            ]);
        });

        it('manual re-run picks up relations created after the first boot', async () => {
            // The seed customer (Customer role on the default channel) was created after
            // the first-boot migration had already run.
            const result = await server.app.get(RoleAssignmentMigrationService).migrateLegacyRoles();

            expect(result.created).toBe(1);
            const assignments = await getAssignments(queryRunner);
            expect(assignments).toHaveLength(2);
            expect(
                assignments.filter(a => a.roleCode === CUSTOMER_ROLE_CODE).map(a => a.channelCode),
            ).toEqual([DEFAULT_CHANNEL_CODE]);
        });

        it('re-running the migration backfills newly created legacy relations', async () => {
            const { createChannel } = await adminClient.query(createChannelDocument, {
                input: {
                    code: 'second-channel',
                    token: 'second-channel-token',
                    defaultLanguageCode: LanguageCode.en,
                    currencyCode: CurrencyCode.GBP,
                    pricesIncludeTax: true,
                    defaultShippingZoneId: 'T_1',
                    defaultTaxZoneId: 'T_1',
                },
            });
            channelGuard.assertSuccess(createChannel);

            // With assignment-driven permission resolution, the superadmin has no permissions
            // on the new channel yet: the SuperAdmin role was auto-assigned to it in the
            // legacy relations only. The migration re-run mirrors that grant, without which
            // the role/administrator below could not be created on the new channel.
            const firstRun = await server.app.get(RoleAssignmentMigrationService).migrateLegacyRoles();
            expect(firstRun.created).toBe(1);

            const { createRole } = await adminClient.query(createRoleDocument, {
                input: {
                    code: 'catalog-manager',
                    description: 'Catalog manager',
                    permissions: [Permission.ReadCatalog],
                    channelIds: [createChannel.id],
                },
            });
            await adminClient.query(createAdministratorDocument, {
                input: {
                    firstName: 'Bob',
                    lastName: 'Bobson',
                    emailAddress: 'bob@test.com',
                    password: 'test',
                    roleIds: [createRole.id],
                },
            });

            // One further assignment to backfill: bob on the new channel (the role's
            // channel list at migration time).
            const secondRun = await server.app.get(RoleAssignmentMigrationService).migrateLegacyRoles();
            expect(secondRun.created).toBe(1);

            const assignments = await getAssignments(queryRunner);
            expect(assignments).toContainEqual({
                identifier: 'bob@test.com',
                roleCode: 'catalog-manager',
                channelCode: 'second-channel',
            });
            expect(assignments.filter(a => a.roleCode === SUPER_ADMIN_ROLE_CODE)).toEqual([
                {
                    identifier: SUPER_ADMIN_USER_IDENTIFIER,
                    roleCode: SUPER_ADMIN_ROLE_CODE,
                    channelCode: DEFAULT_CHANNEL_CODE,
                },
                {
                    identifier: SUPER_ADMIN_USER_IDENTIFIER,
                    roleCode: SUPER_ADMIN_ROLE_CODE,
                    channelCode: 'second-channel',
                },
            ]);
            // The Customer role is also auto-assigned to the new channel in the legacy
            // model, but the customer user only belongs to the default channel, so no
            // assignment may appear on the new channel.
            expect(
                assignments.filter(a => a.roleCode === CUSTOMER_ROLE_CODE).map(a => a.channelCode),
            ).toEqual([DEFAULT_CHANNEL_CODE]);
            expect(assignments).toHaveLength(4);
        });

        it('is idempotent', async () => {
            const result = await server.app.get(RoleAssignmentMigrationService).migrateLegacyRoles();

            expect(result.created).toBe(0);
            expect(await getAssignments(queryRunner)).toHaveLength(4);
        });
    });

    describe('assignment-driven permission resolution', () => {
        const adminGuard: ErrorResultGuard<{ id: string; emailAddress: string }> = createErrorResultGuard(
            input => !!input.emailAddress,
        );
        let defaultChannelId: string;
        let inventoryRoleId: string;

        beforeAll(async () => {
            await adminClient.asSuperAdmin();
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const { channels } = await adminClient.query(gql`
                query {
                    channels {
                        items {
                            id
                            token
                        }
                    }
                }
            `);
            defaultChannelId = channels.items.find(
                (c: { token: string }) => c.token === E2E_DEFAULT_CHANNEL_TOKEN,
            ).id;
            const { createRole } = await adminClient.query(createRoleDocument, {
                input: {
                    code: 'inventory-manager',
                    description: 'Inventory manager',
                    permissions: [Permission.ReadCatalog],
                    channelIds: [defaultChannelId],
                },
            });
            inventoryRoleId = createRole.id;
            const { createAdministrator } = await adminClient.query(createAdministratorDocument, {
                input: {
                    firstName: 'Carol',
                    lastName: 'Carlson',
                    emailAddress: 'carol@test.com',
                    password: 'test',
                    roleIds: [inventoryRoleId],
                },
            });
            adminGuard.assertSuccess(createAdministrator);
        });

        it('migration re-run mirrors the legacy roleIds input of a new administrator', async () => {
            // Carol was created via the legacy `roleIds` input, which is not yet mirrored
            // into assignments automatically — the manual migration re-run backfills the
            // grant using the role's channel list.
            const result = await server.app.get(RoleAssignmentMigrationService).migrateLegacyRoles();
            expect(result.created).toBe(1);

            const assignments = await getAssignments(queryRunner);
            expect(
                assignments
                    .filter(a => a.identifier === 'carol@test.com')
                    .map(a => ({ roleCode: a.roleCode, channelCode: a.channelCode })),
            ).toEqual([{ roleCode: 'inventory-manager', channelCode: DEFAULT_CHANNEL_CODE }]);
        });

        it('permissions are granted by assignments, not by the legacy relations', async () => {
            // With her backfilled assignment in place, Carol has permissions on the
            // default channel...
            await adminClient.asUserWithCredentials('carol@test.com', 'test');
            const { me: before } = await adminClient.query(meQuery);
            expect(before.channels.map((c: { code: string }) => c.code)).toEqual([
                DEFAULT_CHANNEL_CODE,
            ]);

            // ...but once her assignment rows are gone, the legacy user.roles relation
            // (which still holds the inventory-manager role) grants nothing. The rows are
            // removed via SQL because the admin API for assignments is not part of this
            // change set; a fresh login serializes a new session with fresh permissions.
            const esc = (name: string) => queryRunner.connection.driver.escape(name);
            await queryRunner.query(
                `DELETE FROM ${esc('role_assignment')} WHERE ${esc('userId')} IN ` +
                    `(SELECT ${esc('id')} FROM ${esc('user')} WHERE ${esc('identifier')} = 'carol@test.com')`,
            );
            await adminClient.asUserWithCredentials('carol@test.com', 'test');
            const { me: after } = await adminClient.query(meQuery);
            expect(after.channels).toEqual([]);

            await adminClient.asSuperAdmin();
        });
    });
});

const meQuery = gql`
    query {
        me {
            identifier
            channels {
                code
            }
        }
    }
`;

async function getRoleAssignmentTable(queryRunner: QueryRunner) {
    const table = await queryRunner.getTable('role_assignment');
    if (!table) {
        throw new Error('Expected the role_assignment table to exist');
    }
    return table;
}

async function getAssignments(
    queryRunner: QueryRunner,
): Promise<Array<{ identifier: string; roleCode: string; channelCode: string }>> {
    // All identifiers are escaped via the driver so the raw query works across the
    // DBs the e2e suite runs on: sqlite/postgres ("user") and mysql/mariadb (`user`),
    // and camelCase columns survive postgres' lowercase folding.
    const esc = (name: string) => queryRunner.connection.driver.escape(name);
    return queryRunner.query(
        `SELECT u.${esc('identifier')} AS ${esc('identifier')}, r.${esc('code')} AS ${esc('roleCode')}, c.${esc('code')} AS ${esc('channelCode')}
         FROM ${esc('role_assignment')} ra
         JOIN ${esc('user')} u ON u.${esc('id')} = ra.${esc('userId')}
         JOIN ${esc('role')} r ON r.${esc('id')} = ra.${esc('roleId')}
         JOIN ${esc('channel')} c ON c.${esc('id')} = ra.${esc('channelId')}
         ORDER BY ra.${esc('id')}`,
    );
}
