import { CurrencyCode, LanguageCode, Permission } from '@vendure/common/lib/generated-types';
import {
    CUSTOMER_ROLE_CODE,
    DEFAULT_APIKEY_HEADER_KEY,
    DEFAULT_CHANNEL_CODE,
    DEFAULT_CHANNEL_TOKEN_KEY,
    ROLE_EDITOR_ROLE_CODE,
    SUPER_ADMIN_ROLE_CODE,
} from '@vendure/common/lib/shared-constants';
import { ConfigService, TransactionalConnection } from '@vendure/core';
import { createTestEnvironment, E2E_DEFAULT_CHANNEL_TOKEN } from '@vendure/testing';
import path from 'path';
import { QueryRunner, Table } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import {
    assertRoleAssignmentDataMigrated,
    ensureRoleAssignmentDataMigrated,
    migrateRoleAssignmentData,
    removeLegacyRoleData,
} from '../src/migration-utils/v4_0_role_assignments';

import { graphql } from './graphql/graphql-admin';
import { graphql as graphqlShop } from './graphql/graphql-shop';
import {
    createAdministratorDocument,
    createChannelDocument,
    createRoleDocument,
    MeDocument,
} from './graphql/shared-definitions';
import { assertThrowsWithMessage } from './utils/assert-throws-with-message';

/**
 * Permissions per user (keyed by identifier, or `api-key`) and per channel code, as the
 * API reports them.
 */
type PermissionSnapshot = Record<string, Record<string, string[]>>;

// TODO: Remove this test file (and the migration helper it tests) once v4.0 has been stable
// for a while.
//
// There is no pre-v4 schema to start from, so the legacy tables are rebuilt from the
// grants created through the v4 API: user_roles_role and role_channels_channel get the
// rows a v3 instance would have held for the same grants, and role_assignment is emptied.
// The oracle is the API: every user must have the same permissions after the migration as
// before it, which the helper's own check cannot show.
describe('migrateRoleAssignmentData()', () => {
    const config = testConfig();
    config.authOptions.tokenMethod = ['bearer', 'api-key'];
    const { server, adminClient, shopClient } = createTestEnvironment(config);
    const adminApiUrl = `http://localhost:${config.apiOptions.port}/${String(config.apiOptions.adminApiPath)}`;

    const ADMINS = {
        orders: 'orders@test.com',
        ordersAndCatalog: 'orders-and-catalog@test.com',
        roleCrud: 'role-crud@test.com',
    };
    // Not part of the permission snapshots: a v3 server revokes its Role between the two
    // migration steps.
    const REVOKED_ON_V3 = 'revoked-on-v3@test.com';
    const ADDED_ON_V4 = 'added-on-v4@test.com';

    let queryRunner: QueryRunner;
    let esc: (name: string) => string;
    let channelB: { id: string; token: string };
    let apiKey: string;
    let ordersRoleId: string;
    let customerEmails: string[];
    let triplesBefore: string[];
    let triplesAfter: string[];
    let permissionsBefore: PermissionSnapshot;
    let legacyRowCounts: { userRoles: number; roleChannels: number };

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 2,
        });
        const rawConnection = server.app.get(TransactionalConnection).rawConnection;
        queryRunner = rawConnection.createQueryRunner();
        esc = (name: string) => rawConnection.driver.escape(name);
        await adminClient.asSuperAdmin();

        channelB = await createChannel('channel-b');
        const channelC = await createChannel('channel-c');

        // A v3 Role held its permissions on the same Channels for every holder, so each
        // Role is granted on the same Channels to everyone who holds it.
        const ordersRole = await createRole('orders', [Permission.ReadOrder, Permission.UpdateOrder]);
        ordersRoleId = ordersRole.id;
        const catalogRole = await createRole('catalog', [Permission.ReadCatalog, Permission.UpdateCatalog]);
        const roleCrudRole = await createRole('role-crud', [
            Permission.CreateRole,
            Permission.ReadRole,
            Permission.UpdateRole,
            Permission.DeleteRole,
        ]);
        const ordersGrants = [
            { roleId: ordersRole.id, channelId: 'T_1' },
            { roleId: ordersRole.id, channelId: channelB.id },
        ];
        const catalogGrants = [{ roleId: catalogRole.id, channelId: channelC.id }];
        await createAdministrator(ADMINS.orders, ordersGrants);
        await createAdministrator(ADMINS.ordersAndCatalog, [...ordersGrants, ...catalogGrants]);
        await createAdministrator(ADMINS.roleCrud, [{ roleId: roleCrudRole.id, channelId: 'T_1' }]);
        await createAdministrator(REVOKED_ON_V3, ordersGrants);

        // An API key can only be used on the channels it was created on
        adminClient.setChannelToken(channelC.token);
        const { createApiKey } = await adminClient.query(createApiKeyDocument, {
            input: {
                roleAssignments: catalogGrants,
                translations: [{ languageCode: LanguageCode.en, name: 'Catalog key' }],
            },
        });
        apiKey = createApiKey.apiKey;
        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);

        // Both customers are members of the default channel; the second also joins
        // channel-b with an authenticated request there.
        const { customers } = await adminClient.query(getCustomerEmailsDocument);
        customerEmails = customers.items.map(c => c.emailAddress);
        await shopClient.asUserWithCredentials(customerEmails[1], 'test');
        shopClient.setChannelToken(channelB.token);
        await shopClient.query(shopMeDocument);
        shopClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);

        triplesBefore = await getTriples();
        permissionsBefore = await snapshotPermissions();
        legacyRowCounts = await createLegacyTables();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        if (queryRunner?.isReleased === false) {
            await queryRunner.release();
        }
        await server.destroy();
    });

    async function createChannel(code: string) {
        const { createChannel: channel } = await adminClient.query(createChannelDocument, {
            input: {
                code,
                token: `${code}-token`,
                defaultLanguageCode: LanguageCode.en,
                currencyCode: CurrencyCode.GBP,
                pricesIncludeTax: true,
                defaultShippingZoneId: 'T_1',
                defaultTaxZoneId: 'T_1',
            },
        });
        if (!('token' in channel)) {
            throw new Error(`Could not create channel ${code}`);
        }
        return channel;
    }

    async function createRole(code: string, permissions: Permission[]) {
        const { createRole: role } = await adminClient.query(createRoleDocument, {
            input: { code, description: code, permissions },
        });
        return role;
    }

    async function createAdministrator(
        emailAddress: string,
        roleAssignments: Array<{ roleId: string; channelId: string }>,
    ) {
        await adminClient.query(createAdministratorDocument, {
            input: { firstName: 'Test', lastName: 'Admin', emailAddress, password: 'test', roleAssignments },
        });
    }

    /**
     * The role_assignment rows as `identifier / role code / channel code`, sorted.
     */
    async function getTriples(): Promise<string[]> {
        const rows: Array<{ identifier: string; roleCode: string; channelCode: string }> =
            await queryRunner.query(
                `SELECT u.${esc('identifier')} AS ${esc('identifier')}, r.${esc('code')} AS ${esc('roleCode')},
                        c.${esc('code')} AS ${esc('channelCode')}
                 FROM ${esc('role_assignment')} ra
                 INNER JOIN ${esc('user')} u ON u.${esc('id')} = ra.${esc('userId')}
                 INNER JOIN ${esc('role')} r ON r.${esc('id')} = ra.${esc('roleId')}
                 INNER JOIN ${esc('channel')} c ON c.${esc('id')} = ra.${esc('channelId')}`,
            );
        return rows.map(row => `${row.identifier} / ${row.roleCode} / ${row.channelCode}`).sort();
    }

    async function countRows(tableName: string): Promise<number> {
        const rows: Array<{ count: string | number }> = await queryRunner.query(
            `SELECT COUNT(*) AS ${esc('count')} FROM ${esc(tableName)}`,
        );
        return Number(rows[0].count);
    }

    async function getRoleOwners(): Promise<Record<string, string | null>> {
        const rows: Array<{ code: string; channelCode: string | null }> = await queryRunner.query(
            `SELECT r.${esc('code')} AS ${esc('code')}, c.${esc('code')} AS ${esc('channelCode')}
             FROM ${esc('role')} r
             LEFT JOIN ${esc('channel')} c ON c.${esc('id')} = r.${esc('channelId')}`,
        );
        return Object.fromEntries(rows.map(row => [row.code, row.channelCode]));
    }

    /**
     * Rebuilds the pre-v4 join tables from the current role_assignment rows, the way a v3
     * instance stored the same grants: each user's Roles in user_roles_role, each Role's
     * Channels in role_channels_channel, the SuperAdmin and Customer roles on every Channel
     * and every customer holding the Customer role. Then empties role_assignment and clears
     * the owning Channel of every Role, which v3 did not have.
     */
    async function createLegacyTables(): Promise<{ userRoles: number; roleChannels: number }> {
        await queryRunner.query(`UPDATE ${esc('role')} SET ${esc('channelId')} = NULL`);
        await queryRunner.query(
            `INSERT INTO ${esc('role')} (${esc('createdAt')}, ${esc('updatedAt')}, ${esc('code')}, ${esc('description')}, ${esc('permissions')})
             VALUES (CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, '${CUSTOMER_ROLE_CODE}', 'Customer', 'Authenticated')`,
        );
        const idType = (await queryRunner.getTable('user'))?.findColumnByName('id')?.type;
        if (!idType) {
            throw new Error('Could not inspect the id column of the user table');
        }
        const joinTable = (name: string, left: string, right: string) =>
            new Table({
                name,
                columns: [
                    { name: `${left}Id`, type: idType, isPrimary: true },
                    { name: `${right}Id`, type: idType, isPrimary: true },
                ],
                foreignKeys: [left, right].map(entity => ({
                    columnNames: [`${entity}Id`],
                    referencedTableName: entity,
                    referencedColumnNames: ['id'],
                    onDelete: 'CASCADE',
                })),
            });
        await queryRunner.createTable(joinTable('user_roles_role', 'user', 'role'));
        await queryRunner.createTable(joinTable('role_channels_channel', 'role', 'channel'));

        await queryRunner.query(
            `INSERT INTO ${esc('user_roles_role')} (${esc('userId')}, ${esc('roleId')})
             SELECT DISTINCT ${esc('userId')}, ${esc('roleId')} FROM ${esc('role_assignment')}`,
        );
        await queryRunner.query(
            `INSERT INTO ${esc('user_roles_role')} (${esc('userId')}, ${esc('roleId')})
             SELECT cu.${esc('userId')}, r.${esc('id')}
             FROM ${esc('customer')} cu
             CROSS JOIN ${esc('role')} r
             WHERE r.${esc('code')} = '${CUSTOMER_ROLE_CODE}'
             AND cu.${esc('userId')} IS NOT NULL AND cu.${esc('deletedAt')} IS NULL`,
        );
        await queryRunner.query(
            `INSERT INTO ${esc('role_channels_channel')} (${esc('roleId')}, ${esc('channelId')})
             SELECT DISTINCT ra.${esc('roleId')}, ra.${esc('channelId')}
             FROM ${esc('role_assignment')} ra
             INNER JOIN ${esc('role')} r ON r.${esc('id')} = ra.${esc('roleId')}
             WHERE r.${esc('code')} <> '${SUPER_ADMIN_ROLE_CODE}'`,
        );
        await queryRunner.query(
            `INSERT INTO ${esc('role_channels_channel')} (${esc('roleId')}, ${esc('channelId')})
             SELECT r.${esc('id')}, c.${esc('id')}
             FROM ${esc('role')} r
             CROSS JOIN ${esc('channel')} c
             WHERE r.${esc('code')} IN ('${SUPER_ADMIN_ROLE_CODE}', '${CUSTOMER_ROLE_CODE}')`,
        );

        // A grant the legacy tables cannot express (a Role held on different Channels by
        // different users) would surface as a confusing verification failure later on.
        const crossProduct: Array<{ count: string | number }> = await queryRunner.query(
            `SELECT COUNT(*) AS ${esc('count')}
             FROM ${esc('user_roles_role')} ur
             INNER JOIN ${esc('role_channels_channel')} rc ON rc.${esc('roleId')} = ur.${esc('roleId')}
             INNER JOIN ${esc('role')} r ON r.${esc('id')} = ur.${esc('roleId')}
             WHERE r.${esc('code')} NOT IN ('${SUPER_ADMIN_ROLE_CODE}', '${CUSTOMER_ROLE_CODE}')`,
        );
        const superAdminRows = (await getTriples()).filter(t => t.includes(`/ ${SUPER_ADMIN_ROLE_CODE} /`));
        if (Number(crossProduct[0].count) !== (await countRows('role_assignment')) - superAdminRows.length) {
            throw new Error('The role assignment fixture cannot be expressed in the legacy tables');
        }

        await queryRunner.query(`DELETE FROM ${esc('role_assignment')}`);
        return {
            userRoles: await countRows('user_roles_role'),
            roleChannels: await countRows('role_channels_channel'),
        };
    }

    /**
     * Signs in as every administrator, the API key and every customer and reads their
     * permissions per channel. The session cache is cleared first, so that every read
     * resolves the permissions from the database.
     */
    async function snapshotPermissions(): Promise<PermissionSnapshot> {
        await server.app.get(ConfigService).authOptions.sessionCacheStrategy.clear?.();
        const snapshot: PermissionSnapshot = {};
        for (const identifier of ['superadmin', ...Object.values(ADMINS)]) {
            if (identifier === 'superadmin') {
                await adminClient.asSuperAdmin();
            } else {
                await adminClient.asUserWithCredentials(identifier, 'test');
            }
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const { me } = await adminClient.query(MeDocument);
            snapshot[identifier] = byChannel(me?.channels ?? []);
        }
        snapshot['api-key'] = await probeApiKeyPermissions();
        for (const emailAddress of customerEmails) {
            await shopClient.asUserWithCredentials(emailAddress, 'test');
            shopClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const { me } = await shopClient.query(shopMeDocument);
            snapshot[emailAddress] = byChannel(me?.channels ?? []);
        }
        await adminClient.asSuperAdmin();
        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        return snapshot;
    }

    /**
     * The Admin API `me` query requires an Administrator, so the API key's permissions are
     * probed instead: on every channel, which of a ReadCatalog and a ReadOrder query it may run.
     */
    async function probeApiKeyPermissions(): Promise<Record<string, string[]>> {
        const channels: Array<{ code: string; token: string }> = await queryRunner.query(
            `SELECT ${esc('code')}, ${esc('token')} FROM ${esc('channel')}`,
        );
        const probes = [
            { permission: Permission.ReadCatalog, query: '{ products { totalItems } }' },
            { permission: Permission.ReadOrder, query: '{ orders { totalItems } }' },
        ];
        const result: Record<string, string[]> = {};
        for (const channel of channels) {
            const allowed: string[] = [];
            for (const probe of probes) {
                const response = await fetch(adminApiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        [DEFAULT_APIKEY_HEADER_KEY]: apiKey,
                        [DEFAULT_CHANNEL_TOKEN_KEY]: channel.token,
                    },
                    body: JSON.stringify({ query: probe.query }),
                });
                const { errors } = (await response.json()) as { errors?: unknown[] };
                if (!errors) {
                    allowed.push(probe.permission);
                }
            }
            if (allowed.length) {
                result[channel.code] = allowed;
            }
        }
        return result;
    }

    function byChannel(channels: ReadonlyArray<{ code: string; permissions: readonly string[] }>) {
        return Object.fromEntries(channels.map(c => [c.code, [...c.permissions].sort()]));
    }

    it('fixture: every administrator, the API key and every customer has permissions', () => {
        const orderPermissions = [Permission.Authenticated, Permission.ReadOrder, Permission.UpdateOrder];
        expect(permissionsBefore[ADMINS.orders]).toEqual({
            [DEFAULT_CHANNEL_CODE]: orderPermissions,
            'channel-b': orderPermissions,
        });
        expect(Object.keys(permissionsBefore[ADMINS.ordersAndCatalog]).sort()).toEqual([
            DEFAULT_CHANNEL_CODE,
            'channel-b',
            'channel-c',
        ]);
        expect(permissionsBefore['api-key']).toEqual({
            'channel-c': [Permission.ReadCatalog],
        });
        expect(permissionsBefore[customerEmails[0]]).toEqual({
            [DEFAULT_CHANNEL_CODE]: [Permission.Authenticated],
        });
        expect(permissionsBefore[customerEmails[1]]).toEqual({
            [DEFAULT_CHANNEL_CODE]: [Permission.Authenticated],
            'channel-b': [Permission.Authenticated],
        });
    });

    it('refuses to start before the migration', async () => {
        await expect(assertRoleAssignmentDataMigrated(queryRunner)).rejects.toThrow(
            'The pre-v4 user_roles_role table still holds role grants',
        );
        await expect(ensureRoleAssignmentDataMigrated(queryRunner, { synchronize: false })).rejects.toThrow(
            'The pre-v4 user_roles_role table still holds role grants',
        );
    });

    it('administrators have no permissions before the migration', async () => {
        const permissions = await snapshotPermissions();
        expect(permissions.superadmin).toEqual({});
        expect(permissions[ADMINS.orders]).toEqual({});
        expect(permissions['api-key']).toEqual({});
    });

    it('migrateRoleAssignmentData copies the grants and leaves the legacy tables untouched', async () => {
        const insertedCount = await migrateRoleAssignmentData(queryRunner);

        expect(insertedCount).toBe(triplesBefore.length);
        expect(await getTriples()).toEqual(triplesBefore);
        expect(await countRows('user_roles_role')).toBe(legacyRowCounts.userRoles);
        expect(await countRows('role_channels_channel')).toBe(legacyRowCounts.roleChannels);
        expect((await queryRunner.getTable('user_roles_role'))?.foreignKeys).toHaveLength(2);
        expect((await queryRunner.getTable('role_channels_channel'))?.foreignKeys).toHaveLength(2);
    });

    it('gives a Role on one channel that channel as its owner, and every other Role the default channel', async () => {
        expect(await getRoleOwners()).toEqual({
            [SUPER_ADMIN_ROLE_CODE]: DEFAULT_CHANNEL_CODE,
            [ROLE_EDITOR_ROLE_CODE]: DEFAULT_CHANNEL_CODE,
            [CUSTOMER_ROLE_CODE]: DEFAULT_CHANNEL_CODE,
            // on the default channel and channel-b: a shared Role
            orders: DEFAULT_CHANNEL_CODE,
            // on channel-c only: private to it
            catalog: 'channel-c',
            'role-crud': DEFAULT_CHANNEL_CODE,
        });
    });

    describe('while v3 and v4 servers run side by side', () => {
        it('starts with the same permissions as before for every administrator, the API key and every customer', async () => {
            await expect(assertRoleAssignmentDataMigrated(queryRunner)).resolves.toBeUndefined();
            expect(await snapshotPermissions()).toEqual(permissionsBefore);
        });

        it('changes role assignments on v4', async () => {
            // SQLite stores createdAt with second precision. A row written in the second of
            // the copy would count as copied.
            await new Promise(resolve => setTimeout(resolve, 1100));

            // The same Channels as the other holders of the orders role, so that the legacy
            // tables can express it in the synchronize test below
            await createAdministrator(ADDED_ON_V4, [
                { roleId: ordersRoleId, channelId: 'T_1' },
                { roleId: ordersRoleId, channelId: channelB.id },
            ]);

            expect(await getTriples()).toContain(`${ADDED_ON_V4} / orders / ${DEFAULT_CHANNEL_CODE}`);
        });

        it('refuses to assign the legacy Customer role on v4', async () => {
            const [customerRole]: Array<{ id: string | number }> = await queryRunner.query(
                `SELECT ${esc('id')} FROM ${esc('role')} WHERE ${esc('code')} = '${CUSTOMER_ROLE_CODE}'`,
            );

            await assertThrowsWithMessage(
                () =>
                    adminClient.query(createAdministratorDocument, {
                        input: {
                            firstName: 'Test',
                            lastName: 'Admin',
                            emailAddress: 'customer-role@test.com',
                            password: 'test',
                            roleAssignments: [{ roleId: `T_${customerRole.id}`, channelId: 'T_1' }],
                        },
                    }),
                'The pre-v4 Customer role cannot be assigned',
            )();
        });
    });

    it('removeLegacyRoleData deletes the grants revoked on v3, keeps those added on v4 and drops the legacy tables', async () => {
        // On a v3 server: the orders role is revoked
        await queryRunner.query(
            `DELETE FROM ${esc('user_roles_role')} WHERE ${esc('userId')} IN (
                 SELECT ${esc('id')} FROM ${esc('user')} WHERE ${esc('identifier')} = '${REVOKED_ON_V3}'
             )`,
        );
        triplesAfter = [
            ...triplesBefore.filter(t => !t.startsWith(`${REVOKED_ON_V3} /`)),
            `${ADDED_ON_V4} / orders / ${DEFAULT_CHANNEL_CODE}`,
            `${ADDED_ON_V4} / orders / channel-b`,
        ].sort();

        await removeLegacyRoleData(queryRunner);

        expect(await getTriples()).toEqual(triplesAfter);
        expect(await queryRunner.hasTable('user_roles_role')).toBe(false);
        expect(await queryRunner.hasTable('role_assignment_migration')).toBe(false);
    });

    it('every administrator, the API key and every customer has the same permissions as before', async () => {
        expect(await snapshotPermissions()).toEqual(permissionsBefore);
    });

    it('customers hold Authenticated on their member channels only, without role assignments', async () => {
        const permissions = await snapshotPermissions();
        expect(permissions[customerEmails[0]]).toEqual({
            [DEFAULT_CHANNEL_CODE]: [Permission.Authenticated],
        });
        expect(permissions[customerEmails[1]]).toEqual({
            [DEFAULT_CHANNEL_CODE]: [Permission.Authenticated],
            'channel-b': [Permission.Authenticated],
        });
        const triples = await getTriples();
        expect(triples.filter(t => customerEmails.some(email => t.startsWith(`${email} /`)))).toEqual([]);
        expect(triples.filter(t => t.includes(`/ ${CUSTOMER_ROLE_CODE} /`))).toEqual([]);
    });

    it('SuperAdmin holds one default-channel row and is SuperAdmin on channels created afterwards', async () => {
        expect((await getTriples()).filter(t => t.includes(`/ ${SUPER_ADMIN_ROLE_CODE} /`))).toEqual([
            `superadmin / ${SUPER_ADMIN_ROLE_CODE} / ${DEFAULT_CHANNEL_CODE}`,
        ]);

        await createChannel('channel-d');
        const { me } = await adminClient.query(MeDocument);
        const channelD = me?.channels.find(c => c.code === 'channel-d');
        expect(channelD?.permissions).toContain(Permission.SuperAdmin);
    });

    it('RoleEditor is granted to nobody and former Role CRUD holders keep those permissions', async () => {
        expect((await getTriples()).filter(t => t.includes(`/ ${ROLE_EDITOR_ROLE_CODE} /`))).toEqual([]);

        await adminClient.asUserWithCredentials(ADMINS.roleCrud, 'test');
        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        const role = await createRole('created-after-migration', []);
        expect(role.code).toBe('created-after-migration');

        adminClient.setChannelToken(channelB.token);
        await assertThrowsWithMessage(
            () =>
                adminClient.query(createRoleDocument, {
                    input: { code: 'not-on-channel-b', description: '', permissions: [] },
                }),
            'You are not currently authorized to perform this action',
        )();

        await adminClient.asSuperAdmin();
        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
    });

    it('is idempotent', async () => {
        expect(await migrateRoleAssignmentData(queryRunner)).toBe(0);
        await removeLegacyRoleData(queryRunner);
        expect(await getTriples()).toEqual(triplesAfter);
    });

    it('drops the legacy tables and the Customer role', async () => {
        expect(await queryRunner.hasTable('user_roles_role')).toBe(false);
        expect(await queryRunner.hasTable('role_channels_channel')).toBe(false);
        const customerRoles: unknown[] = await queryRunner.query(
            `SELECT 1 FROM ${esc('role')} WHERE ${esc('code')} = '${CUSTOMER_ROLE_CODE}'`,
        );
        expect(customerRoles).toEqual([]);
        await expect(assertRoleAssignmentDataMigrated(queryRunner)).resolves.toBeUndefined();
    });

    // With synchronize enabled there is no migration to call the helper from, so Vendure
    // migrates on startup instead.
    it('migrates on startup when synchronize is enabled', async () => {
        const expectedPermissions = await snapshotPermissions();
        const expectedTriples = await getTriples();
        await createLegacyTables();

        expect(await ensureRoleAssignmentDataMigrated(queryRunner, { synchronize: true })).toBe(true);

        expect(await getTriples()).toEqual(expectedTriples);
        expect(await snapshotPermissions()).toEqual(expectedPermissions);
        expect((await getRoleOwners()).catalog).toBe('channel-c');
        expect(Object.values(await getRoleOwners())).not.toContain(null);
        await expect(assertRoleAssignmentDataMigrated(queryRunner)).resolves.toBeUndefined();
    });

    it('changes role assignments once the migration has finished', async () => {
        await createAdministrator('after-upgrade@test.com', [{ roleId: ordersRoleId, channelId: 'T_1' }]);

        expect(await getTriples()).toContain(`after-upgrade@test.com / orders / ${DEFAULT_CHANNEL_CODE}`);
    });
});

const createApiKeyDocument = graphql(`
    mutation CreateApiKeyForMigration($input: CreateApiKeyInput!) {
        createApiKey(input: $input) {
            apiKey
            entityId
        }
    }
`);

const getCustomerEmailsDocument = graphql(`
    query GetCustomerEmailsForMigration {
        customers(options: { sort: { id: ASC } }) {
            items {
                emailAddress
            }
        }
    }
`);

const shopMeDocument = graphqlShop(`
    query ShopMeForMigration {
        me {
            identifier
            channels {
                code
                permissions
            }
        }
    }
`);
