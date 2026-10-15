/* eslint-disable no-console */
// TODO: Remove this file once v4.0 has been stable for a while. It is a one-time
// migration helper and will not be needed after all users have upgraded past v4.0.
import {
    CUSTOMER_ROLE_CODE,
    DEFAULT_CHANNEL_CODE,
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
 * - **Customer role**: no rows are written. v4 has no Customer role: Customer permissions
 *   are derived at check time from the Customer's channel memberships (`Authenticated` on
 *   every member Channel), so migrating the old rows (which granted every customer
 *   permissions on every Channel) would both reintroduce that permission leak and write
 *   one row per customer per channel. The role row itself is kept, so that the archived
 *   legacy rows can still be matched to it; v4 never reads it, and
 *   {@link removeLegacyRoleData} deletes it. If your instance broadened the Customer
 *   role's permissions via a direct repository write, be aware that this customization has
 *   no v4 equivalent: customers hold exactly `Authenticated` on their member Channels.
 * - **SuperAdmin role**: holders receive exactly one row, on the default Channel, whatever
 *   `role_channels_channel` records for the role. In v4 the SuperAdmin Role is held on every
 *   Channel or not at all: access is derived at check time from that single row, which
 *   stands for all Channels (see `RoleAssignment`).
 *
 * The RoleEditor system role (which bundles the Role CRUD permissions) is created if
 * absent. It is not granted to anyone: an Administrator who held `CreateRole`, `ReadRole`,
 * `UpdateRole` or `DeleteRole` through a pre-v4 Role keeps those permissions through the
 * migrated assignment rows of that Role, and every other Administrator has to be granted
 * RoleEditor explicitly by an actor who may grant it.
 *
 * The SuperAdmin role's stored permissions array also gains the new Role CRUD
 * permissions. Pre-v4 versions re-synced that array with all assignable permissions on
 * boot; v4 derives SuperAdmin permissions at check time and no longer re-syncs, so
 * without this step a migrated instance would present a stale permission list on the
 * SuperAdmin role.
 *
 * After copying, the helper verifies that `role_assignment` holds exactly the grants the
 * legacy tables describe under these rules, and throws if any row is missing or extra.
 * Nothing else is changed before the check passes. To review the intended behavior
 * changes for your data before migrating, see {@link previewRoleAssignmentMigration}.
 *
 * Once verified, the legacy tables are **archived, not dropped**: they are renamed to
 * `_v3_user_roles_role` and `_v3_role_channels_channel` and their foreign keys removed, so
 * they keep a frozen copy of the pre-v4 grants for auditing. The archive is not a way back
 * to v3: after going live on v4, rolling back means restoring a backup taken before the
 * migration. Vendure refuses to start while `user_roles_role` still exists under its
 * original name. Drop the archive with {@link removeLegacyRoleData} once you no longer
 * need it.
 *
 * Call this from your migration's `up()` method **after** the `role_assignment` table
 * has been created. A generated migration does not touch the legacy tables, so nothing
 * else in it needs to change.
 *
 * The helper is idempotent: rows which already exist are left as-is, a partially
 * archived state is completed, and a fully archived one is skipped. It is safe to re-run,
 * e.g. after a partial failure on MySQL (where DDL is non-transactional) or as the delta
 * pass of a staged rollout in which the bulk of the data was copied while the previous
 * version was still serving traffic.
 *
 * Table names honor the `entityPrefix` of the connection options.
 *
 * ```ts
 * import { MigrationInterface, QueryRunner } from 'typeorm';
 * import { migrateRoleAssignmentData } from '\@vendure/core';
 *
 * export class RoleAssignments1234567890 implements MigrationInterface {
 *     public async up(queryRunner: QueryRunner): Promise<any> {
 *         // --- Auto-generated DDL ---
 *         // (Create role_assignment table and FK constraints)
 *         // ...
 *
 *         // --- Populate new table with existing data, verify, archive the old tables ---
 *         await migrateRoleAssignmentData(queryRunner);
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
    const t = getTableNames(queryRunner);
    if (!(await queryRunner.hasTable(t.roleAssignment))) {
        throw new Error(
            `The ${t.roleAssignment} table does not exist. Call migrateRoleAssignmentData() after ` +
                `the part of your migration which creates the ${t.roleAssignment} table.`,
        );
    }
    const sources = await resolveSourceTables(queryRunner);
    if (!sources) {
        console.log(
            `The ${t.userRoles} and ${t.roleChannels} tables have already been archived or do not ` +
                'exist. Skipping role assignment data migration.',
        );
        return 0;
    }

    const startedAt = Date.now();
    const esc = (name: string) => queryRunner.connection.driver.escape(name);
    const idInsert = await getExplicitIdClauses(queryRunner, t.roleAssignment);
    const countRows = async (): Promise<number> => {
        const rows: Array<{ count: string | number }> = await queryRunner.query(
            `SELECT COUNT(*) AS ${esc('count')} FROM ${esc(t.roleAssignment)}`,
        );
        return Number(rows[0].count);
    };
    const countBefore = await countRows();

    // 1. Write out the cross product of user_roles_role and role_channels_channel for all
    // Roles except the Customer role, whose permissions are derived from channel membership,
    // and the SuperAdmin role, which step 2 writes as a single default-channel row.
    // 2. Write one row on the default Channel per SuperAdmin role holder. The row stands for
    // every Channel: SuperAdmin access is derived from it at check time.
    const pending = getPendingGrantQueries(queryRunner, sources, idInsert.select);
    for (const pendingGrants of [pending.legacyGrants, pending.superAdminGrants]) {
        await queryRunner.query(
            `INSERT INTO ${esc(t.roleAssignment)} (${idInsert.columns}${esc('userId')}, ${esc('roleId')}, ${esc('channelId')})
             ${pendingGrants}`,
        );
    }

    // Verify the copy before anything else is touched: a mismatch aborts the migration with
    // the source data preserved.
    await verifyRoleAssignmentData(queryRunner, sources);

    // 3. Create the RoleEditor role if it does not yet exist, so that a migrated instance
    // presents the same system roles as a fresh one before RoleService.initRoles() runs.
    const roleIdInsert = await getExplicitIdClauses(queryRunner, t.role);
    const roleCrudPermissions = ['CreateRole', 'ReadRole', 'UpdateRole', 'DeleteRole'];
    const roleEditorPermissions = ['Authenticated', ...roleCrudPermissions];
    const roleColumns =
        `${roleIdInsert.columns}${esc('createdAt')}, ${esc('updatedAt')}, ` +
        `${esc('code')}, ${esc('description')}, ${esc('permissions')}`;
    const roleValues =
        `${roleIdInsert.select}CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, '${ROLE_EDITOR_ROLE_CODE}', ` +
        `'${ROLE_EDITOR_ROLE_DESCRIPTION}', '${roleEditorPermissions.join(',')}'`;
    await queryRunner.query(
        `INSERT INTO ${esc(t.role)} (${roleColumns})
         SELECT ${roleValues}
         FROM (SELECT 1 AS ${esc('one')}) AS tmp
         WHERE NOT EXISTS (
             SELECT 1 FROM ${esc(t.role)} r WHERE r.${esc('code')} = '${ROLE_EDITOR_ROLE_CODE}'
         )`,
    );

    // 4. Append the new Role CRUD permissions to the SuperAdmin role's stored permissions
    // array. SuperAdmin access is derived at check time from the SuperAdmin permission, so
    // this changes nothing about what SuperAdmins can do — but pre-v4 versions re-synced
    // the stored array with all assignable permissions on boot and v4 no longer does, so
    // without this a migrated instance would present a stale permission list on the role.
    const superAdminRoleRows: Array<{ id: string | number; permissions: string }> = await queryRunner.query(
        `SELECT ${esc('id')}, ${esc('permissions')} FROM ${esc(t.role)}
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
                `UPDATE ${esc(t.role)}
                 SET ${esc('permissions')} = '${[...currentPermissions, ...missingPermissions].join(',')}'
                 WHERE ${esc('id')} = ${idLiteral}`,
            );
        }
    }

    // 5. Archive the legacy tables: remove their foreign keys and rename them, so that the
    // archive is a frozen copy which later User or Role deletes cannot cascade into. The
    // Customer role row stays, so the archived Customer rows can still be identified;
    // removeLegacyRoleData() deletes it.
    await archiveLegacyTables(queryRunner);

    const countAfter = await countRows();
    const insertedCount = countAfter - countBefore;
    const userRows: Array<{ count: string | number }> = await queryRunner.query(
        `SELECT COUNT(DISTINCT ${esc('userId')}) AS ${esc('count')} FROM ${esc(t.roleAssignment)}`,
    );
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(
        `Successfully migrated ${insertedCount} role assignments to the ${t.roleAssignment} table in ` +
            `${seconds} s. It now holds ${countAfter} role assignments for ${Number(userRows[0].count)} ` +
            'users; compare with the counts of previewRoleAssignmentMigration(). The legacy tables were ' +
            `archived as ${t.archivedUserRoles} and ${t.archivedRoleChannels}.`,
    );
    return insertedCount;
}

/**
 * @description
 * Drops the `_v3_user_roles_role` and `_v3_role_channels_channel` tables which
 * {@link migrateRoleAssignmentData} archives the pre-v4 role grants to, and deletes the
 * legacy Customer role, which v4 does not use. Call it from a later migration once you no
 * longer need the archive for auditing. Tables and roles which do not exist are skipped,
 * so it is safe to re-run. It throws while `user_roles_role` or `role_channels_channel`
 * still exists under its original name, that is, before {@link migrateRoleAssignmentData} has
 * archived the legacy tables. It also throws while `role_assignment` holds rows of the
 * Customer role, which can still be granted until this helper runs: deleting the role would
 * remove those rows without a `RoleAssignmentEvent` or a session eviction. Remove them
 * with `removeRolesFromUser` first. Nothing is changed when it throws.
 *
 * The archive has no foreign keys, so hard-deleting a User does not remove its rows from
 * the archive. If you erase personal data on request (e.g. under the GDPR), drop the
 * archive once your audit period ends, and include it in your erasure process until then.
 *
 * ```ts
 * import { MigrationInterface, QueryRunner } from 'typeorm';
 * import { removeLegacyRoleData } from '\@vendure/core';
 *
 * export class RemoveLegacyRoleData1234567890 implements MigrationInterface {
 *     public async up(queryRunner: QueryRunner): Promise<any> {
 *         await removeLegacyRoleData(queryRunner);
 *     }
 *
 *     public async down(queryRunner: QueryRunner): Promise<any> {
 *         // The archive cannot be restored
 *     }
 * }
 * ```
 *
 * @since 4.0.0
 * @docsCategory migration
 */
export async function removeLegacyRoleData(queryRunner: QueryRunner): Promise<void> {
    const t = getTableNames(queryRunner);
    // Deleting the Customer role before the legacy tables are archived would cascade into
    // them and remove its grants from what becomes the archive.
    for (const tableName of [t.userRoles, t.roleChannels]) {
        if (await queryRunner.hasTable(tableName)) {
            throw new Error(
                `The ${tableName} table still exists, so the role assignment data has not been ` +
                    'migrated and archived yet. Run migrateRoleAssignmentData() before ' +
                    'removeLegacyRoleData().',
            );
        }
    }
    await assertNoCustomerRoleAssignments(queryRunner);
    for (const tableName of [t.archivedUserRoles, t.archivedRoleChannels]) {
        if (await queryRunner.hasTable(tableName)) {
            await queryRunner.dropTable(tableName);
            console.log(`Dropped the archived ${tableName} table.`);
        }
    }
    if (!(await queryRunner.hasTable(t.role))) {
        return;
    }
    const esc = (name: string) => queryRunner.connection.driver.escape(name);
    const customerRoleRows: Array<{ id: string | number }> = await queryRunner.query(
        `SELECT ${esc('id')} FROM ${esc(t.role)} WHERE ${esc('code')} = '${CUSTOMER_ROLE_CODE}'`,
    );
    for (const row of customerRoleRows) {
        const idLiteral = typeof row.id === 'number' ? row.id : `'${row.id}'`;
        await queryRunner.query(`DELETE FROM ${esc(t.role)} WHERE ${esc('id')} = ${idLiteral}`);
        console.log('Deleted the legacy Customer role (customer permissions are membership-derived in v4).');
    }
}

/**
 * Throws if the pre-v4 `user_roles_role` table still exists under its original name and
 * holds rows, meaning {@link migrateRoleAssignmentData} has not been run or did not finish.
 * Without the migration the `role_assignment` table is empty and every Administrator
 * except the configured superadmin would be locked out.
 */
export async function assertRoleAssignmentDataMigrated(queryRunner: QueryRunner): Promise<void> {
    if (!(await hasUnmigratedRoleGrants(queryRunner))) {
        return;
    }
    const t = getTableNames(queryRunner);
    if (await queryRunner.hasTable(t.archivedRoleChannels)) {
        throw new Error(
            `A previous run of migrateRoleAssignmentData() stopped before archiving the ` +
                `${t.userRoles} table. On MySQL and MariaDB, where DDL statements are not ` +
                'transactional, the migration which called it is not recorded as executed and ' +
                'cannot simply be run again. Restore the backup taken before the migration, or ' +
                'run migrateRoleAssignmentData() again to finish the archive and record the ' +
                'migration as executed. See the v4 migration guide.',
        );
    }
    throw new Error(
        `The pre-v4 ${t.userRoles} table still holds role grants, so they have not been ` +
            `migrated to the ${t.roleAssignment} table, or the migration did not finish. Run ` +
            'migrateRoleAssignmentData() from a database migration before starting Vendure v4. ' +
            'With dbConnectionOptions.synchronize enabled, Vendure runs it on startup instead. ' +
            'See the v4 migration guide.',
    );
}

/**
 * Called on bootstrap. With `synchronize` enabled there is no migration to call
 * {@link migrateRoleAssignmentData} from, so unmigrated pre-v4 grants are migrated here, in
 * one transaction. Otherwise this is {@link assertRoleAssignmentDataMigrated}.
 *
 * @returns whether a migration ran.
 */
export async function ensureRoleAssignmentDataMigrated(
    queryRunner: QueryRunner,
    options: { synchronize: boolean },
): Promise<boolean> {
    if (!options.synchronize) {
        await assertRoleAssignmentDataMigrated(queryRunner);
        return false;
    }
    if (!(await hasUnmigratedRoleGrants(queryRunner))) {
        return false;
    }
    await queryRunner.startTransaction();
    try {
        await migrateRoleAssignmentData(queryRunner);
        await queryRunner.commitTransaction();
        return true;
    } catch (e: unknown) {
        await queryRunner.rollbackTransaction();
        // The server and the worker bootstrap at the same time. If the other process
        // migrated first, this one failed on its archive step and has nothing left to do.
        if (!(await hasUnmigratedRoleGrants(queryRunner))) {
            return false;
        }
        throw e;
    }
}

async function hasUnmigratedRoleGrants(queryRunner: QueryRunner): Promise<boolean> {
    const t = getTableNames(queryRunner);
    if (!(await queryRunner.hasTable(t.userRoles))) {
        return false;
    }
    const esc = (name: string) => queryRunner.connection.driver.escape(name);
    const rows: unknown[] = await queryRunner.query(`SELECT 1 FROM ${esc(t.userRoles)} LIMIT 1`);
    return rows.length > 0;
}

interface TableNames {
    user: string;
    role: string;
    channel: string;
    roleAssignment: string;
    userRoles: string;
    roleChannels: string;
    archivedUserRoles: string;
    archivedRoleChannels: string;
}

/**
 * Table names with the `entityPrefix` of the connection options applied, which TypeORM
 * also prefixes join tables with.
 */
function getTableNames(queryRunner: QueryRunner): TableNames {
    const prefix = queryRunner.connection.options.entityPrefix ?? '';
    return {
        user: `${prefix}user`,
        role: `${prefix}role`,
        channel: `${prefix}channel`,
        roleAssignment: `${prefix}role_assignment`,
        userRoles: `${prefix}user_roles_role`,
        roleChannels: `${prefix}role_channels_channel`,
        archivedUserRoles: `${prefix}_v3_user_roles_role`,
        archivedRoleChannels: `${prefix}_v3_role_channels_channel`,
    };
}

interface SourceTables {
    userRoles: string;
    roleChannels: string;
}

/**
 * The tables to read the legacy grants from. Normally the original join tables; after a
 * partial failure between the two renames (possible on MySQL, where DDL is not
 * transactional) one of them is already archived. Returns undefined when neither original
 * table exists any more: the migration has completed, and the role_assignment table may
 * have changed since, so the archive must not be compared against it.
 */
async function resolveSourceTables(queryRunner: QueryRunner): Promise<SourceTables | undefined> {
    const t = getTableNames(queryRunner);
    const hasUserRoles = await queryRunner.hasTable(t.userRoles);
    const hasRoleChannels = await queryRunner.hasTable(t.roleChannels);
    if (!hasUserRoles && !hasRoleChannels) {
        return undefined;
    }
    const resolve = async (original: string, archived: string, hasOriginal: boolean) => {
        if (hasOriginal) {
            return original;
        }
        if (await queryRunner.hasTable(archived)) {
            return archived;
        }
        throw new Error(
            `Neither the ${original} table nor its archive ${archived} exists. The legacy role ` +
                'data cannot be migrated.',
        );
    };
    return {
        userRoles: await resolve(t.userRoles, t.archivedUserRoles, hasUserRoles),
        roleChannels: await resolve(t.roleChannels, t.archivedRoleChannels, hasRoleChannels),
    };
}

/**
 * On MySQL each DDL statement commits on its own, so a run can stop between any two of
 * them. The boot check looks for `user_roles_role`, so renaming it is the last statement:
 * a run which stopped earlier keeps Vendure from starting until it is completed.
 */
async function archiveLegacyTables(queryRunner: QueryRunner): Promise<void> {
    const t = getTableNames(queryRunner);
    const pairs = [
        { original: t.roleChannels, archived: t.archivedRoleChannels },
        { original: t.userRoles, archived: t.archivedUserRoles },
    ];
    for (const { original, archived } of pairs) {
        if ((await queryRunner.hasTable(original)) && (await queryRunner.hasTable(archived))) {
            throw new Error(
                `Cannot archive ${original}: a table named ${archived} already exists. ` +
                    'Rename or drop it and run the migration again.',
            );
        }
    }
    for (const { original, archived } of pairs) {
        const table = await queryRunner.getTable(
            (await queryRunner.hasTable(original)) ? original : archived,
        );
        if (table?.foreignKeys.length) {
            await queryRunner.dropForeignKeys(table, table.foreignKeys);
        }
    }
    for (const { original, archived } of pairs) {
        if (await queryRunner.hasTable(original)) {
            await queryRunner.renameTable(original, archived);
        }
    }
}

/**
 * The SELECTs yielding the `(userId, roleId, channelId)` triples which the legacy tables
 * grant but `role_assignment` does not yet contain. The migration inserts their results;
 * {@link verifyRoleAssignmentData} requires them to be empty afterwards. `idSelect` prefixes
 * the selected columns with a generated id where the INSERT must supply one.
 */
function getPendingGrantQueries(
    queryRunner: QueryRunner,
    sources: SourceTables,
    idSelect = '',
): { legacyGrants: string; superAdminGrants: string } {
    const esc = (name: string) => queryRunner.connection.driver.escape(name);
    const t = getTableNames(queryRunner);
    const notYetAssigned = (userId: string, roleId: string, channelId: string) =>
        `NOT EXISTS (
             SELECT 1 FROM ${esc(t.roleAssignment)} ra
             WHERE ra.${esc('userId')} = ${userId}
             AND ra.${esc('roleId')} = ${roleId}
             AND ra.${esc('channelId')} = ${channelId}
         )`;
    return {
        legacyGrants: `SELECT ${idSelect}ur.${esc('userId')} AS ${esc('userId')}, ur.${esc('roleId')} AS ${esc('roleId')}, rc.${esc('channelId')} AS ${esc('channelId')}
             FROM ${esc(sources.userRoles)} ur
             INNER JOIN ${esc(sources.roleChannels)} rc ON rc.${esc('roleId')} = ur.${esc('roleId')}
             INNER JOIN ${esc(t.role)} r ON r.${esc('id')} = ur.${esc('roleId')}
             WHERE r.${esc('code')} NOT IN ('${CUSTOMER_ROLE_CODE}', '${SUPER_ADMIN_ROLE_CODE}')
             AND ${notYetAssigned(`ur.${esc('userId')}`, `ur.${esc('roleId')}`, `rc.${esc('channelId')}`)}`,
        superAdminGrants: `SELECT ${idSelect}ur.${esc('userId')} AS ${esc('userId')}, ur.${esc('roleId')} AS ${esc('roleId')}, c.${esc('id')} AS ${esc('channelId')}
             FROM ${esc(sources.userRoles)} ur
             INNER JOIN ${esc(t.role)} r ON r.${esc('id')} = ur.${esc('roleId')}
             INNER JOIN ${esc(t.channel)} c ON c.${esc('code')} = '${DEFAULT_CHANNEL_CODE}'
             WHERE r.${esc('code')} = '${SUPER_ADMIN_ROLE_CODE}'
             AND ${notYetAssigned(`ur.${esc('userId')}`, `ur.${esc('roleId')}`, `c.${esc('id')}`)}`,
    };
}

const MAX_REPORTED_USERS = 20;
const MAX_FETCHED_MISMATCHES = 500;

/**
 * Checks that `role_assignment` holds exactly the grants the legacy tables describe under
 * the v4 rules: every legacy triple except the Customer role's, and one default-channel
 * row per SuperAdmin holder. Throws on any missing or extra row, naming the affected
 * users, roles and channels. An extra row is most likely a grant which was revoked in the
 * legacy tables after an earlier pass of a staged rollout copied it.
 */
async function verifyRoleAssignmentData(queryRunner: QueryRunner, sources: SourceTables): Promise<void> {
    const esc = (name: string) => queryRunner.connection.driver.escape(name);
    const t = getTableNames(queryRunner);
    const pending = getPendingGrantQueries(queryRunner, sources);
    const missingQuery = `${pending.legacyGrants} UNION ALL ${pending.superAdminGrants}`;
    const extraQuery = `SELECT ra.${esc('userId')} AS ${esc('userId')}, ra.${esc('roleId')} AS ${esc('roleId')}, ra.${esc('channelId')} AS ${esc('channelId')}
         FROM ${esc(t.roleAssignment)} ra
         LEFT JOIN ${esc(t.role)} r ON r.${esc('id')} = ra.${esc('roleId')}
         WHERE NOT (
             (COALESCE(r.${esc('code')}, '') NOT IN ('${CUSTOMER_ROLE_CODE}', '${SUPER_ADMIN_ROLE_CODE}')
                 AND EXISTS (
                     SELECT 1 FROM ${esc(sources.userRoles)} ur
                     INNER JOIN ${esc(sources.roleChannels)} rc ON rc.${esc('roleId')} = ur.${esc('roleId')}
                     WHERE ur.${esc('userId')} = ra.${esc('userId')}
                     AND ur.${esc('roleId')} = ra.${esc('roleId')}
                     AND rc.${esc('channelId')} = ra.${esc('channelId')}
                 ))
             OR (COALESCE(r.${esc('code')}, '') = '${SUPER_ADMIN_ROLE_CODE}'
                 AND ra.${esc('channelId')} IN (
                     SELECT c.${esc('id')} FROM ${esc(t.channel)} c WHERE c.${esc('code')} = '${DEFAULT_CHANNEL_CODE}'
                 )
                 AND EXISTS (
                     SELECT 1 FROM ${esc(sources.userRoles)} ur
                     WHERE ur.${esc('userId')} = ra.${esc('userId')}
                     AND ur.${esc('roleId')} = ra.${esc('roleId')}
                 ))
         )`;
    const missing = await describeGrants(queryRunner, missingQuery);
    const extra = await describeGrants(queryRunner, extraQuery);
    if (missing.total === 0 && extra.total === 0) {
        return;
    }
    const lines = [
        'Role assignment verification failed: the copied role assignments do not match the ' +
            'pre-v4 grants. The legacy tables have not been changed, so the migration can be run ' +
            'again once the cause is fixed.',
    ];
    if (missing.total) {
        lines.push(
            '',
            `Would lose access (granted before v4, missing after the copy): ${missing.total} grant(s)`,
            ...formatGrantsByUser(missing.grants),
        );
    }
    if (extra.total) {
        lines.push(
            '',
            `Would gain access (present after the copy, not granted before v4): ${extra.total} grant(s)`,
            ...formatGrantsByUser(extra.grants),
            '',
            'A grant present but not granted before v4 is usually one which was revoked after an ' +
                'earlier pass of a staged rollout copied it. Remove it from the role_assignment ' +
                'table and run the migration again.',
        );
    }
    throw new Error(lines.join('\n'));
}

/**
 * Throws if `role_assignment` holds rows of the legacy Customer role. Its `roleId` foreign key
 * cascades, so deleting the role would remove them with no `RoleAssignmentEvent` and no
 * session eviction.
 */
async function assertNoCustomerRoleAssignments(queryRunner: QueryRunner): Promise<void> {
    const t = getTableNames(queryRunner);
    if (!(await queryRunner.hasTable(t.role)) || !(await queryRunner.hasTable(t.roleAssignment))) {
        return;
    }
    const esc = (name: string) => queryRunner.connection.driver.escape(name);
    const customerGrants = await describeGrants(
        queryRunner,
        `SELECT ra.${esc('userId')} AS ${esc('userId')}, ra.${esc('roleId')} AS ${esc('roleId')}, ra.${esc('channelId')} AS ${esc('channelId')}
         FROM ${esc(t.roleAssignment)} ra
         INNER JOIN ${esc(t.role)} r ON r.${esc('id')} = ra.${esc('roleId')}
         WHERE r.${esc('code')} = '${CUSTOMER_ROLE_CODE}'`,
    );
    if (customerGrants.total === 0) {
        return;
    }
    throw new Error(
        [
            `The ${t.roleAssignment} table holds ${customerGrants.total} assignment(s) of the legacy ` +
                'Customer role, granted after the migration. Deleting the role would remove them ' +
                'without a RoleAssignmentEvent or a session eviction, so nothing has been changed. ' +
                'Remove them with removeRolesFromUser and run removeLegacyRoleData() again.',
            '',
            ...formatGrantsByUser(customerGrants.grants),
        ].join('\n'),
    );
}

interface DescribedGrant {
    userId: string | number;
    userIdentifier: string | null;
    roleId: string | number;
    roleCode: string | null;
    channelId: string | number;
    channelCode: string | null;
}

/**
 * Counts the grants a query yields and fetches up to MAX_FETCHED_MISMATCHES of them with
 * the user identifier, role code and channel code they refer to.
 */
async function describeGrants(
    queryRunner: QueryRunner,
    grantsQuery: string,
): Promise<{ total: number; grants: DescribedGrant[] }> {
    const esc = (name: string) => queryRunner.connection.driver.escape(name);
    const t = getTableNames(queryRunner);
    const countRows: Array<{ count: string | number }> = await queryRunner.query(
        `SELECT COUNT(*) AS ${esc('count')} FROM (${grantsQuery}) g`,
    );
    const total = Number(countRows[0].count);
    if (total === 0) {
        return { total, grants: [] };
    }
    const grants: DescribedGrant[] = await queryRunner.query(
        `SELECT g.${esc('userId')} AS ${esc('userId')}, u.${esc('identifier')} AS ${esc('userIdentifier')},
                g.${esc('roleId')} AS ${esc('roleId')}, r.${esc('code')} AS ${esc('roleCode')},
                g.${esc('channelId')} AS ${esc('channelId')}, c.${esc('code')} AS ${esc('channelCode')}
         FROM (${grantsQuery}) g
         LEFT JOIN ${esc(t.user)} u ON u.${esc('id')} = g.${esc('userId')}
         LEFT JOIN ${esc(t.role)} r ON r.${esc('id')} = g.${esc('roleId')}
         LEFT JOIN ${esc(t.channel)} c ON c.${esc('id')} = g.${esc('channelId')}
         ORDER BY g.${esc('userId')}, g.${esc('roleId')}, g.${esc('channelId')}
         LIMIT ${MAX_FETCHED_MISMATCHES}`,
    );
    return { total, grants };
}

/**
 * One line per user: `  alice: order-manager on eu-store, store-03; sales on store-05`.
 */
function formatGrantsByUser(grants: DescribedGrant[]): string[] {
    const byUser = new Map<string, Map<string, string[]>>();
    for (const grant of grants) {
        const user = grant.userIdentifier ?? `user ${grant.userId}`;
        const role = grant.roleCode ?? `role ${grant.roleId}`;
        const roles = byUser.get(user) ?? new Map<string, string[]>();
        roles.set(role, [...(roles.get(role) ?? []), grant.channelCode ?? `channel ${grant.channelId}`]);
        byUser.set(user, roles);
    }
    const lines = [...byUser.entries()]
        .slice(0, MAX_REPORTED_USERS)
        .map(
            ([user, roles]) =>
                `  ${user}: ` +
                [...roles.entries()]
                    .map(([role, channels]) => `${role} on ${channels.join(', ')}`)
                    .join('; '),
        );
    if (byUser.size > MAX_REPORTED_USERS) {
        lines.push(`  ... and more users, not shown`);
    }
    return lines;
}

/**
 * When the table's id column is neither auto-incremented nor covered by a database-side
 * default (the case for the uuid EntityIdStrategy on MySQL and SQLite, where TypeORM
 * generates uuids in the application layer), the INSERT ... SELECT must supply the id
 * itself.
 */
async function getExplicitIdClauses(
    queryRunner: QueryRunner,
    tableName: string,
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
