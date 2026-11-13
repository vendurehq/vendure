import { DataSource, QueryRunner } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    assertRoleAssignmentDataMigrated,
    ensureRoleAssignmentDataMigrated,
    hasLegacyRoleTables,
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
             "code" varchar NOT NULL, "description" varchar NOT NULL, "permissions" text NOT NULL,
             "channelId" integer)`,
        );
        await queryRunner.query(
            `CREATE TABLE "channel" ("id" integer PRIMARY KEY AUTOINCREMENT, "code" varchar NOT NULL)`,
        );
        await queryRunner.query(
            `CREATE TABLE "user" ("id" integer PRIMARY KEY AUTOINCREMENT, "identifier" varchar NOT NULL,
             "deletedAt" datetime)`,
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

    /**
     * Inserts role_assignment rows as a v4 server writes them after the copy: with a later
     * createdAt than the copied rows.
     */
    async function insertWrittenOnV4(values: string) {
        await queryRunner.query(
            `INSERT INTO "role_assignment" ("userId", "roleId", "channelId", "createdAt")
             SELECT v."column1", v."column2", v."column3", datetime('now', '+1 minute')
             FROM (VALUES ${values}) v`,
        );
    }

    function loggedLine(log: { mock: { calls: unknown[][] } }, prefix: string): string | undefined {
        return log.mock.calls.map(call => String(call[0])).find(line => line.startsWith(prefix));
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

    async function getRoleOwners(): Promise<Array<{ code: string; channelId: number | null }>> {
        return queryRunner.query(`SELECT "code", "channelId" FROM "role" ORDER BY "id"`);
    }

    it('gives a Role on one Channel that Channel as its owner, and every other Role the default Channel', async () => {
        await createSchema();
        await seedData();
        await queryRunner.query(
            `INSERT INTO "role" ("id", "code", "description", "permissions") VALUES
             (10, 'default-only', 'Default only', 'Authenticated,ReadOrder'),
             (11, 'nowhere', 'Nowhere', 'Authenticated,ReadOrder')`,
        );
        await queryRunner.query(`INSERT INTO "role_channels_channel" ("roleId", "channelId") VALUES (10, 1)`);

        await migrateRoleAssignmentData(queryRunner);

        expect(await getRoleOwners()).toEqual([
            // on channels 1 and 2: shared
            { code: '__super_admin_role__', channelId: 1 },
            { code: '__customer_role__', channelId: 1 },
            // on channel 2 only: private to it
            { code: 'sales', channelId: 2 },
            { code: 'default-only', channelId: 1 },
            // on no channel: shared
            { code: 'nowhere', channelId: 1 },
            // created by the migration
            { code: '__role_editor_role__', channelId: 1 },
        ]);
    });

    it('keeps an owner which is already set', async () => {
        await createSchema();
        await seedData();
        await queryRunner.query(`UPDATE "role" SET "channelId" = 3 WHERE "code" = 'sales'`);

        await migrateRoleAssignmentData(queryRunner);

        expect((await getRoleOwners()).find(role => role.code === 'sales')).toEqual({
            code: 'sales',
            channelId: 3,
        });
    });

    it('refuses to run before the role.channelId column has been added', async () => {
        await createSchema();
        await seedData();
        await queryRunner.query(`ALTER TABLE "role" DROP COLUMN "channelId"`);

        await expect(migrateRoleAssignmentData(queryRunner)).rejects.toThrow(
            'The role table has no channelId column',
        );
    });

    it('writes no rows for soft-deleted users', async () => {
        await createSchema();
        await seedData();
        await queryRunner.query(`UPDATE "user" SET "deletedAt" = datetime('now') WHERE "id" IN (1, 2)`);

        await migrateRoleAssignmentData(queryRunner);

        // users 1 (SuperAdmin) and 2 (sales admin) are soft-deleted
        expect(await getAssignments()).toEqual([{ userId: 4, roleId: 3, channelId: 2 }]);
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

    it('leaves the legacy tables as they are, updates the system Roles and records the copy', async () => {
        await createSchema();
        await seedData();

        await migrateRoleAssignmentData(queryRunner);

        expect(await hasLegacyRoleTables(queryRunner)).toBe(true);
        expect(await queryRunner.hasTable('role_channels_channel')).toBe(true);
        expect((await queryRunner.query(`SELECT * FROM "user_roles_role"`)).length).toBe(5);
        expect(await queryRunner.query(`SELECT "code", "permissions" FROM "role" ORDER BY "id"`)).toEqual([
            {
                code: '__super_admin_role__',
                permissions: 'SuperAdmin,CreateRole,ReadRole,UpdateRole,DeleteRole',
            },
            { code: '__customer_role__', permissions: 'Authenticated' },
            { code: 'sales', permissions: 'Authenticated,ReadOrder' },
            {
                code: '__role_editor_role__',
                permissions: 'Authenticated,CreateRole,ReadRole,UpdateRole,DeleteRole',
            },
        ]);
        expect(await queryRunner.query(`SELECT "id" FROM "role_assignment_migration"`)).toEqual([{ id: 1 }]);
    });

    it('lets v4 start once the copy is recorded, while the legacy tables exist', async () => {
        await createSchema();
        await seedData();
        await expect(assertRoleAssignmentDataMigrated(queryRunner)).rejects.toThrow();

        await migrateRoleAssignmentData(queryRunner);

        await expect(assertRoleAssignmentDataMigrated(queryRunner)).resolves.toBeUndefined();
        await expect(ensureRoleAssignmentDataMigrated(queryRunner, { synchronize: false })).resolves.toBe(
            false,
        );
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

    it('fails verification on a row the legacy tables do not grant, and records no copy', async () => {
        await createSchema();
        await seedData();
        await queryRunner.query(
            `INSERT INTO "role_assignment" ("userId", "roleId", "channelId") VALUES (2, 3, 1)`,
        );

        await expect(migrateRoleAssignmentData(queryRunner)).rejects.toThrow(
            /Would gain access \(present after the copy, not granted before v4\): 1 grant\(s\)\n {2}sales-admin: sales on __default_channel__/,
        );
        await expect(assertRoleAssignmentDataMigrated(queryRunner)).rejects.toThrow();
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
        expect(await queryRunner.hasTable('role_assignment_migration')).toBe(false);
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

    it('skips migration when the legacy tables have been dropped', async () => {
        await createSchema();
        await queryRunner.query(`DROP TABLE "user_roles_role"`);
        await queryRunner.query(`DROP TABLE "role_channels_channel"`);

        const insertedCount = await migrateRoleAssignmentData(queryRunner);

        expect(insertedCount).toBe(0);
    });

    it('throws when only role_channels_channel exists', async () => {
        await createSchema();
        await queryRunner.query(`DROP TABLE "user_roles_role"`);

        await expect(migrateRoleAssignmentData(queryRunner)).rejects.toThrow(
            'The user_roles_role table does not exist, but role_channels_channel does',
        );
    });

    it('throws when only user_roles_role exists and no copy was recorded', async () => {
        await createSchema();
        await seedData();
        await queryRunner.query(`DROP TABLE "role_channels_channel"`);

        await expect(migrateRoleAssignmentData(queryRunner)).rejects.toThrow(
            'The role_channels_channel table does not exist, but user_roles_role does',
        );
    });

    it('runs both steps on startup when synchronize is enabled', async () => {
        await createSchema();
        await seedData();

        const migrated = await ensureRoleAssignmentDataMigrated(queryRunner, { synchronize: true });

        expect(migrated).toBe(true);
        expect((await getAssignments()).length).toBe(3);
        expect(await queryRunner.hasTable('user_roles_role')).toBe(false);
        expect(await queryRunner.hasTable('role_assignment_migration')).toBe(false);
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
        // a faulty copy: inserts for the sales admin are silently dropped
        await queryRunner.query(
            `CREATE TRIGGER "drop_sales_admin" BEFORE INSERT ON "role_assignment"
             WHEN NEW."userId" = 2 BEGIN SELECT RAISE(IGNORE); END`,
        );

        await expect(ensureRoleAssignmentDataMigrated(queryRunner, { synchronize: true })).rejects.toThrow(
            'Role assignment verification failed',
        );
        expect(await getAssignments()).toEqual([]);
        expect(await queryRunner.hasTable('user_roles_role')).toBe(true);
    });

    describe('removeLegacyRoleData()', () => {
        it('drops the legacy tables and the copy record, and deletes the Customer role', async () => {
            await createSchema();
            await seedData();
            await migrateRoleAssignmentData(queryRunner);

            await removeLegacyRoleData(queryRunner);

            expect(await queryRunner.hasTable('user_roles_role')).toBe(false);
            expect(await queryRunner.hasTable('role_channels_channel')).toBe(false);
            expect(await queryRunner.hasTable('role_assignment_migration')).toBe(false);
            expect(await queryRunner.query(`SELECT "code" FROM "role" ORDER BY "id"`)).toEqual([
                { code: '__super_admin_role__' },
                { code: 'sales' },
                { code: '__role_editor_role__' },
            ]);
            expect((await getAssignments()).length).toBe(3);
            await expect(assertRoleAssignmentDataMigrated(queryRunner)).resolves.toBeUndefined();
        });

        it('is idempotent', async () => {
            await createSchema();
            await seedData();
            await migrateRoleAssignmentData(queryRunner);

            await removeLegacyRoleData(queryRunner);
            await removeLegacyRoleData(queryRunner);

            expect((await getAssignments()).length).toBe(3);
            expect(await migrateRoleAssignmentData(queryRunner)).toBe(0);
        });

        it('deletes the copied grants revoked on v3 and keeps the rows written on v4', async () => {
            await createSchema();
            await seedData();
            await migrateRoleAssignmentData(queryRunner);
            // On a v3 server: the sales admin loses the sales role
            await queryRunner.query(`DELETE FROM "user_roles_role" WHERE "userId" = 2 AND "roleId" = 3`);
            // On a v4 server: the customer who holds the sales role also gets it on channel 3,
            // which the legacy tables do not grant
            await insertWrittenOnV4('(4, 3, 3)');
            const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

            await removeLegacyRoleData(queryRunner);

            expect(await getAssignments()).toEqual([
                { userId: 1, roleId: 1, channelId: 1 },
                { userId: 4, roleId: 3, channelId: 2 },
                { userId: 4, roleId: 3, channelId: 3 },
            ]);
            const deletion = loggedLine(log, 'Deleted');
            expect(deletion).toContain('Deleted 1 role assignment(s)');
            expect(deletion).toContain('sales-admin: sales on second');
            expect(loggedLine(log, 'Not applied')).toBeUndefined();
            log.mockRestore();
        });

        it('gives the Roles created on v3 since the copy their owner before dropping the tables', async () => {
            await createSchema();
            await seedData();
            await migrateRoleAssignmentData(queryRunner);
            // On a v3 server, which does not know role.channelId: two Roles are created and
            // assigned to channels
            await queryRunner.query(
                `INSERT INTO "role" ("id", "code", "description", "permissions") VALUES
                 (20, 'v3-private', 'v3 private', 'Authenticated,ReadOrder'),
                 (21, 'v3-multi', 'v3 multi', 'Authenticated,ReadOrder')`,
            );
            await queryRunner.query(
                `INSERT INTO "role_channels_channel" ("roleId", "channelId") VALUES (20, 3), (21, 2), (21, 3)`,
            );
            const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

            await removeLegacyRoleData(queryRunner);

            log.mockRestore();
            const owners = await getRoleOwners();
            expect(owners.find(role => role.code === 'v3-private')?.channelId).toBe(3);
            expect(owners.find(role => role.code === 'v3-multi')?.channelId).toBe(1);
            expect(owners.every(role => role.channelId != null)).toBe(true);
        });

        it('deletes the copied rows of a user soft-deleted on v3 since the copy', async () => {
            await createSchema();
            await seedData();
            await migrateRoleAssignmentData(queryRunner);
            // On a v3 server: the sales admin is deleted, and v3 keeps their user_roles_role rows
            await queryRunner.query(`UPDATE "user" SET "deletedAt" = datetime('now') WHERE "id" = 2`);
            const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

            await removeLegacyRoleData(queryRunner);

            log.mockRestore();
            expect((await getAssignments()).filter(a => a.userId === 2)).toEqual([]);
        });

        it('reports the grants it cannot attribute and does not apply them', async () => {
            await createSchema();
            await seedData();
            await migrateRoleAssignmentData(queryRunner);
            // On a v4 server: the sales admin loses the sales role
            await queryRunner.query(`DELETE FROM "role_assignment" WHERE "userId" = 2`);
            // On a v3 server: the sales role is assigned to channel 3
            await queryRunner.query(
                `INSERT INTO "role_channels_channel" ("roleId", "channelId") VALUES (3, 3)`,
            );
            const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

            await removeLegacyRoleData(queryRunner);

            expect(await getAssignments()).toEqual([
                { userId: 1, roleId: 1, channelId: 1 },
                { userId: 4, roleId: 3, channelId: 2 },
            ]);
            const report = loggedLine(log, 'Not applied');
            expect(report).toContain('Not applied: 3 grant(s)');
            expect(report).toContain('sales-admin: sales on second, programmatic');
            expect(report).toContain('customer-b: sales on programmatic');
            log.mockRestore();
        });

        it('refuses to run before migrateRoleAssignmentData()', async () => {
            await createSchema();
            await seedData();

            await expect(removeLegacyRoleData(queryRunner)).rejects.toThrow(
                'Call migrateRoleAssignmentData() before removeLegacyRoleData()',
            );
            expect(await queryRunner.hasTable('user_roles_role')).toBe(true);
        });

        // On MySQL each DDL statement commits on its own, so a run can stop after any of them.
        // The grants are reconciled before the first drop, and v4 keeps starting throughout.
        it.each([1, 2, 3])(
            'completes on a re-run after the drop stopped at DDL statement %i',
            async failingStatement => {
                await createSchema();
                await seedData();
                await migrateRoleAssignmentData(queryRunner);
                let statements = 0;
                const originalDropTable = queryRunner.dropTable.bind(queryRunner);
                const dropTable = vi
                    .spyOn(queryRunner, 'dropTable')
                    .mockImplementation(async (...args: Parameters<typeof originalDropTable>) => {
                        if (++statements === failingStatement) {
                            throw new Error('Connection lost');
                        }
                        return originalDropTable(...args);
                    });

                await expect(removeLegacyRoleData(queryRunner)).rejects.toThrow('Connection lost');
                dropTable.mockRestore();

                await expect(assertRoleAssignmentDataMigrated(queryRunner)).resolves.toBeUndefined();
                await removeLegacyRoleData(queryRunner);
                expect((await getAssignments()).length).toBe(3);
                expect(await queryRunner.hasTable('user_roles_role')).toBe(false);
                expect(await queryRunner.hasTable('role_channels_channel')).toBe(false);
                expect(await queryRunner.hasTable('role_assignment_migration')).toBe(false);
                expect(
                    await queryRunner.query(`SELECT 1 FROM "role" WHERE "code" = '__customer_role__'`),
                ).toEqual([]);
            },
        );

        it('completes a partly dropped run on startup when synchronize is enabled', async () => {
            await createSchema();
            await seedData();
            await migrateRoleAssignmentData(queryRunner);
            await queryRunner.dropTable('role_channels_channel');

            expect(await ensureRoleAssignmentDataMigrated(queryRunner, { synchronize: true })).toBe(true);
            expect((await getAssignments()).length).toBe(3);
            expect(await queryRunner.hasTable('user_roles_role')).toBe(false);
        });

        it('refuses to delete the Customer role while role_assignment holds rows of it', async () => {
            await createSchema();
            await seedData();
            await migrateRoleAssignmentData(queryRunner);
            await insertWrittenOnV4('(3, 2, 1)');

            await expect(removeLegacyRoleData(queryRunner)).rejects.toThrow(
                /holds 1 assignment\(s\) of the legacy Customer role[\s\S]*customer-a: __customer_role__ on __default_channel__/,
            );
            expect(
                await queryRunner.query(`SELECT "id" FROM "role" WHERE "code" = '__customer_role__'`),
            ).toEqual([{ id: 2 }]);

            await queryRunner.query(`DELETE FROM "role_assignment" WHERE "userId" = 3`);
            await removeLegacyRoleData(queryRunner);
            expect(
                await queryRunner.query(`SELECT "id" FROM "role" WHERE "code" = '__customer_role__'`),
            ).toEqual([]);
        });

        it('skips the copy once the legacy tables are gone', async () => {
            await createSchema();
            await seedData();
            await migrateRoleAssignmentData(queryRunner);
            await removeLegacyRoleData(queryRunner);

            expect(await migrateRoleAssignmentData(queryRunner)).toBe(0);
        });
    });

    it('throws when the role_assignment table has not been created yet', async () => {
        await createSchema();
        await queryRunner.query(`DROP TABLE "role_assignment"`);

        await expect(migrateRoleAssignmentData(queryRunner)).rejects.toThrow(
            'The role_assignment table does not exist',
        );
        await expect(removeLegacyRoleData(queryRunner)).rejects.toThrow(
            'The role_assignment table does not exist',
        );
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
    it('reads, writes and drops the prefixed tables', async () => {
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
             "code" varchar NOT NULL, "description" varchar NOT NULL, "permissions" text NOT NULL,
             "channelId" integer)`,
        );
        await queryRunner.query(
            `CREATE TABLE "vdr_channel" ("id" integer PRIMARY KEY AUTOINCREMENT, "code" varchar NOT NULL)`,
        );
        await queryRunner.query(
            `CREATE TABLE "vdr_user" ("id" integer PRIMARY KEY, "identifier" varchar, "deletedAt" datetime)`,
        );
        await queryRunner.query(
            `INSERT INTO "vdr_user" ("id", "identifier") VALUES (1, 'superadmin'), (2, 'sales')`,
        );
        await queryRunner.query(`CREATE TABLE "vdr_user_roles_role" ("userId" integer, "roleId" integer)`);
        await queryRunner.query(
            `CREATE TABLE "vdr_role_channels_channel" ("roleId" integer, "channelId" integer)`,
        );
        await queryRunner.query(
            `CREATE TABLE "vdr_role_assignment" ("id" integer PRIMARY KEY AUTOINCREMENT,
             "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
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
        expect(await queryRunner.hasTable('vdr_role_assignment_migration')).toBe(true);
        await removeLegacyRoleData(queryRunner);

        expect(insertedCount).toBe(2);
        expect(
            await queryRunner.query(
                `SELECT "userId", "roleId", "channelId" FROM "vdr_role_assignment" ORDER BY "userId"`,
            ),
        ).toEqual([
            { userId: 1, roleId: 1, channelId: 1 },
            { userId: 2, roleId: 3, channelId: 2 },
        ]);
        expect(await queryRunner.hasTable('vdr_user_roles_role')).toBe(false);
        expect(await queryRunner.hasTable('vdr_role_channels_channel')).toBe(false);
        expect(await queryRunner.hasTable('vdr_role_assignment_migration')).toBe(false);
        await expect(assertRoleAssignmentDataMigrated(queryRunner)).resolves.toBeUndefined();
        await queryRunner.release();
        await dataSource.destroy();
    });
});
