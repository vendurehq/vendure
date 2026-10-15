import { DataSource, QueryRunner } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    assertRoleAssignmentDataMigrated,
    ensureRoleAssignmentDataMigrated,
    migrateRoleAssignmentData,
    removeLegacyRoleData,
} from './v4_0_role_assignments';

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
            `CREATE TABLE "user" ("id" integer PRIMARY KEY AUTOINCREMENT, "identifier" varchar NOT NULL)`,
        );
        await queryRunner.query(
            `CREATE TABLE "administrator" ("id" integer PRIMARY KEY AUTOINCREMENT,
             "deletedAt" datetime, "userId" integer)`,
        );
        await queryRunner.query(
            `CREATE TABLE "user_roles_role" ("userId" integer NOT NULL, "roleId" integer NOT NULL,
             PRIMARY KEY ("userId", "roleId"),
             CONSTRAINT "FK_user_roles_role_role" FOREIGN KEY ("roleId") REFERENCES "role" ("id") ON DELETE CASCADE)`,
        );
        await queryRunner.query(
            `CREATE TABLE "role_channels_channel" ("roleId" integer NOT NULL, "channelId" integer NOT NULL,
             PRIMARY KEY ("roleId", "channelId"),
             CONSTRAINT "FK_role_channels_channel_role" FOREIGN KEY ("roleId") REFERENCES "role" ("id") ON DELETE CASCADE,
             CONSTRAINT "FK_role_channels_channel_channel" FOREIGN KEY ("channelId") REFERENCES "channel" ("id") ON DELETE CASCADE)`,
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
        // The SuperAdmin role is recorded on channels 1 and 2 (the legacy createChannel
        // mutation auto-assigned it); channel 3 was created programmatically and is missing.
        // Neither matters: the migration writes the SuperAdmin holder one default-channel row.
        await queryRunner.query(
            `INSERT INTO "channel" ("id", "code") VALUES
             (1, '__default_channel__'), (2, 'second'), (3, 'programmatic')`,
        );
        await queryRunner.query(
            `INSERT INTO "role_channels_channel" ("roleId", "channelId") VALUES
             (1, 1), (1, 2), (2, 1), (2, 2), (3, 2)`,
        );
        await queryRunner.query(
            `INSERT INTO "user" ("id", "identifier") VALUES
             (1, 'superadmin'), (2, 'sales-admin'), (3, 'customer-a'), (4, 'customer-b')`,
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

        expect(insertedCount).toBe(3);
        expect(await getAssignments()).toEqual([
            // the SuperAdmin holder gets a single row on the default channel
            { userId: 1, roleId: 1, channelId: 1 },
            { userId: 2, roleId: 3, channelId: 2 },
            { userId: 4, roleId: 3, channelId: 2 },
        ]);
    });

    it('is idempotent', async () => {
        await createSchema();
        await seedData();

        const firstRun = await migrateRoleAssignmentData(queryRunner);
        const secondRun = await migrateRoleAssignmentData(queryRunner);

        expect(firstRun).toBe(3);
        expect(secondRun).toBe(0);
        expect((await getAssignments()).length).toBe(3);
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

        expect(insertedCount).toBe(2);
        expect((await getAssignments()).filter(a => a.userId === 2)).toEqual([
            { userId: 2, roleId: 3, channelId: 2 },
        ]);
    });

    it('fails verification on a pre-existing row the legacy tables do not grant', async () => {
        await createSchema();
        await seedData();
        // e.g. copied by an earlier pass of a staged rollout, then revoked in the legacy tables
        await queryRunner.query(
            `INSERT INTO "role_assignment" ("userId", "roleId", "channelId") VALUES (2, 3, 1)`,
        );

        await expect(migrateRoleAssignmentData(queryRunner)).rejects.toThrow(
            /Would gain access \(present after the copy, not granted before v4\): 1 grant\(s\)\n {2}sales-admin: sales on __default_channel__/,
        );
        // Nothing destructive runs before a successful verification
        const customerRoles = await queryRunner.query(
            `SELECT "id" FROM "role" WHERE "code" = '__customer_role__'`,
        );
        expect(customerRoles.length).toBe(1);
        expect(await queryRunner.hasTable('user_roles_role')).toBe(true);
        expect(await queryRunner.hasTable('role_channels_channel')).toBe(true);
    });

    it('fails verification on a SuperAdmin row outside the default channel', async () => {
        await createSchema();
        await seedData();
        await queryRunner.query(
            `INSERT INTO "role_assignment" ("userId", "roleId", "channelId") VALUES (1, 1, 2)`,
        );

        await expect(migrateRoleAssignmentData(queryRunner)).rejects.toThrow(
            /Would gain access .*: 1 grant\(s\)\n {2}superadmin: __super_admin_role__ on second/,
        );
    });

    it('fails verification on a Customer role row', async () => {
        await createSchema();
        await seedData();
        await queryRunner.query(
            `INSERT INTO "role_assignment" ("userId", "roleId", "channelId") VALUES (3, 2, 1)`,
        );

        await expect(migrateRoleAssignmentData(queryRunner)).rejects.toThrow(
            /Would gain access .*: 1 grant\(s\)\n {2}customer-a: __customer_role__ on __default_channel__/,
        );
    });

    it('fails verification when grants go missing in the copy, naming the user', async () => {
        await createSchema();
        await seedData();
        // a faulty copy: inserts for the sales admin are silently dropped
        await queryRunner.query(
            `CREATE TRIGGER "drop_sales_admin" BEFORE INSERT ON "role_assignment"
             WHEN NEW."userId" = 2 BEGIN SELECT RAISE(IGNORE); END`,
        );

        await expect(migrateRoleAssignmentData(queryRunner)).rejects.toThrow(
            /Would lose access \(granted before v4, missing after the copy\): 1 grant\(s\)\n {2}sales-admin: sales on second/,
        );
        expect(await queryRunner.hasTable('user_roles_role')).toBe(true);
    });

    it('generates uuid primary keys when the id column has no database-side default', async () => {
        await createSchema({ idType: 'uuid' });
        await seedData();

        const insertedCount = await migrateRoleAssignmentData(queryRunner);

        expect(insertedCount).toBe(3);
        const rows: Array<{ id: string }> = await queryRunner.query(`SELECT "id" FROM "role_assignment"`);
        for (const row of rows) {
            expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        }
        expect(new Set(rows.map(row => row.id)).size).toBe(3);
    });

    it('creates the RoleEditor role without granting it to anyone', async () => {
        await createSchema();
        await seedData();

        await migrateRoleAssignmentData(queryRunner);

        const roleEditorRoles: Array<{ id: number; permissions: string }> = await queryRunner.query(
            `SELECT "id", "permissions" FROM "role" WHERE "code" = '__role_editor_role__'`,
        );
        expect(roleEditorRoles.length).toBe(1);
        expect(roleEditorRoles[0].permissions).toBe(
            'Authenticated,CreateRole,ReadRole,UpdateRole,DeleteRole',
        );
        const roleEditorAssignments = (await getAssignments()).filter(a => a.roleId === ROLE_EDITOR_ROLE_ID);
        expect(roleEditorAssignments).toEqual([]);
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
        expect((await getAssignments()).filter(a => a.roleId === 10)).toEqual([]);
    });

    it('keeps the Customer role row for the archive', async () => {
        await createSchema();
        await seedData();

        await migrateRoleAssignmentData(queryRunner);

        const customerRoles = await queryRunner.query(
            `SELECT "id" FROM "role" WHERE "code" = '__customer_role__'`,
        );
        expect(customerRoles).toEqual([{ id: 2 }]);
    });

    it('archives the legacy tables with all their rows and without foreign keys', async () => {
        await createSchema();
        await seedData();

        await migrateRoleAssignmentData(queryRunner);

        expect(await queryRunner.hasTable('user_roles_role')).toBe(false);
        expect(await queryRunner.hasTable('role_channels_channel')).toBe(false);
        // The Customer role's rows are part of the archive too
        expect(
            await queryRunner.query(`SELECT * FROM "_v3_user_roles_role" ORDER BY "userId", "roleId"`),
        ).toEqual([
            { userId: 1, roleId: 1 },
            { userId: 2, roleId: 3 },
            { userId: 3, roleId: 2 },
            { userId: 4, roleId: 2 },
            { userId: 4, roleId: 3 },
        ]);
        expect((await queryRunner.query(`SELECT * FROM "_v3_role_channels_channel"`)).length).toBe(5);
        expect((await queryRunner.getTable('_v3_user_roles_role'))?.foreignKeys).toEqual([]);
        expect((await queryRunner.getTable('_v3_role_channels_channel'))?.foreignKeys).toEqual([]);
        // Deleting a Role no longer cascades into the archive
        await queryRunner.query(`DELETE FROM "role" WHERE "id" = 3`);
        expect((await queryRunner.query(`SELECT * FROM "_v3_user_roles_role"`)).length).toBe(5);
    });

    // On MySQL each DDL statement commits on its own, so a run can stop after any of them.
    // The archive runs four: two foreign key drops, then two renames.
    it.each([1, 2, 3, 4])(
        'refuses to start and completes on a re-run after the archive stopped at DDL statement %i',
        async failingStatement => {
            await createSchema();
            await seedData();
            let statements = 0;
            const failAt = <T extends (...args: any[]) => Promise<any>>(original: T) =>
                (async (...args: Parameters<T>) => {
                    if (++statements === failingStatement) {
                        throw new Error('Connection lost');
                    }
                    return original(...args);
                }) as T;
            const originalDropForeignKeys = queryRunner.dropForeignKeys.bind(queryRunner);
            const originalRenameTable = queryRunner.renameTable.bind(queryRunner);
            const dropForeignKeys = vi
                .spyOn(queryRunner, 'dropForeignKeys')
                .mockImplementation(failAt(originalDropForeignKeys));
            const renameTable = vi
                .spyOn(queryRunner, 'renameTable')
                .mockImplementation(failAt(originalRenameTable));

            await expect(migrateRoleAssignmentData(queryRunner)).rejects.toThrow('Connection lost');
            dropForeignKeys.mockRestore();
            renameTable.mockRestore();

            await expect(assertRoleAssignmentDataMigrated(queryRunner)).rejects.toThrow();
            await migrateRoleAssignmentData(queryRunner);
            await expect(assertRoleAssignmentDataMigrated(queryRunner)).resolves.toBeUndefined();
            expect((await getAssignments()).length).toBe(3);
            expect(await queryRunner.hasTable('role_channels_channel')).toBe(false);
            expect((await queryRunner.getTable('_v3_user_roles_role'))?.foreignKeys).toEqual([]);
            expect((await queryRunner.getTable('_v3_role_channels_channel'))?.foreignKeys).toEqual([]);
        },
    );

    it('names the recovery when a previous run stopped between the two renames', async () => {
        await createSchema();
        await seedData();
        await queryRunner.renameTable('role_channels_channel', '_v3_role_channels_channel');

        await expect(assertRoleAssignmentDataMigrated(queryRunner)).rejects.toThrow(
            'A previous run of migrateRoleAssignmentData() stopped before archiving the user_roles_role table',
        );
    });

    it('completes a partially archived migration on startup when synchronize is enabled', async () => {
        await createSchema();
        await seedData();
        await queryRunner.renameTable('role_channels_channel', '_v3_role_channels_channel');

        expect(await ensureRoleAssignmentDataMigrated(queryRunner, { synchronize: true })).toBe(true);
        expect((await getAssignments()).length).toBe(3);
        expect(await queryRunner.hasTable('user_roles_role')).toBe(false);
    });

    it('throws when the archive table name is already taken', async () => {
        await createSchema();
        await seedData();
        await queryRunner.query(`CREATE TABLE "_v3_role_channels_channel" ("id" integer)`);

        await expect(migrateRoleAssignmentData(queryRunner)).rejects.toThrow(
            'Cannot archive role_channels_channel: a table named _v3_role_channels_channel already exists',
        );
    });

    it('skips migration when the legacy tables have been archived or dropped', async () => {
        await createSchema();
        await queryRunner.query(`DROP TABLE "user_roles_role"`);
        await queryRunner.query(`DROP TABLE "role_channels_channel"`);

        const insertedCount = await migrateRoleAssignmentData(queryRunner);

        expect(insertedCount).toBe(0);
    });

    it('throws when only one legacy table exists and there is no archive of the other', async () => {
        await createSchema();
        await queryRunner.query(`DROP TABLE "user_roles_role"`);

        await expect(migrateRoleAssignmentData(queryRunner)).rejects.toThrow(
            'Neither the user_roles_role table nor its archive _v3_user_roles_role exists',
        );
    });

    it('runs on startup when synchronize is enabled', async () => {
        await createSchema();
        await seedData();

        const migrated = await ensureRoleAssignmentDataMigrated(queryRunner, { synchronize: true });

        expect(migrated).toBe(true);
        expect((await getAssignments()).length).toBe(3);
        expect(await queryRunner.hasTable('_v3_user_roles_role')).toBe(true);
        expect(await ensureRoleAssignmentDataMigrated(queryRunner, { synchronize: true })).toBe(false);
    });

    it('refuses to start on unmigrated grants when synchronize is disabled', async () => {
        await createSchema();
        await seedData();

        await expect(ensureRoleAssignmentDataMigrated(queryRunner, { synchronize: false })).rejects.toThrow(
            'Run migrateRoleAssignmentData() from a database migration before starting Vendure v4',
        );
        expect(await getAssignments()).toEqual([]);
    });

    it('rolls back a failed migration on startup', async () => {
        await createSchema();
        await seedData();
        // a row the legacy tables do not grant fails the verification
        await queryRunner.query(
            `INSERT INTO "role_assignment" ("userId", "roleId", "channelId") VALUES (2, 3, 1)`,
        );

        await expect(ensureRoleAssignmentDataMigrated(queryRunner, { synchronize: true })).rejects.toThrow(
            'Role assignment verification failed',
        );
        expect(await getAssignments()).toEqual([{ userId: 2, roleId: 3, channelId: 1 }]);
        expect(await queryRunner.hasTable('user_roles_role')).toBe(true);
    });

    it('throws when the role_assignment table has not been created yet', async () => {
        await createSchema();
        await queryRunner.query(`DROP TABLE "role_assignment"`);

        await expect(migrateRoleAssignmentData(queryRunner)).rejects.toThrow(
            'The role_assignment table does not exist',
        );
    });
});

describe('removeLegacyRoleData()', () => {
    it('drops the archive tables and deletes the Customer role', async () => {
        const dataSource = new DataSource({ type: 'better-sqlite3', database: ':memory:' });
        await dataSource.initialize();
        const queryRunner = dataSource.createQueryRunner();
        await queryRunner.query(`CREATE TABLE "_v3_user_roles_role" ("userId" integer, "roleId" integer)`);
        await queryRunner.query(
            `CREATE TABLE "_v3_role_channels_channel" ("roleId" integer, "channelId" integer)`,
        );
        await queryRunner.query(`CREATE TABLE "role" ("id" integer PRIMARY KEY, "code" varchar NOT NULL)`);
        await queryRunner.query(
            `INSERT INTO "role" ("id", "code") VALUES (1, '__super_admin_role__'), (2, '__customer_role__')`,
        );

        await removeLegacyRoleData(queryRunner);

        expect(await queryRunner.hasTable('_v3_user_roles_role')).toBe(false);
        expect(await queryRunner.hasTable('_v3_role_channels_channel')).toBe(false);
        expect(await queryRunner.query(`SELECT "code" FROM "role"`)).toEqual([
            { code: '__super_admin_role__' },
        ]);
        await queryRunner.release();
        await dataSource.destroy();
    });

    it('skips missing tables and roles', async () => {
        const dataSource = new DataSource({ type: 'better-sqlite3', database: ':memory:' });
        await dataSource.initialize();
        const queryRunner = dataSource.createQueryRunner();
        await queryRunner.query(`CREATE TABLE "_v3_user_roles_role" ("userId" integer, "roleId" integer)`);

        await removeLegacyRoleData(queryRunner);
        await removeLegacyRoleData(queryRunner);

        expect(await queryRunner.hasTable('_v3_user_roles_role')).toBe(false);
        await queryRunner.release();
        await dataSource.destroy();
    });

    it.each([
        { state: 'not migrated', legacyTables: ['user_roles_role', 'role_channels_channel'] },
        { state: 'partially archived', legacyTables: ['role_channels_channel'] },
    ])('refuses to run when the legacy tables are $state', async ({ legacyTables }) => {
        const dataSource = new DataSource({ type: 'better-sqlite3', database: ':memory:' });
        await dataSource.initialize();
        const queryRunner = dataSource.createQueryRunner();
        for (const tableName of legacyTables) {
            await queryRunner.query(`CREATE TABLE "${tableName}" ("a" integer, "b" integer)`);
        }
        await queryRunner.query(`CREATE TABLE "role" ("id" integer PRIMARY KEY, "code" varchar NOT NULL)`);
        await queryRunner.query(`INSERT INTO "role" ("id", "code") VALUES (2, '__customer_role__')`);

        await expect(removeLegacyRoleData(queryRunner)).rejects.toThrow(
            'Run migrateRoleAssignmentData() before removeLegacyRoleData()',
        );

        expect(await queryRunner.query(`SELECT "code" FROM "role"`)).toEqual([{ code: '__customer_role__' }]);
        await queryRunner.release();
        await dataSource.destroy();
    });

    it('refuses to run while role_assignment holds Customer-role rows', async () => {
        const dataSource = new DataSource({ type: 'better-sqlite3', database: ':memory:' });
        await dataSource.initialize();
        const queryRunner = dataSource.createQueryRunner();
        await queryRunner.query(`CREATE TABLE "_v3_user_roles_role" ("userId" integer, "roleId" integer)`);
        await queryRunner.query(`CREATE TABLE "role" ("id" integer PRIMARY KEY, "code" varchar NOT NULL)`);
        await queryRunner.query(
            `CREATE TABLE "user" ("id" integer PRIMARY KEY, "identifier" varchar NOT NULL)`,
        );
        await queryRunner.query(`CREATE TABLE "channel" ("id" integer PRIMARY KEY, "code" varchar NOT NULL)`);
        await queryRunner.query(
            `CREATE TABLE "role_assignment" ("id" integer PRIMARY KEY, "userId" integer, "roleId" integer, "channelId" integer)`,
        );
        await queryRunner.query(
            `INSERT INTO "role" ("id", "code") VALUES (1, '__super_admin_role__'), (2, '__customer_role__')`,
        );
        await queryRunner.query(
            `INSERT INTO "user" ("id", "identifier") VALUES (1, 'superadmin'), (2, 'alice')`,
        );
        await queryRunner.query(`INSERT INTO "channel" ("id", "code") VALUES (1, '__default_channel__')`);
        await queryRunner.query(
            `INSERT INTO "role_assignment" ("id", "userId", "roleId", "channelId") VALUES (1, 1, 1, 1), (2, 2, 2, 1)`,
        );

        const error = await removeLegacyRoleData(queryRunner).catch((e: Error) => e);

        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('holds 1 assignment(s) of the legacy Customer role');
        expect((error as Error).message).toContain('alice: __customer_role__ on __default_channel__');
        expect(await queryRunner.hasTable('_v3_user_roles_role')).toBe(true);
        expect(await queryRunner.query(`SELECT "code" FROM "role" ORDER BY "id"`)).toEqual([
            { code: '__super_admin_role__' },
            { code: '__customer_role__' },
        ]);

        await queryRunner.query(`DELETE FROM "role_assignment" WHERE "id" = 2`);
        await removeLegacyRoleData(queryRunner);

        expect(await queryRunner.hasTable('_v3_user_roles_role')).toBe(false);
        expect(await queryRunner.query(`SELECT "code" FROM "role"`)).toEqual([
            { code: '__super_admin_role__' },
        ]);
        expect(await queryRunner.query(`SELECT "id" FROM "role_assignment"`)).toEqual([{ id: 1 }]);
        await queryRunner.release();
        await dataSource.destroy();
    });
});

describe('assertRoleAssignmentDataMigrated()', () => {
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

    it('passes on a fresh v4 database', async () => {
        await expect(assertRoleAssignmentDataMigrated(queryRunner)).resolves.toBeUndefined();
    });

    it('passes when the legacy table is empty', async () => {
        await queryRunner.query(`CREATE TABLE "user_roles_role" ("userId" integer, "roleId" integer)`);

        await expect(assertRoleAssignmentDataMigrated(queryRunner)).resolves.toBeUndefined();
    });

    it('throws while the legacy table holds unmigrated grants', async () => {
        await queryRunner.query(`CREATE TABLE "user_roles_role" ("userId" integer, "roleId" integer)`);
        await queryRunner.query(`INSERT INTO "user_roles_role" VALUES (1, 1)`);

        await expect(assertRoleAssignmentDataMigrated(queryRunner)).rejects.toThrow(
            'Run migrateRoleAssignmentData() from a database migration before starting Vendure v4',
        );
    });
});

describe('migrateRoleAssignmentData() with an entityPrefix', () => {
    it('reads, writes and archives the prefixed tables', async () => {
        const dataSource = new DataSource({
            type: 'better-sqlite3',
            database: ':memory:',
            entityPrefix: 'vdr_',
        });
        await dataSource.initialize();
        const queryRunner = dataSource.createQueryRunner();
        await queryRunner.query(
            `CREATE TABLE "vdr_role" ("id" integer PRIMARY KEY AUTOINCREMENT,
             "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
             "updatedAt" datetime NOT NULL DEFAULT (datetime('now')),
             "code" varchar NOT NULL, "description" varchar NOT NULL, "permissions" text NOT NULL)`,
        );
        await queryRunner.query(
            `CREATE TABLE "vdr_channel" ("id" integer PRIMARY KEY AUTOINCREMENT, "code" varchar NOT NULL)`,
        );
        await queryRunner.query(`CREATE TABLE "vdr_user_roles_role" ("userId" integer, "roleId" integer)`);
        await queryRunner.query(
            `CREATE TABLE "vdr_role_channels_channel" ("roleId" integer, "channelId" integer)`,
        );
        await queryRunner.query(
            `CREATE TABLE "vdr_role_assignment" ("id" integer PRIMARY KEY AUTOINCREMENT,
             "userId" integer NOT NULL, "roleId" integer NOT NULL, "channelId" integer NOT NULL)`,
        );
        await queryRunner.query(
            `INSERT INTO "vdr_role" ("id", "code", "description", "permissions") VALUES
             (1, '__super_admin_role__', 'SuperAdmin', 'SuperAdmin'), (3, 'sales', 'Sales', 'ReadOrder')`,
        );
        await queryRunner.query(
            `INSERT INTO "vdr_channel" ("id", "code") VALUES (1, '__default_channel__'), (2, 'second')`,
        );
        await queryRunner.query(`INSERT INTO "vdr_role_channels_channel" VALUES (1, 1), (3, 2)`);
        await queryRunner.query(`INSERT INTO "vdr_user_roles_role" VALUES (1, 1), (2, 3)`);

        const insertedCount = await migrateRoleAssignmentData(queryRunner);

        expect(insertedCount).toBe(2);
        expect(
            await queryRunner.query(
                `SELECT "userId", "roleId", "channelId" FROM "vdr_role_assignment" ORDER BY "userId"`,
            ),
        ).toEqual([
            { userId: 1, roleId: 1, channelId: 1 },
            { userId: 2, roleId: 3, channelId: 2 },
        ]);
        expect(await queryRunner.hasTable('vdr__v3_user_roles_role')).toBe(true);
        expect(await queryRunner.hasTable('vdr__v3_role_channels_channel')).toBe(true);
        await expect(assertRoleAssignmentDataMigrated(queryRunner)).resolves.toBeUndefined();
        await queryRunner.release();
        await dataSource.destroy();
    });
});
