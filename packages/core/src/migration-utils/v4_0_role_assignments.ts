/* eslint-disable no-console */
// TODO: Remove this file once v4.0 has been stable for a while. It is a one-time
// migration helper and will not be needed after all users have upgraded past v4.0.
import {
    CUSTOMER_ROLE_CODE,
    ROLE_EDITOR_ROLE_CODE,
    ROLE_EDITOR_ROLE_DESCRIPTION,
    SUPER_ADMIN_ROLE_CODE,
} from '@vendure/common/lib/shared-constants';
import { QueryRunner } from 'typeorm';

/**
 * @description
 * Populates the new `role_assignment` table from the pre-v4 `user_roles_role` and
 * `role_channels_channel` join tables. In the old model a User received each of their
 * Roles' permissions on every Channel the Role was assigned to, so the effective grants
 * are the cross product of the two join tables, which this helper writes out as explicit
 * `(user, role, channel)` rows.
 *
 * Two Roles are treated specially:
 *
 * - **Customer role**: no rows are written, and the role row itself is **deleted** — v4
 *   removes the Customer role entirely. Customer permissions are derived at check time
 *   from the Customer's channel memberships (`Authenticated` on every member Channel), so
 *   migrating the old rows (which granted every customer permissions on every Channel)
 *   would both reintroduce that permission leak and write one row per customer per
 *   channel. If your instance broadened the Customer role's permissions via a direct
 *   repository write, be aware that this customization has no v4 equivalent: the row and
 *   its permissions array are gone after migrating, and customers hold exactly
 *   `Authenticated` on their member Channels.
 * - **SuperAdmin role**: holders receive a row on *every* Channel, not just the Channels
 *   recorded in `role_channels_channel`. Channels created programmatically via
 *   `ChannelService.create()` never had the SuperAdmin role auto-assigned (only the
 *   `createChannel` mutation did that), so the join-table data can be incomplete.
 *
 * Additionally, the RoleEditor role (which bundles the Role CRUD permissions introduced
 * in v4.0 and is granted to every Administrator on creation going forward) is backfilled:
 * the role row is created if absent, and every User with a non-deleted Administrator row
 * receives it on each distinct Channel of their migrated assignment rows. Holders of the
 * SuperAdmin role are skipped, since the SuperAdmin check-time bypass already grants them
 * the Role CRUD permissions everywhere.
 *
 * The SuperAdmin role's stored permissions array also gains the new Role CRUD
 * permissions. Pre-v4 versions re-synced that array with all assignable permissions on
 * boot; v4 derives SuperAdmin permissions at check time and no longer re-syncs, so
 * without this step a migrated instance would present a stale permission list on the
 * SuperAdmin role.
 *
 * Call this from your migration's `up()` method **after** the `role_assignment` table
 * has been created and **before** `user_roles_role` and `role_channels_channel` are
 * dropped.
 *
 * The helper is idempotent: rows which already exist are left as-is, so it is safe to
 * re-run, e.g. after a partial failure on MySQL (where DDL is non-transactional) or as
 * the delta pass of a staged rollout in which the bulk of the data was copied while the
 * previous version was still serving traffic.
 *
 * ```ts
 * import { MigrationInterface, QueryRunner } from 'typeorm';
 * import { migrateRoleAssignmentData } from '\@vendure/core';
 *
 * export class RoleAssignments1234567890 implements MigrationInterface {
 *     public async up(queryRunner: QueryRunner): Promise<any> {
 *         // --- Auto-generated DDL starts here ---
 *         // (Create role_assignment table and FK constraints)
 *         // ...
 *
 *         // --- Populate new table with existing data ---
 *         await migrateRoleAssignmentData(queryRunner);
 *
 *         // --- Auto-generated DDL continues ---
 *         // (Drop user_roles_role and role_channels_channel tables)
 *         // ...
 *     }
 *
 *     public async down(queryRunner: QueryRunner): Promise<any> {
 *         // Auto-generated reverse DDL
 *     }
 * }
 * ```
 *
 * @returns the number of `role_assignment` rows inserted.
 * @since 4.0.0
 * @docsCategory migration
 */
export async function migrateRoleAssignmentData(queryRunner: QueryRunner): Promise<number> {
    if (!(await queryRunner.hasTable('role_assignment'))) {
        throw new Error(
            'The role_assignment table does not exist. Call migrateRoleAssignmentData() after ' +
                'the part of your migration which creates the role_assignment table.',
        );
    }
    const hasUserRoles = await queryRunner.hasTable('user_roles_role');
    const hasRoleChannels = await queryRunner.hasTable('role_channels_channel');
    if (!hasUserRoles || !hasRoleChannels) {
        console.log(
            'The user_roles_role and/or role_channels_channel tables do not exist. ' +
                'Skipping role assignment data migration (already completed?).',
        );
        return 0;
    }

    const esc = (name: string) => queryRunner.connection.driver.escape(name);
    const idInsert = await getExplicitIdClauses(queryRunner);
    const countRows = async (): Promise<number> => {
        const rows: Array<{ count: string | number }> = await queryRunner.query(
            `SELECT COUNT(*) AS ${esc('count')} FROM ${esc('role_assignment')}`,
        );
        return Number(rows[0].count);
    };
    const countBefore = await countRows();

    // 1. Write out the cross product of user_roles_role and role_channels_channel for all
    // Roles except the Customer role, whose permissions are derived from channel membership.
    await queryRunner.query(
        `INSERT INTO ${esc('role_assignment')} (${idInsert.columns}${esc('userId')}, ${esc('roleId')}, ${esc('channelId')})
         SELECT ${idInsert.select}ur.${esc('userId')}, ur.${esc('roleId')}, rc.${esc('channelId')}
         FROM ${esc('user_roles_role')} ur
         INNER JOIN ${esc('role_channels_channel')} rc ON rc.${esc('roleId')} = ur.${esc('roleId')}
         INNER JOIN ${esc('role')} r ON r.${esc('id')} = ur.${esc('roleId')}
         WHERE r.${esc('code')} <> '${CUSTOMER_ROLE_CODE}'
         AND NOT EXISTS (
             SELECT 1 FROM ${esc('role_assignment')} ra
             WHERE ra.${esc('userId')} = ur.${esc('userId')}
             AND ra.${esc('roleId')} = ur.${esc('roleId')}
             AND ra.${esc('channelId')} = rc.${esc('channelId')}
         )`,
    );

    // 2. Fan SuperAdmin role holders out to every Channel, covering Channels which are
    // missing from role_channels_channel because they were created programmatically.
    await queryRunner.query(
        `INSERT INTO ${esc('role_assignment')} (${idInsert.columns}${esc('userId')}, ${esc('roleId')}, ${esc('channelId')})
         SELECT ${idInsert.select}ur.${esc('userId')}, ur.${esc('roleId')}, c.${esc('id')}
         FROM ${esc('user_roles_role')} ur
         INNER JOIN ${esc('role')} r ON r.${esc('id')} = ur.${esc('roleId')}
         CROSS JOIN ${esc('channel')} c
         WHERE r.${esc('code')} = '${SUPER_ADMIN_ROLE_CODE}'
         AND NOT EXISTS (
             SELECT 1 FROM ${esc('role_assignment')} ra
             WHERE ra.${esc('userId')} = ur.${esc('userId')}
             AND ra.${esc('roleId')} = ur.${esc('roleId')}
             AND ra.${esc('channelId')} = c.${esc('id')}
         )`,
    );

    // 3. Create the RoleEditor role if it does not yet exist. Normally RoleService.initRoles()
    // seeds it on first boot of v4.0, but the backfill in step 4 needs the row now.
    const roleIdInsert = await getExplicitIdClauses(queryRunner, 'role');
    const roleCrudPermissions = ['CreateRole', 'ReadRole', 'UpdateRole', 'DeleteRole'];
    const roleEditorPermissions = ['Authenticated', ...roleCrudPermissions];
    const roleColumns =
        `${roleIdInsert.columns}${esc('createdAt')}, ${esc('updatedAt')}, ` +
        `${esc('code')}, ${esc('description')}, ${esc('permissions')}`;
    const roleValues =
        `${roleIdInsert.select}CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, '${ROLE_EDITOR_ROLE_CODE}', ` +
        `'${ROLE_EDITOR_ROLE_DESCRIPTION}', '${roleEditorPermissions.join(',')}'`;
    await queryRunner.query(
        `INSERT INTO ${esc('role')} (${roleColumns})
         SELECT ${roleValues}
         FROM (SELECT 1 AS ${esc('one')}) AS tmp
         WHERE NOT EXISTS (
             SELECT 1 FROM ${esc('role')} r WHERE r.${esc('code')} = '${ROLE_EDITOR_ROLE_CODE}'
         )`,
    );

    // 4. Grant the RoleEditor role to every User with a non-deleted Administrator row, on
    // each distinct Channel of their post-backfill assignment rows. SuperAdmin role holders
    // are skipped: their Role CRUD permissions come from the check-time bypass, so the rows
    // would be pure noise.
    await queryRunner.query(
        `INSERT INTO ${esc('role_assignment')} (${idInsert.columns}${esc('userId')}, ${esc('roleId')}, ${esc('channelId')})
         SELECT ${idInsert.select}t.${esc('userId')}, t.${esc('roleId')}, t.${esc('channelId')}
         FROM (
             SELECT DISTINCT ra.${esc('userId')} AS ${esc('userId')}, rer.${esc('id')} AS ${esc('roleId')}, ra.${esc('channelId')} AS ${esc('channelId')}
             FROM ${esc('role_assignment')} ra
             CROSS JOIN ${esc('role')} rer
             INNER JOIN ${esc('administrator')} a ON a.${esc('userId')} = ra.${esc('userId')} AND a.${esc('deletedAt')} IS NULL
             WHERE rer.${esc('code')} = '${ROLE_EDITOR_ROLE_CODE}'
             AND NOT EXISTS (
                 SELECT 1 FROM ${esc('role_assignment')} sa
                 INNER JOIN ${esc('role')} sr ON sr.${esc('id')} = sa.${esc('roleId')}
                 WHERE sa.${esc('userId')} = ra.${esc('userId')}
                 AND sr.${esc('code')} = '${SUPER_ADMIN_ROLE_CODE}'
             )
             AND NOT EXISTS (
                 SELECT 1 FROM ${esc('role_assignment')} ex
                 WHERE ex.${esc('userId')} = ra.${esc('userId')}
                 AND ex.${esc('roleId')} = rer.${esc('id')}
                 AND ex.${esc('channelId')} = ra.${esc('channelId')}
             )
         ) AS t`,
    );

    // 5. Append the new Role CRUD permissions to the SuperAdmin role's stored permissions
    // array. SuperAdmin access is derived at check time from the SuperAdmin permission, so
    // this changes nothing about what SuperAdmins can do — but pre-v4 versions re-synced
    // the stored array with all assignable permissions on boot and v4 no longer does, so
    // without this a migrated instance would present a stale permission list on the role.
    const superAdminRoleRows: Array<{ id: string | number; permissions: string }> = await queryRunner.query(
        `SELECT ${esc('id')}, ${esc('permissions')} FROM ${esc('role')}
             WHERE ${esc('code')} = '${SUPER_ADMIN_ROLE_CODE}'`,
    );
    for (const row of superAdminRoleRows) {
        const currentPermissions = row.permissions.split(',');
        const missingPermissions = roleCrudPermissions.filter(
            permission => !currentPermissions.includes(permission),
        );
        if (missingPermissions.length) {
            const idLiteral = typeof row.id === 'number' ? row.id : `'${row.id}'`;
            await queryRunner.query(
                `UPDATE ${esc('role')}
                 SET ${esc('permissions')} = '${[...currentPermissions, ...missingPermissions].join(',')}'
                 WHERE ${esc('id')} = ${idLiteral}`,
            );
        }
    }

    // 6. Delete the Customer role row — v4 removes the Customer role entirely (permissions
    // are membership-derived: Authenticated on every member Channel). The legacy join tables
    // still reference the role at this point, so their rows go first; both tables are
    // dropped by the surrounding migration right after this helper returns.
    const customerRoleRows: Array<{ id: string | number }> = await queryRunner.query(
        `SELECT ${esc('id')} FROM ${esc('role')} WHERE ${esc('code')} = '${CUSTOMER_ROLE_CODE}'`,
    );
    for (const row of customerRoleRows) {
        const idLiteral = typeof row.id === 'number' ? row.id : `'${row.id}'`;
        await queryRunner.query(
            `DELETE FROM ${esc('user_roles_role')} WHERE ${esc('roleId')} = ${idLiteral}`,
        );
        await queryRunner.query(
            `DELETE FROM ${esc('role_channels_channel')} WHERE ${esc('roleId')} = ${idLiteral}`,
        );
        await queryRunner.query(`DELETE FROM ${esc('role')} WHERE ${esc('id')} = ${idLiteral}`);
        console.log('Deleted the Customer role (customer permissions are membership-derived in v4).');
    }

    const insertedCount = (await countRows()) - countBefore;
    console.log(`Successfully migrated ${insertedCount} role assignments to the role_assignment table.`);
    return insertedCount;
}

/**
 * When the table's id column is neither auto-incremented nor covered by a database-side
 * default (the case for the uuid EntityIdStrategy on MySQL and SQLite, where TypeORM
 * generates uuids in the application layer), the INSERT ... SELECT must supply the id
 * itself.
 */
async function getExplicitIdClauses(
    queryRunner: QueryRunner,
    tableName = 'role_assignment',
): Promise<{ columns: string; select: string }> {
    const esc = (name: string) => queryRunner.connection.driver.escape(name);
    const table = await queryRunner.getTable(tableName);
    const idColumn = table?.findColumnByName('id');
    if (!idColumn) {
        throw new Error(`Could not inspect the id column of the ${tableName} table.`);
    }
    const isAutoIncrement = idColumn.isGenerated && idColumn.generationStrategy === 'increment';
    const hasDatabaseDefault = idColumn.default !== undefined && idColumn.default !== null;
    if (isAutoIncrement || hasDatabaseDefault) {
        return { columns: '', select: '' };
    }
    return { columns: `${esc('id')}, `, select: `${getUuidExpression(queryRunner)}, ` };
}

function getUuidExpression(queryRunner: QueryRunner): string {
    const type = queryRunner.connection.options.type;
    switch (type) {
        case 'mysql':
        case 'mariadb':
        case 'aurora-mysql':
            return 'UUID()';
        case 'postgres':
        case 'aurora-postgres':
        case 'cockroachdb':
            return 'gen_random_uuid()';
        case 'sqlite':
        case 'better-sqlite3':
        case 'sqljs':
            // uuid v4 recipe: randomblob() is non-deterministic, so it is evaluated per row
            return (
                "lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || " +
                "substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || " +
                "substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))"
            );
        default:
            throw new Error(
                `migrateRoleAssignmentData() cannot generate uuid primary keys for the "${type}" driver. ` +
                    'Populate the role_assignment table manually in your migration.',
            );
    }
}
