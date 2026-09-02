import { DataSource, QueryRunner } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { migrateRoleAssignmentData } from './v4_0_role_assignments';

describe('migrateRoleAssignmentData()', () => {
    let dataSource: DataSource;
    let queryRunner: QueryRunner;

    beforeEach(async () => {
        dataSource = new DataSource({ type: 'better-sqlite3', database: ':memory:' });
        await dataSource.initialize();
        queryRunner = dataSource.createQueryRunner();
    });

    afterEach(async () => {
        await queryRunner.release();
        await dataSource.destroy();
    });

    async function createSchema(options: { idType: 'increment' | 'uuid' } = { idType: 'increment' }) {
        await queryRunner.query(
            `CREATE TABLE "role" ("id" integer PRIMARY KEY AUTOINCREMENT,
             "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
             "updatedAt" datetime NOT NULL DEFAULT (datetime('now')),
             "code" varchar NOT NULL, "description" varchar NOT NULL, "permissions" text NOT NULL)`,
        );
        await queryRunner.query(
            `CREATE TABLE "channel" ("id" integer PRIMARY KEY AUTOINCREMENT, "code" varchar NOT NULL)`,
        );
        await queryRunner.query(
            `CREATE TABLE "administrator" ("id" integer PRIMARY KEY AUTOINCREMENT,
             "deletedAt" datetime, "userId" integer)`,
        );
        await queryRunner.query(
            `CREATE TABLE "user_roles_role" ("userId" integer NOT NULL, "roleId" integer NOT NULL,
             PRIMARY KEY ("userId", "roleId"))`,
        );
        await queryRunner.query(
            `CREATE TABLE "role_channels_channel" ("roleId" integer NOT NULL, "channelId" integer NOT NULL,
             PRIMARY KEY ("roleId", "channelId"))`,
        );
        const idColumn =
            options.idType === 'increment'
                ? `"id" integer PRIMARY KEY AUTOINCREMENT`
                : `"id" varchar PRIMARY KEY NOT NULL`;
        await queryRunner.query(
            `CREATE TABLE "role_assignment" (${idColumn},
             "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
             "updatedAt" datetime NOT NULL DEFAULT (datetime('now')),
             "userId" integer NOT NULL, "roleId" integer NOT NULL, "channelId" integer NOT NULL,
             CONSTRAINT "IDX_ROLE_ASSIGNMENT_USER_ROLE_CHANNEL" UNIQUE ("userId", "roleId", "channelId"))`,
        );
    }

    async function seedData() {
        await queryRunner.query(
            `INSERT INTO "role" ("id", "code", "description", "permissions") VALUES
             (1, '__super_admin_role__', 'SuperAdmin', 'SuperAdmin'),
             (2, '__customer_role__', 'Customer', 'Authenticated'),
             (3, 'sales', 'Sales', 'Authenticated,ReadOrder')`,
        );
        // Channel 3 is deliberately missing from role_channels_channel for the SuperAdmin
        // role, simulating a channel created programmatically via ChannelService.create()
        await queryRunner.query(
            `INSERT INTO "channel" ("id", "code") VALUES
             (1, '__default_channel__'), (2, 'second'), (3, 'programmatic')`,
        );
        await queryRunner.query(
            `INSERT INTO "role_channels_channel" ("roleId", "channelId") VALUES
             (1, 1), (1, 2), (2, 1), (2, 2), (3, 2)`,
        );
        // user 1: superadmin, user 2: sales admin, user 3: customer,
        // user 4: customer who also holds the sales role (but is not an administrator)
        await queryRunner.query(
            `INSERT INTO "user_roles_role" ("userId", "roleId") VALUES
             (1, 1), (2, 3), (3, 2), (4, 2), (4, 3)`,
        );
        await queryRunner.query(
            `INSERT INTO "administrator" ("id", "userId", "deletedAt") VALUES
             (1, 1, NULL), (2, 2, NULL)`,
        );
    }

    // The id the RoleEditor role row created by the migration receives via AUTOINCREMENT
    const ROLE_EDITOR_ROLE_ID = 4;

    async function getAssignments(): Promise<Array<{ userId: number; roleId: number; channelId: number }>> {
        return queryRunner.query(
            `SELECT "userId", "roleId", "channelId" FROM "role_assignment"
             ORDER BY "userId", "roleId", "channelId"`,
        );
    }

    it('migrates the cross product of roles and channels, excluding the customer role', async () => {
        await createSchema();
        await seedData();

        const insertedCount = await migrateRoleAssignmentData(queryRunner);

        expect(insertedCount).toBe(6);
        expect(await getAssignments()).toEqual([
            { userId: 1, roleId: 1, channelId: 1 },
            { userId: 1, roleId: 1, channelId: 2 },
            // channel 3 comes from the SuperAdmin fan-out to all channels
            { userId: 1, roleId: 1, channelId: 3 },
            { userId: 2, roleId: 3, channelId: 2 },
            // the RoleEditor backfill for the sales administrator
            { userId: 2, roleId: ROLE_EDITOR_ROLE_ID, channelId: 2 },
            { userId: 4, roleId: 3, channelId: 2 },
        ]);
    });

    it('is idempotent', async () => {
        await createSchema();
        await seedData();

        const firstRun = await migrateRoleAssignmentData(queryRunner);
        const secondRun = await migrateRoleAssignmentData(queryRunner);

        expect(firstRun).toBe(6);
        expect(secondRun).toBe(0);
        expect((await getAssignments()).length).toBe(6);
        const roleEditorRoles: Array<{ id: number }> = await queryRunner.query(
            `SELECT "id" FROM "role" WHERE "code" = '__role_editor_role__'`,
        );
        expect(roleEditorRoles.length).toBe(1);
        const superAdminRoles: Array<{ permissions: string }> = await queryRunner.query(
            `SELECT "permissions" FROM "role" WHERE "code" = '__super_admin_role__'`,
        );
        // The Role CRUD permissions are appended exactly once
        expect(superAdminRoles[0].permissions).toBe('SuperAdmin,CreateRole,ReadRole,UpdateRole,DeleteRole');
    });

    it('appends the Role CRUD permissions to the SuperAdmin role', async () => {
        await createSchema();
        await seedData();
        // A legacy-shaped SuperAdmin role carries the expanded permission list which
        // pre-v4 versions re-synced on boot; simulate a shortened variant of it
        await queryRunner.query(
            `UPDATE "role" SET "permissions" = 'Authenticated,SuperAdmin,ReadCatalog,ReadRole'
             WHERE "code" = '__super_admin_role__'`,
        );

        await migrateRoleAssignmentData(queryRunner);

        const superAdminRoles: Array<{ permissions: string }> = await queryRunner.query(
            `SELECT "permissions" FROM "role" WHERE "code" = '__super_admin_role__'`,
        );
        // Only the missing Role CRUD permissions are appended; existing entries are kept
        expect(superAdminRoles[0].permissions).toBe(
            'Authenticated,SuperAdmin,ReadCatalog,ReadRole,CreateRole,UpdateRole,DeleteRole',
        );
    });

    it('leaves pre-existing assignments as-is', async () => {
        await createSchema();
        await seedData();
        await queryRunner.query(
            `INSERT INTO "role_assignment" ("userId", "roleId", "channelId") VALUES (2, 3, 2)`,
        );

        const insertedCount = await migrateRoleAssignmentData(queryRunner);

        expect(insertedCount).toBe(5);
        expect((await getAssignments()).filter(a => a.userId === 2)).toEqual([
            { userId: 2, roleId: 3, channelId: 2 },
            { userId: 2, roleId: ROLE_EDITOR_ROLE_ID, channelId: 2 },
        ]);
    });

    it('generates uuid primary keys when the id column has no database-side default', async () => {
        await createSchema({ idType: 'uuid' });
        await seedData();

        const insertedCount = await migrateRoleAssignmentData(queryRunner);

        expect(insertedCount).toBe(6);
        const rows: Array<{ id: string }> = await queryRunner.query(`SELECT "id" FROM "role_assignment"`);
        for (const row of rows) {
            expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        }
        expect(new Set(rows.map(row => row.id)).size).toBe(6);
    });

    it('backfills the RoleEditor role, skipping SuperAdmin holders and deleted administrators', async () => {
        await createSchema();
        await seedData();
        // user 5: administrator with the sales role whose administrator row is soft-deleted
        await queryRunner.query(`INSERT INTO "user_roles_role" ("userId", "roleId") VALUES (5, 3)`);
        await queryRunner.query(
            `INSERT INTO "administrator" ("id", "userId", "deletedAt") VALUES (3, 5, datetime('now'))`,
        );

        await migrateRoleAssignmentData(queryRunner);

        const roleEditorRoles: Array<{ id: number; permissions: string }> = await queryRunner.query(
            `SELECT "id", "permissions" FROM "role" WHERE "code" = '__role_editor_role__'`,
        );
        expect(roleEditorRoles.length).toBe(1);
        expect(roleEditorRoles[0].permissions).toBe(
            'Authenticated,CreateRole,ReadRole,UpdateRole,DeleteRole',
        );
        const roleEditorAssignments = (await getAssignments()).filter(a => a.roleId === ROLE_EDITOR_ROLE_ID);
        // Only the sales administrator (user 2): the superadmin (user 1) is covered by the
        // check-time bypass, users 3 & 4 are not administrators, and user 5 is deleted.
        expect(roleEditorAssignments).toEqual([{ userId: 2, roleId: ROLE_EDITOR_ROLE_ID, channelId: 2 }]);
    });

    it('reuses an existing RoleEditor role row', async () => {
        await createSchema();
        await seedData();
        await queryRunner.query(
            `INSERT INTO "role" ("id", "code", "description", "permissions") VALUES
             (10, '__role_editor_role__', 'RoleEditor', 'Authenticated,CreateRole,ReadRole,UpdateRole,DeleteRole')`,
        );

        await migrateRoleAssignmentData(queryRunner);

        const roleEditorRoles: Array<{ id: number }> = await queryRunner.query(
            `SELECT "id" FROM "role" WHERE "code" = '__role_editor_role__'`,
        );
        expect(roleEditorRoles).toEqual([{ id: 10 }]);
        expect((await getAssignments()).filter(a => a.roleId === 10)).toEqual([
            { userId: 2, roleId: 10, channelId: 2 },
        ]);
    });

    it('deletes the Customer role row and its legacy join rows', async () => {
        await createSchema();
        await seedData();

        await migrateRoleAssignmentData(queryRunner);

        const customerRoles = await queryRunner.query(
            `SELECT "id" FROM "role" WHERE "code" = '__customer_role__'`,
        );
        expect(customerRoles).toEqual([]);
        // The legacy join rows referencing the role go first (FK order); both tables are
        // dropped by the surrounding migration right after the helper returns.
        expect(await queryRunner.query(`SELECT * FROM "user_roles_role" WHERE "roleId" = 2`)).toEqual([]);
        expect(await queryRunner.query(`SELECT * FROM "role_channels_channel" WHERE "roleId" = 2`)).toEqual(
            [],
        );
    });

    it('skips migration when the old join tables no longer exist', async () => {
        await createSchema();
        await queryRunner.query(`DROP TABLE "user_roles_role"`);

        const insertedCount = await migrateRoleAssignmentData(queryRunner);

        expect(insertedCount).toBe(0);
    });

    it('throws when the role_assignment table has not been created yet', async () => {
        await createSchema();
        await queryRunner.query(`DROP TABLE "role_assignment"`);

        await expect(migrateRoleAssignmentData(queryRunner)).rejects.toThrow(
            'The role_assignment table does not exist',
        );
    });
});
