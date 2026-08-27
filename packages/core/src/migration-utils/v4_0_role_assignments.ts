/* eslint-disable no-console */
// TODO: Remove this file once v4.0 has been stable for a while. It is a one-time
// migration helper and will not be needed after all users have upgraded past v4.0.
import { CUSTOMER_ROLE_CODE, SUPER_ADMIN_ROLE_CODE } from '@vendure/common/lib/shared-constants';
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
 * - **Customer role**: no rows are written. Customer permissions are derived at check
 *   time from the Customer's channel memberships, so migrating the old rows (which
 *   granted every customer permissions on every Channel) would both reintroduce that
 *   permission leak and write one row per customer per channel.
 * - **SuperAdmin role**: holders receive a row on *every* Channel, not just the Channels
 *   recorded in `role_channels_channel`. Channels created programmatically via
 *   `ChannelService.create()` never had the SuperAdmin role auto-assigned (only the
 *   `createChannel` mutation did that), so the join-table data can be incomplete.
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

    const insertedCount = (await countRows()) - countBefore;
    console.log(`Successfully migrated ${insertedCount} role assignments to the role_assignment table.`);
    return insertedCount;
}

/**
 * When the `role_assignment` id column is neither auto-incremented nor covered by a
 * database-side default (the case for the uuid EntityIdStrategy on MySQL and SQLite,
 * where TypeORM generates uuids in the application layer), the INSERT ... SELECT must
 * supply the id itself.
 */
async function getExplicitIdClauses(queryRunner: QueryRunner): Promise<{ columns: string; select: string }> {
    const esc = (name: string) => queryRunner.connection.driver.escape(name);
    const table = await queryRunner.getTable('role_assignment');
    const idColumn = table?.findColumnByName('id');
    if (!idColumn) {
        throw new Error('Could not inspect the id column of the role_assignment table.');
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
