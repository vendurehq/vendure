import { DataSource, QueryRunner } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    formatRoleAssignmentMigrationPreview,
    previewRoleAssignmentMigration,
} from './v4_0_role_assignments_preview';

describe('previewRoleAssignmentMigration()', () => {
    let dataSource: DataSource;
    let queryRunner: QueryRunner;

    beforeEach(async () => {
        dataSource = new DataSource({ type: 'better-sqlite3', database: ':memory:' });
        await dataSource.initialize();
        queryRunner = dataSource.createQueryRunner();
        await createLegacySchema();
    });

    afterEach(async () => {
        await queryRunner.release();
        await dataSource.destroy();
    });

    async function createLegacySchema() {
        await queryRunner.query(
            `CREATE TABLE "role" ("id" integer PRIMARY KEY AUTOINCREMENT, "code" varchar NOT NULL,
             "permissions" text NOT NULL)`,
        );
        await queryRunner.query(
            `CREATE TABLE "channel" ("id" integer PRIMARY KEY AUTOINCREMENT, "code" varchar NOT NULL)`,
        );
        await queryRunner.query(
            `CREATE TABLE "customer" ("id" integer PRIMARY KEY AUTOINCREMENT, "deletedAt" datetime,
             "userId" integer)`,
        );
        await queryRunner.query(
            `CREATE TABLE "administrator" ("id" integer PRIMARY KEY AUTOINCREMENT, "deletedAt" datetime,
             "userId" integer)`,
        );
        await queryRunner.query(
            `CREATE TABLE "customer_channels_channel" ("customerId" integer NOT NULL,
             "channelId" integer NOT NULL, PRIMARY KEY ("customerId", "channelId"))`,
        );
        await queryRunner.query(
            `CREATE TABLE "user_roles_role" ("userId" integer NOT NULL, "roleId" integer NOT NULL,
             PRIMARY KEY ("userId", "roleId"))`,
        );
        await queryRunner.query(
            `CREATE TABLE "role_channels_channel" ("roleId" integer NOT NULL, "channelId" integer NOT NULL,
             PRIMARY KEY ("roleId", "channelId"))`,
        );
        await queryRunner.query(
            `INSERT INTO "channel" ("id", "code") VALUES
             (1, '__default_channel__'), (2, 'second'), (3, 'programmatic')`,
        );
        await queryRunner.query(
            `INSERT INTO "role" ("id", "code", "permissions") VALUES
             (1, '__super_admin_role__', 'SuperAdmin'),
             (2, '__customer_role__', 'Authenticated'),
             (3, 'sales', 'Authenticated,ReadOrder')`,
        );
        // The Customer role is assigned to channels 1 and 2; channel 3 was created
        // programmatically and never received it.
        await queryRunner.query(
            `INSERT INTO "role_channels_channel" ("roleId", "channelId") VALUES (1, 1), (2, 1), (2, 2), (3, 2)`,
        );
    }

    it('reports no changes when Customer memberships match the Customer role channels', async () => {
        await queryRunner.query(
            `INSERT INTO "user_roles_role" ("userId", "roleId") VALUES (1, 1), (2, 3), (3, 2)`,
        );
        await queryRunner.query(`INSERT INTO "administrator" ("id", "userId") VALUES (1, 1), (2, 2)`);
        await queryRunner.query(`INSERT INTO "customer" ("id", "userId") VALUES (1, 3)`);
        await queryRunner.query(
            `INSERT INTO "customer_channels_channel" ("customerId", "channelId") VALUES (1, 1), (1, 2)`,
        );

        const preview = await previewRoleAssignmentMigration(queryRunner);

        expect(preview).toEqual({
            migration: { userCount: 2, assignmentCount: 2 },
            administrators: { userCount: 2, superAdminCount: 1, assignmentCount: 2 },
            customersWithRoles: { userCount: 0, assignmentCount: 0, roles: [] },
            customersLosingAccess: 0,
            customerChannelChanges: [],
            customerRoleDroppedPermissions: [],
            rolesWithoutChannels: [],
        });
        expect(formatRoleAssignmentMigrationPreview(preview)).toContain(
            '   No change: every customer is a member of exactly the channels they can use today.',
        );
    });

    it('counts Customers losing non-member channels and gaining member channels', async () => {
        // user 3: member of channel 1 only, so loses channel 2
        // user 4: member of channels 1 and 3, so loses channel 2 and gains channel 3
        // user 5: deleted Customer, so loses channels 1 and 2
        await queryRunner.query(
            `INSERT INTO "user_roles_role" ("userId", "roleId") VALUES (3, 2), (4, 2), (5, 2)`,
        );
        await queryRunner.query(
            `INSERT INTO "customer" ("id", "userId", "deletedAt") VALUES
             (1, 3, NULL), (2, 4, NULL), (3, 5, datetime('now'))`,
        );
        await queryRunner.query(
            `INSERT INTO "customer_channels_channel" ("customerId", "channelId") VALUES
             (1, 1), (2, 1), (2, 3), (3, 1), (3, 2)`,
        );

        const preview = await previewRoleAssignmentMigration(queryRunner);

        expect(preview.customerChannelChanges).toEqual([
            {
                channelId: '1',
                channelCode: '__default_channel__',
                customersLosingAccess: 1,
                customersGainingAccess: 0,
            },
            { channelId: '2', channelCode: 'second', customersLosingAccess: 3, customersGainingAccess: 0 },
            {
                channelId: '3',
                channelCode: 'programmatic',
                customersLosingAccess: 0,
                customersGainingAccess: 1,
            },
        ]);
        expect(preview.customersLosingAccess).toBe(3);
        const report = formatRoleAssignmentMigrationPreview(preview);
        expect(report).toContain(
            [
                '   Channel               Customers losing access   Customers gaining access',
                '   -------------------   -----------------------   ------------------------',
                '   __default_channel__                         1                          0',
                '   second                                      3                          0',
                '   programmatic                                0                          1',
                '   Total                                       4                          1',
            ].join('\n'),
        );
        expect(report).toContain('   Customers affected         3');
        expect(report).toContain('With the default CustomerChannelAssignmentStrategy');
    });

    it('does not count a customer who keeps access through an admin role', async () => {
        // user 3: customer, member of channel 1 only, also holds sales on channel 2
        // user 4: customer, member of channel 1 only, also a SuperAdmin
        await queryRunner.query(
            `INSERT INTO "user_roles_role" ("userId", "roleId") VALUES (3, 2), (3, 3), (4, 2), (4, 1)`,
        );
        await queryRunner.query(`INSERT INTO "customer" ("id", "userId") VALUES (1, 3), (2, 4)`);
        await queryRunner.query(
            `INSERT INTO "customer_channels_channel" ("customerId", "channelId") VALUES (1, 1), (2, 1)`,
        );

        const preview = await previewRoleAssignmentMigration(queryRunner);

        expect(preview.customerChannelChanges).toEqual([]);
        expect(preview.customersLosingAccess).toBe(0);
        // user 3 is not an Administrator: a customer holding another role
        expect(preview.administrators).toEqual({ userCount: 1, superAdminCount: 1, assignmentCount: 1 });
        expect(preview.customersWithRoles).toEqual({
            userCount: 1,
            assignmentCount: 1,
            roles: [{ roleId: '3', roleCode: 'sales', holderCount: 1 }],
        });
    });

    it('separates customers holding other roles from administrators', async () => {
        // user 2: administrator holding sales; user 3: customer holding sales;
        // user 4: customer who is also an administrator, holding sales
        await queryRunner.query(
            `INSERT INTO "user_roles_role" ("userId", "roleId") VALUES (2, 3), (3, 2), (3, 3), (4, 2), (4, 3)`,
        );
        await queryRunner.query(`INSERT INTO "administrator" ("id", "userId") VALUES (1, 2), (2, 4)`);
        await queryRunner.query(`INSERT INTO "customer" ("id", "userId") VALUES (1, 3), (2, 4)`);
        await queryRunner.query(
            `INSERT INTO "customer_channels_channel" ("customerId", "channelId") VALUES (1, 1), (1, 2), (2, 1), (2, 2)`,
        );

        const preview = await previewRoleAssignmentMigration(queryRunner);

        expect(preview.migration).toEqual({ userCount: 3, assignmentCount: 3 });
        expect(preview.administrators).toEqual({ userCount: 2, superAdminCount: 0, assignmentCount: 2 });
        expect(preview.customersWithRoles).toEqual({
            userCount: 1,
            assignmentCount: 1,
            roles: [{ roleId: '3', roleCode: 'sales', holderCount: 1 }],
        });
        const report = formatRoleAssignmentMigrationPreview(preview);
        expect(report).toContain('Customers holding other roles');
        expect(report).toContain('   sales    3           1');
    });

    it('reports Customer role permissions beyond Authenticated', async () => {
        await queryRunner.query(
            `UPDATE "role" SET "permissions" = 'Authenticated,ReadCatalog' WHERE "code" = '__customer_role__'`,
        );

        const preview = await previewRoleAssignmentMigration(queryRunner);

        expect(preview.customerRoleDroppedPermissions).toEqual(['ReadCatalog']);
    });

    it('reports held roles assigned to no channel', async () => {
        await queryRunner.query(
            `INSERT INTO "role" ("id", "code", "permissions") VALUES (4, 'orphan', 'ReadOrder')`,
        );
        await queryRunner.query(`INSERT INTO "user_roles_role" ("userId", "roleId") VALUES (2, 4), (6, 4)`);

        const preview = await previewRoleAssignmentMigration(queryRunner);

        expect(preview.rolesWithoutChannels).toEqual([{ roleId: '4', roleCode: 'orphan', holderCount: 2 }]);
        // their holders get no rows
        expect(preview.migration).toEqual({ userCount: 0, assignmentCount: 0 });
    });

    it('estimates the migration time from the number of rows', async () => {
        await queryRunner.query(`INSERT INTO "user_roles_role" ("userId", "roleId") VALUES (1, 1)`);
        const preview = await previewRoleAssignmentMigration(queryRunner);
        const withRows = (assignmentCount: number) =>
            formatRoleAssignmentMigrationPreview({
                ...preview,
                migration: { userCount: 1, assignmentCount },
            });

        expect(withRows(1)).toContain(
            '   Estimated migration time: under 1 second, at 80,000 rows per second',
        );
        expect(withRows(1_000_000)).toContain('about 13 seconds');
        expect(withRows(5_000_000)).toContain('about 63 seconds');
        expect(withRows(20_000_000)).toContain('about 4 minutes');
    });

    it('throws when the legacy tables no longer exist', async () => {
        await queryRunner.query(`DROP TABLE "user_roles_role"`);

        await expect(previewRoleAssignmentMigration(queryRunner)).rejects.toThrow(
            'Run previewRoleAssignmentMigration() before running the v4 migration',
        );
    });
});

describe('previewRoleAssignmentMigration() with an entityPrefix', () => {
    it('reads the prefixed tables', async () => {
        const dataSource = new DataSource({
            type: 'better-sqlite3',
            database: ':memory:',
            entityPrefix: 'vdr_',
        });
        await dataSource.initialize();
        const queryRunner = dataSource.createQueryRunner();
        await queryRunner.query(
            `CREATE TABLE "vdr_role" ("id" integer PRIMARY KEY, "code" varchar, "permissions" text)`,
        );
        await queryRunner.query(`CREATE TABLE "vdr_channel" ("id" integer PRIMARY KEY, "code" varchar)`);
        await queryRunner.query(
            `CREATE TABLE "vdr_customer" ("id" integer PRIMARY KEY, "deletedAt" datetime, "userId" integer)`,
        );
        await queryRunner.query(
            `CREATE TABLE "vdr_customer_channels_channel" ("customerId" integer, "channelId" integer)`,
        );
        await queryRunner.query(
            `CREATE TABLE "vdr_administrator" ("id" integer PRIMARY KEY, "deletedAt" datetime, "userId" integer)`,
        );
        await queryRunner.query(`CREATE TABLE "vdr_user_roles_role" ("userId" integer, "roleId" integer)`);
        await queryRunner.query(
            `CREATE TABLE "vdr_role_channels_channel" ("roleId" integer, "channelId" integer)`,
        );
        await queryRunner.query(`INSERT INTO "vdr_role" VALUES (2, '__customer_role__', 'Authenticated')`);
        await queryRunner.query(`INSERT INTO "vdr_channel" VALUES (1, '__default_channel__'), (2, 'second')`);
        await queryRunner.query(`INSERT INTO "vdr_role_channels_channel" VALUES (2, 1), (2, 2)`);
        await queryRunner.query(`INSERT INTO "vdr_user_roles_role" VALUES (3, 2)`);
        await queryRunner.query(`INSERT INTO "vdr_customer" VALUES (1, NULL, 3)`);
        await queryRunner.query(`INSERT INTO "vdr_customer_channels_channel" VALUES (1, 1)`);

        const preview = await previewRoleAssignmentMigration(queryRunner);

        expect(preview.customerChannelChanges).toEqual([
            { channelId: '2', channelCode: 'second', customersLosingAccess: 1, customersGainingAccess: 0 },
        ]);
        await queryRunner.release();
        await dataSource.destroy();
    });
});
