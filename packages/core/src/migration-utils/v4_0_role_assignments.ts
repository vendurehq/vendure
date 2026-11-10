/* eslint-disable no-console */
// This one-time v4.0 migration helper must remain exported indefinitely: user migrations
// import it directly, so removing the export would break compilation of any committed
// migration that calls it. The guards against the already-migrated state make it a safe no-op
// once the migration has run. The InitializerService and RoleService also run its checks on
// bootstrap, to refuse to start on a database which still holds unmigrated grants.
import {
    CUSTOMER_ROLE_CODE,
    DEFAULT_CHANNEL_CODE,
    ROLE_EDITOR_ROLE_CODE,
    ROLE_EDITOR_ROLE_DESCRIPTION,
    SUPER_ADMIN_ROLE_CODE,
} from '@vendure/common/lib/shared-constants';
import { QueryRunner, Table } from 'typeorm';

const MIGRATION_GUIDE_URL =
    'https://docs.vendure.io/current/framework/developer-guide/migrating-from-v3/role-assignments';

/**
 * @description
 * The first step of the role assignment migration. Populates the new `role_assignment` table
 * from the pre-v4 `user_roles_role` and `role_channels_channel` join tables. In the old model
 * a User received each of their Roles' permissions on every Channel the Role was assigned to,
 * so the effective grants are the cross product of the two join tables, which this helper
 * writes out as explicit `(user, role, channel)` rows.
 *
 * Some grants are treated specially:
 *
 * - **Customer role**: no rows are written. v4 has no Customer role: Customer permissions
 *   are derived at check time from the Customer's channel memberships (`Authenticated` on
 *   every member Channel), so migrating the old rows (which granted every customer
 *   permissions on every Channel) would both reintroduce that permission leak and write
 *   one row per customer per channel. The Customer role itself is deleted by
 *   {@link removeLegacyRoleData}. If your instance broadened the Customer role's permissions
 *   via a direct repository write, be aware that this customization has no v4 equivalent:
 *   customers hold exactly `Authenticated` on their member Channels.
 * - **Soft-deleted Users**: no rows. v4 removes a User's assignments when it soft-deletes the
 *   Administrator or API key, so a deleted User holds none. Their login already fails, so no
 *   access is lost.
 * - **SuperAdmin role**: holders receive exactly one row, on the default Channel, whatever
 *   `role_channels_channel` records for the role. In v4 the SuperAdmin Role is held on every
 *   Channel or not at all: access is derived at check time from that single row, which
 *   stands for all Channels (see `RoleAssignment`).
 *
 * After copying, the helper verifies that `role_assignment` holds exactly the grants the
 * legacy tables describe under these rules, and throws if any row is missing or extra. To
 * review the intended behavior changes for your data before migrating, see
 * {@link previewRoleAssignmentMigration}.
 *
 * Every Role is given its owning Channel (`role.channelId`, see `Role`): a Role assigned to
 * exactly one Channel in `role_channels_channel` is owned by that Channel, so it stays private
 * to it. Every other Role (assigned to several Channels, to none, or to the default Channel)
 * is owned by the default Channel, which makes it a shared Role, assignable on any Channel.
 * Its existing grants all stay valid. {@link previewRoleAssignmentMigration} lists the Roles
 * which become shared although they were assigned to several Channels.
 *
 * The RoleEditor system role (which bundles the Role CRUD permissions) is created if
 * absent. It is not granted to anyone. Pre-v4 versions gated Role CRUD on the Administrator
 * permissions, and `CreateRole`, `ReadRole`, `UpdateRole` and `DeleteRole` are new in v4, so
 * after migrating only SuperAdmins can create, edit or delete Roles until an actor who may
 * grant RoleEditor grants it.
 *
 * The SuperAdmin role's stored permissions array also gains the new Role CRUD
 * permissions. Pre-v4 versions re-synced that array with all assignable permissions on
 * boot; v4 derives SuperAdmin permissions at check time and no longer re-syncs, so
 * without this step a migrated instance would present a stale permission list on the
 * SuperAdmin role.
 *
 * Finally the helper records when the copy ran in the `role_assignment_migration` table,
 * which {@link removeLegacyRoleData} reads.
 *
 * The legacy tables are left as they are, so v3 servers keep working during a rolling
 * deployment, and v4 servers can change role assignments straight away. Once no
 * v3 server or worker is running, call {@link removeLegacyRoleData}, in the same migration
 * if you stop v3 before migrating, or in a later deployment otherwise.
 *
 * Call this from your migration's `up()` method **after** the `role_assignment` table and
 * the `role.channelId` column have been created. A generated migration does not touch the
 * legacy tables, so nothing else in it needs to change.
 *
 * The helper is idempotent: once the copy has been recorded, it is skipped. It is safe to
 * re-run, e.g. after a partial failure on MySQL (where DDL is non-transactional).
 *
 * Table names honor the `entityPrefix` of the connection options, and on Postgres the
 * `schema` option.
 *
 * ```ts
 * import { MigrationInterface, QueryRunner } from 'typeorm';
 * import { migrateRoleAssignmentData, removeLegacyRoleData } from '\@vendure/core';
 *
 * export class V4Upgrade1234567890 implements MigrationInterface {
 *     public async up(queryRunner: QueryRunner): Promise<any> {
 *         // --- Auto-generated DDL ---
 *         // (Create role_assignment table, add role.channelId, FK constraints)
 *         // ...
 *
 *         // --- Copy the role grants, keep the legacy tables for v3 servers ---
 *         await migrateRoleAssignmentData(queryRunner);
 *         // --- Only when no v3 server or worker is running any more ---
 *         await removeLegacyRoleData(queryRunner);
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
    const state = await getLegacyTablesState(queryRunner, 'migrateRoleAssignmentData');
    if (state === 'dropped') {
        console.log(
            `The ${t.userRoles} and ${t.roleChannels} tables have already been dropped or do not ` +
                'exist. Skipping role assignment data migration.',
        );
        return 0;
    }
    if (await hasRecordedCopy(queryRunner)) {
        console.log(
            `The role grants have already been copied to the ${t.roleAssignment} table. Skipping ` +
                'role assignment data migration.',
        );
        return 0;
    }
    if (state === 'partly-dropped') {
        throw new Error(
            `The ${t.roleChannels} table does not exist, but ${t.userRoles} does. The legacy role ` +
                'data cannot be migrated.',
        );
    }

    const startedAt = Date.now();
    // 1.-2. Copy the grants and verify the result: a mismatch aborts the migration before
    // the copy is recorded.
    const insertedCount = await copyRoleAssignmentGrants(queryRunner, LEGACY_SOURCES(t));
    // 3.-4. Create the RoleEditor role and update the SuperAdmin role.
    await updateSystemRoles(queryRunner);
    // 5. Give every Role its owning Channel.
    await assignRoleOwners(queryRunner, LEGACY_SOURCES(t));
    // 6. Record the copy, which removeLegacyRoleData() needs to tell copied rows from rows
    // written by v4 servers since.
    await recordCopy(queryRunner);

    console.log(
        `Successfully migrated ${insertedCount} role assignments to the ${t.roleAssignment} table in ` +
            `${formatSecondsSince(startedAt)} s. ${await describeRoleAssignmentCounts(queryRunner)} ` +
            'Compare with the counts of previewRoleAssignmentMigration(). The legacy tables ' +
            `${t.userRoles} and ${t.roleChannels} are kept for v3 servers. Once none is running, ` +
            'call removeLegacyRoleData().',
    );
    return insertedCount;
}

/**
 * @description
 * The second step of the role assignment migration. Call it once no v3 server or worker is
 * running: in the same migration as {@link migrateRoleAssignmentData} if you stop v3 before
 * migrating, or from a migration in a later deployment otherwise. Running it stops v3 servers
 * from working.
 *
 * Between the two steps, v3 and v4 servers may both have changed role grants. v4 servers
 * write `role_assignment` and v3 servers write the legacy tables, so this helper first
 * reconciles what it can tell apart:
 *
 * - A row which {@link migrateRoleAssignmentData} copied, and which the legacy tables no
 *   longer grant, was revoked on a v3 server. It is deleted, and logged.
 * - A grant which the legacy tables hold and `role_assignment` does not was either removed
 *   on a v4 server or granted on a v3 server after the copy. The two cannot be told apart,
 *   so it is logged and not applied. Grant it again with `assignRolesToUser` if needed.
 * - Rows written by v4 servers since the copy are left as they are.
 *
 * Roles created on v3 servers since the copy have no owning Channel yet. They are given one
 * by the same rule as in {@link migrateRoleAssignmentData}.
 *
 * It then **drops** the legacy tables and the `role_assignment_migration` table, and
 * deletes the Customer role. The way back to v3 is the backup taken before the migration,
 * which also holds the pre-v4 grants should you need them later.
 *
 * The helper is idempotent: a partially dropped state is completed, and a fully dropped one
 * is skipped. It is safe to re-run, e.g. after a partial failure on MySQL (where DDL is
 * non-transactional).
 *
 * ```ts
 * import { MigrationInterface, QueryRunner } from 'typeorm';
 * import { removeLegacyRoleData } from '\@vendure/core';
 *
 * export class RemoveLegacyRoleData1234567891 implements MigrationInterface {
 *     public async up(queryRunner: QueryRunner): Promise<any> {
 *         await removeLegacyRoleData(queryRunner);
 *     }
 *
 *     public async down(queryRunner: QueryRunner): Promise<any> {
 *         // Restore the backup taken before the upgrade to go back to v3
 *     }
 * }
 * ```
 *
 * @throws if the legacy tables hold grants which {@link migrateRoleAssignmentData} has not copied
 * @since 4.0.0
 * @docsCategory migration
 */
export async function removeLegacyRoleData(queryRunner: QueryRunner): Promise<void> {
    const t = getTableNames(queryRunner);
    const state = await getLegacyTablesState(queryRunner, 'removeLegacyRoleData');
    // A previous run which stopped between the drops (possible on MySQL, where DDL is not
    // transactional) had already reconciled the grants.
    if (state === 'present') {
        if (!(await hasRecordedCopy(queryRunner))) {
            if (await hasUnmigratedRoleGrants(queryRunner)) {
                throw new Error(
                    `The ${t.userRoles} table holds role grants which have not been copied to the ` +
                        `${t.roleAssignment} table. Call migrateRoleAssignmentData() before ` +
                        `removeLegacyRoleData(). See ${MIGRATION_GUIDE_URL}`,
                );
            }
        } else {
            // 1. Delete the copied rows which v3 servers revoked since the copy.
            await deleteRevokedRoleAssignments(queryRunner, LEGACY_SOURCES(t));
            // 2. Report the grants which cannot be attributed to v3 or v4.
            await reportUnappliedGrants(queryRunner, LEGACY_SOURCES(t));
        }
        // 3. Give the Roles created on v3 servers since the copy their owning Channel, while
        // role_channels_channel still records where they were assigned.
        await assignRoleOwners(queryRunner, LEGACY_SOURCES(t));
    }

    // 4. Drop the legacy tables, user_roles_role after role_channels_channel: a run which
    // stopped in between is recognized by it and completed on the next run.
    for (const tableName of [t.roleChannels, t.userRoles, t.copyRecord]) {
        if (await queryRunner.hasTable(tableName)) {
            await queryRunner.dropTable(tableName);
        }
    }
    // 5. Delete the Customer role, which v4 does not use. With the legacy tables gone,
    // nothing cascades from it.
    await deleteLegacyCustomerRole(queryRunner);

    console.log(
        `Removed the legacy tables ${t.userRoles} and ${t.roleChannels} and the Customer role. ` +
            (await describeRoleAssignmentCounts(queryRunner)),
    );
}

/**
 * Creates the RoleEditor role if it does not yet exist, so that a migrated instance
 * presents the same system roles as a fresh one before RoleService.initRoles() runs.
 *
 * Appends the new Role CRUD permissions to the SuperAdmin role's stored permissions
 * array. SuperAdmin access is derived at check time from the SuperAdmin permission, so
 * this changes nothing about what SuperAdmins can do — but pre-v4 versions re-synced the
 * stored array with all assignable permissions on boot and v4 no longer does, so without
 * this a migrated instance would present a stale permission list on the role.
 */
async function updateSystemRoles(queryRunner: QueryRunner): Promise<void> {
    const t = getTableNames(queryRunner);
    const esc = (name: string) => queryRunner.connection.driver.escape(name);
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
        `INSERT INTO ${escTable(queryRunner, t.role)} (${roleColumns})
         SELECT ${roleValues}
         FROM (SELECT 1 AS ${esc('one')}) AS tmp
         WHERE NOT EXISTS (
             SELECT 1 FROM ${escTable(queryRunner, t.role)} r WHERE r.${esc('code')} = '${ROLE_EDITOR_ROLE_CODE}'
         )`,
    );

    const superAdminRoleRows: Array<{ id: string | number; permissions: string }> = await queryRunner.query(
        `SELECT ${esc('id')}, ${esc('permissions')} FROM ${escTable(queryRunner, t.role)}
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
                `UPDATE ${escTable(queryRunner, t.role)}
                 SET ${esc('permissions')} = '${[...currentPermissions, ...missingPermissions].join(',')}'
                 WHERE ${esc('id')} = ${idLiteral}`,
            );
        }
    }
}

/**
 * Sets the owning Channel of every Role which has none yet: the single Channel a Role is
 * assigned to in `role_channels_channel`, or the default Channel for every other Role,
 * which makes it a shared Role. Roles which already have an owner are left as they are, so
 * it is safe to call again, and owners set by v4 servers are kept.
 *
 * A Role confined to one Channel has its v3 grants on that Channel only, so all of them stay
 * valid under the v4 rule that a Role owned by a Channel other than the default one may be
 * assigned only there.
 */
async function assignRoleOwners(queryRunner: QueryRunner, sources: SourceTables): Promise<void> {
    const t = getTableNames(queryRunner);
    const esc = (name: string) => queryRunner.connection.driver.escape(name);
    const roleTable = await queryRunner.getTable(t.role);
    if (!roleTable?.findColumnByName('channelId')) {
        throw new Error(
            `The ${t.role} table has no channelId column. Call the role assignment migration ` +
                `helpers after the part of your migration which adds it. See ${MIGRATION_GUIDE_URL}`,
        );
    }
    const roleId = `${escTable(queryRunner, t.role)}.${esc('id')}`;
    // A scalar subquery with LIMIT rather than MIN(): Postgres has no MIN() for uuid columns.
    // The subqueries do not read the role table itself, which MySQL would refuse in an UPDATE.
    await queryRunner.query(
        `UPDATE ${escTable(queryRunner, t.role)}
         SET ${esc('channelId')} = (
             SELECT rc.${esc('channelId')} FROM ${escTable(queryRunner, sources.roleChannels)} rc
             WHERE rc.${esc('roleId')} = ${roleId}
             LIMIT 1
         )
         WHERE ${esc('channelId')} IS NULL
         AND (
             SELECT COUNT(*) FROM ${escTable(queryRunner, sources.roleChannels)} rc
             WHERE rc.${esc('roleId')} = ${roleId}
         ) = 1`,
    );
    await assignDefaultChannelOwner(queryRunner);
}

/**
 * Makes every Role which still has no owning Channel a shared Role, owned by the default
 * Channel.
 */
async function assignDefaultChannelOwner(queryRunner: QueryRunner): Promise<void> {
    const t = getTableNames(queryRunner);
    const esc = (name: string) => queryRunner.connection.driver.escape(name);
    await queryRunner.query(
        `UPDATE ${escTable(queryRunner, t.role)}
         SET ${esc('channelId')} = (
             SELECT c.${esc('id')} FROM ${escTable(queryRunner, t.channel)} c WHERE c.${esc('code')} = '${DEFAULT_CHANNEL_CODE}'
         )
         WHERE ${esc('channelId')} IS NULL`,
    );
}

/**
 * Deletes the legacy Customer role. Throws, changing nothing, while `role_assignment` holds
 * rows of it: its `roleId` foreign key cascades, so deleting the role would remove them
 * with no `RoleAssignmentEvent` and no session eviction.
 */
async function deleteLegacyCustomerRole(queryRunner: QueryRunner): Promise<void> {
    const t = getTableNames(queryRunner);
    if (!(await queryRunner.hasTable(t.role))) {
        return;
    }
    const esc = (name: string) => queryRunner.connection.driver.escape(name);
    const customerRoleRows: Array<{ id: string | number }> = await queryRunner.query(
        `SELECT ${esc('id')} FROM ${escTable(queryRunner, t.role)} WHERE ${esc('code')} = '${CUSTOMER_ROLE_CODE}'`,
    );
    if (!customerRoleRows.length) {
        return;
    }
    await assertNoCustomerRoleAssignments(queryRunner);
    for (const row of customerRoleRows) {
        const idLiteral = typeof row.id === 'number' ? row.id : `'${row.id}'`;
        await queryRunner.query(
            `DELETE FROM ${escTable(queryRunner, t.role)} WHERE ${esc('id')} = ${idLiteral}`,
        );
    }
}

type LegacyTablesState = 'present' | 'partly-dropped' | 'dropped';

/**
 * Whether the legacy tables are both present, both dropped, or partly dropped: a run of
 * {@link removeLegacyRoleData} stopped after dropping `role_channels_channel` and before
 * dropping `user_roles_role`. Throws when the role_assignment table has not been created
 * yet, or when only `role_channels_channel` is left, which no run of the helpers leaves
 * behind.
 */
async function getLegacyTablesState(
    queryRunner: QueryRunner,
    helperName: string,
): Promise<LegacyTablesState> {
    const t = getTableNames(queryRunner);
    if (!(await queryRunner.hasTable(t.roleAssignment))) {
        throw new Error(
            `The ${t.roleAssignment} table does not exist. Call ${helperName}() after ` +
                `the part of your migration which creates the ${t.roleAssignment} table.`,
        );
    }
    const hasUserRoles = await queryRunner.hasTable(t.userRoles);
    const hasRoleChannels = await queryRunner.hasTable(t.roleChannels);
    if (hasUserRoles && hasRoleChannels) {
        return 'present';
    }
    if (hasUserRoles) {
        return 'partly-dropped';
    }
    if (hasRoleChannels) {
        throw new Error(
            `The ${t.userRoles} table does not exist, but ${t.roleChannels} does. The legacy role ` +
                'data cannot be migrated.',
        );
    }
    return 'dropped';
}

const LEGACY_SOURCES = (t: TableNames): SourceTables => ({
    userRoles: t.userRoles,
    roleChannels: t.roleChannels,
});

/**
 * Makes `role_assignment` hold exactly the grants the legacy tables describe:
 *
 * 1. Writes out the cross product of user_roles_role and role_channels_channel for all
 *    Roles except the Customer role, whose permissions are derived from channel membership,
 *    and the SuperAdmin role, which step 2 writes as a single default-channel row.
 * 2. Writes one row on the default Channel per SuperAdmin role holder. The row stands for
 *    every Channel: SuperAdmin access is derived from it at check time.
 *
 * Then verifies the result.
 *
 * @returns the number of rows inserted.
 */
async function copyRoleAssignmentGrants(queryRunner: QueryRunner, sources: SourceTables): Promise<number> {
    const t = getTableNames(queryRunner);
    const esc = (name: string) => queryRunner.connection.driver.escape(name);
    const idInsert = await getExplicitIdClauses(queryRunner, t.roleAssignment);
    const countBefore = await countRoleAssignments(queryRunner);
    const pending = getPendingGrantQueries(queryRunner, sources, idInsert.select);
    for (const pendingGrants of [pending.legacyGrants, pending.superAdminGrants]) {
        await queryRunner.query(
            `INSERT INTO ${escTable(queryRunner, t.roleAssignment)} (${idInsert.columns}${esc('userId')}, ${esc('roleId')}, ${esc('channelId')})
             ${pendingGrants}`,
        );
    }
    const insertedCount = (await countRoleAssignments(queryRunner)) - countBefore;
    await verifyRoleAssignmentData(queryRunner, sources);
    return insertedCount;
}

/**
 * Records in the `role_assignment_migration` table when the copy ran: the latest
 * `createdAt` of the `role_assignment` rows, which at this point are all copied rows,
 * because v4 refuses to start before the copy. Rows which v4 servers write later have a
 * later `createdAt`. The column takes the type of `role_assignment.createdAt`, so the
 * comparison is exact on every database. The row is written last, so a run which stopped
 * earlier is not recorded and copies again.
 */
async function recordCopy(queryRunner: QueryRunner): Promise<void> {
    const t = getTableNames(queryRunner);
    const esc = (name: string) => queryRunner.connection.driver.escape(name);
    const createdAtColumn = (await queryRunner.getTable(t.roleAssignment))?.findColumnByName('createdAt');
    if (!createdAtColumn) {
        throw new Error(`Could not inspect the createdAt column of the ${t.roleAssignment} table.`);
    }
    if (!(await queryRunner.hasTable(t.copyRecord))) {
        await queryRunner.createTable(
            new Table({
                name: t.copyRecord,
                columns: [
                    // A primary key, which some managed MySQL servers require on every table
                    { name: 'id', type: 'integer', isPrimary: true },
                    {
                        name: 'copiedAt',
                        type: createdAtColumn.type,
                        precision: createdAtColumn.precision,
                        isNullable: true,
                    },
                ],
            }),
        );
    }
    await queryRunner.query(
        `INSERT INTO ${escTable(queryRunner, t.copyRecord)} (${esc('id')}, ${esc('copiedAt')})
         SELECT 1, MAX(ra.${esc('createdAt')}) FROM ${escTable(queryRunner, t.roleAssignment)} ra`,
    );
}

async function hasRecordedCopy(queryRunner: QueryRunner): Promise<boolean> {
    const t = getTableNames(queryRunner);
    if (!(await queryRunner.hasTable(t.copyRecord))) {
        return false;
    }
    const esc = (name: string) => queryRunner.connection.driver.escape(name);
    const rows: unknown[] = await queryRunner.query(`SELECT 1 FROM ${escTable(queryRunner, t.copyRecord)}`);
    return rows.length > 0;
}

const DELETE_BATCH_SIZE = 500;

/**
 * Deletes the rows which {@link migrateRoleAssignmentData} copied and the legacy tables no
 * longer grant: grants revoked on a v3 server since the copy. Rows written by v4 servers
 * since have a later `createdAt` and are left as they are.
 */
async function deleteRevokedRoleAssignments(queryRunner: QueryRunner, sources: SourceTables): Promise<void> {
    const t = getTableNames(queryRunner);
    const esc = (name: string) => queryRunner.connection.driver.escape(name);
    const revokedQuery = getExtraGrantsQuery(queryRunner, sources, { copiedOnly: true });
    const revoked = await describeGrants(queryRunner, revokedQuery);
    if (revoked.total === 0) {
        return;
    }
    // MySQL cannot delete from a table which a subquery of the same statement reads, so the
    // ids are fetched first and deleted in batches.
    const rows: Array<{ id: string | number }> = await queryRunner.query(
        `SELECT g.${esc('id')} AS ${esc('id')} FROM (${revokedQuery}) g`,
    );
    for (let i = 0; i < rows.length; i += DELETE_BATCH_SIZE) {
        const idLiterals = rows
            .slice(i, i + DELETE_BATCH_SIZE)
            .map(row => (typeof row.id === 'number' ? row.id : `'${row.id}'`));
        await queryRunner.query(
            `DELETE FROM ${escTable(queryRunner, t.roleAssignment)} WHERE ${esc('id')} IN (${idLiterals.join(', ')})`,
        );
    }
    console.log(
        [
            `Deleted ${revoked.total} role assignment(s) which migrateRoleAssignmentData() copied and ` +
                `the ${t.userRoles} and ${t.roleChannels} tables no longer grant, because they were ` +
                'revoked on a v3 server since:',
            ...formatGrantsByUser(revoked.grants),
        ].join('\n'),
    );
}

/**
 * Logs the grants which the legacy tables hold and `role_assignment` does not. Each was either
 * removed on a v4 server or granted on a v3 server after the copy, so none is applied.
 */
async function reportUnappliedGrants(queryRunner: QueryRunner, sources: SourceTables): Promise<void> {
    const t = getTableNames(queryRunner);
    const pending = getPendingGrantQueries(queryRunner, sources);
    const unapplied = await describeGrants(queryRunner, [pending.legacyGrants, pending.superAdminGrants]);
    if (unapplied.total === 0) {
        return;
    }
    console.log(
        [
            `Not applied: ${unapplied.total} grant(s) which the ${t.userRoles} and ${t.roleChannels} ` +
                `tables hold and the ${t.roleAssignment} table does not. Each was either removed on a ` +
                'v4 server or granted on a v3 server after migrateRoleAssignmentData() ran. Grant ' +
                'the ones still needed again with assignRolesToUser:',
            ...formatGrantsByUser(unapplied.grants),
        ].join('\n'),
    );
}

async function countRoleAssignments(queryRunner: QueryRunner): Promise<number> {
    const t = getTableNames(queryRunner);
    const esc = (name: string) => queryRunner.connection.driver.escape(name);
    const rows: Array<{ count: string | number }> = await queryRunner.query(
        `SELECT COUNT(*) AS ${esc('count')} FROM ${escTable(queryRunner, t.roleAssignment)}`,
    );
    return Number(rows[0].count);
}

async function describeRoleAssignmentCounts(queryRunner: QueryRunner): Promise<string> {
    const t = getTableNames(queryRunner);
    const esc = (name: string) => queryRunner.connection.driver.escape(name);
    const userRows: Array<{ count: string | number }> = await queryRunner.query(
        `SELECT COUNT(DISTINCT ${esc('userId')}) AS ${esc('count')} FROM ${escTable(queryRunner, t.roleAssignment)}`,
    );
    return (
        `It now holds ${await countRoleAssignments(queryRunner)} role assignments for ` +
        `${Number(userRows[0].count)} users.`
    );
}

function formatSecondsSince(startedAt: number): string {
    return ((Date.now() - startedAt) / 1000).toFixed(1);
}

/**
 * Throws if the pre-v4 `user_roles_role` table still exists under its original name and
 * holds rows which {@link migrateRoleAssignmentData} has not copied: without the copy the
 * `role_assignment` table is empty and every Administrator except the configured superadmin
 * would be locked out.
 *
 * Passes once the copy has been recorded, although the legacy tables still exist: v4 then
 * starts next to v3 servers until {@link removeLegacyRoleData} drops the legacy tables.
 */
export async function assertRoleAssignmentDataMigrated(queryRunner: QueryRunner): Promise<void> {
    if (!(await hasUnmigratedRoleGrants(queryRunner)) || (await hasRecordedCopy(queryRunner))) {
        return;
    }
    const t = getTableNames(queryRunner);
    throw new Error(
        `The pre-v4 ${t.userRoles} table still holds role grants, so they have not been ` +
            `migrated to the ${t.roleAssignment} table, or the migration did not finish. Run ` +
            'migrateRoleAssignmentData() from a database migration before starting Vendure v4. ' +
            'With dbConnectionOptions.synchronize enabled, Vendure runs it on startup instead. ' +
            `See ${MIGRATION_GUIDE_URL}`,
    );
}

/**
 * Whether the pre-v4 `user_roles_role` table still exists, that is,
 * {@link removeLegacyRoleData} has not run yet.
 */
export function hasLegacyRoleTables(queryRunner: QueryRunner): Promise<boolean> {
    return queryRunner.hasTable(getTableNames(queryRunner).userRoles);
}

/**
 * Called on bootstrap. With `synchronize` enabled there is no migration to call
 * {@link migrateRoleAssignmentData} and {@link removeLegacyRoleData} from, so unmigrated
 * pre-v4 grants are migrated here, both steps in one transaction. Otherwise this is
 * {@link assertRoleAssignmentDataMigrated}.
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
        await removeLegacyRoleData(queryRunner);
        await queryRunner.commitTransaction();
        return true;
    } catch (e: unknown) {
        await queryRunner.rollbackTransaction();
        // The server and the worker bootstrap at the same time. If the other process
        // migrated first, this one failed on its drop step and has nothing left to do.
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
    const rows: unknown[] = await queryRunner.query(
        `SELECT 1 FROM ${escTable(queryRunner, t.userRoles)} LIMIT 1`,
    );
    return rows.length > 0;
}

interface TableNames {
    user: string;
    role: string;
    channel: string;
    roleAssignment: string;
    userRoles: string;
    roleChannels: string;
    copyRecord: string;
}

/**
 * Table names with the `entityPrefix` of the connection options applied, which TypeORM
 * also prefixes join tables with, and on Postgres the `schema` option.
 */
function getTableNames(queryRunner: QueryRunner): TableNames {
    const name = (table: string) => qualifiedTableName(queryRunner, table);
    return {
        user: name('user'),
        role: name('role'),
        channel: name('channel'),
        roleAssignment: name('role_assignment'),
        userRoles: name('user_roles_role'),
        roleChannels: name('role_channels_channel'),
        copyRecord: name('role_assignment_migration'),
    };
}

/**
 * @description
 * The name of a table with the `entityPrefix` of the connection options applied, and on
 * Postgres the `schema` option, as `schema.table`. TypeORM's QueryRunner methods accept that
 * form; raw SQL must escape it with {@link escTable}.
 *
 * @internal
 */
export function qualifiedTableName(queryRunner: QueryRunner, table: string): string {
    const options = queryRunner.connection.options;
    const prefixed = `${options.entityPrefix ?? ''}${table}`;
    const schema =
        (options.type === 'postgres' || options.type === 'cockroachdb') && options.schema
            ? options.schema
            : undefined;
    return schema ? `${schema}.${prefixed}` : prefixed;
}

/**
 * Escapes a table name from {@link qualifiedTableName} for raw SQL, the schema and the table
 * separately.
 */
function escTable(queryRunner: QueryRunner, qualifiedName: string): string {
    return qualifiedName
        .split('.')
        .map(part => queryRunner.connection.driver.escape(part))
        .join('.');
}

interface SourceTables {
    userRoles: string;
    roleChannels: string;
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
             SELECT 1 FROM ${escTable(queryRunner, t.roleAssignment)} ra
             WHERE ra.${esc('userId')} = ${userId}
             AND ra.${esc('roleId')} = ${roleId}
             AND ra.${esc('channelId')} = ${channelId}
         )`;
    return {
        legacyGrants: `SELECT ${idSelect}ur.${esc('userId')} AS ${esc('userId')}, ur.${esc('roleId')} AS ${esc('roleId')}, rc.${esc('channelId')} AS ${esc('channelId')}
             FROM ${escTable(queryRunner, sources.userRoles)} ur
             INNER JOIN ${escTable(queryRunner, sources.roleChannels)} rc ON rc.${esc('roleId')} = ur.${esc('roleId')}
             INNER JOIN ${escTable(queryRunner, t.role)} r ON r.${esc('id')} = ur.${esc('roleId')}
             INNER JOIN ${escTable(queryRunner, t.user)} u ON u.${esc('id')} = ur.${esc('userId')}
             WHERE r.${esc('code')} NOT IN ('${CUSTOMER_ROLE_CODE}', '${SUPER_ADMIN_ROLE_CODE}')
             AND u.${esc('deletedAt')} IS NULL
             AND ${notYetAssigned(`ur.${esc('userId')}`, `ur.${esc('roleId')}`, `rc.${esc('channelId')}`)}`,
        superAdminGrants: `SELECT ${idSelect}ur.${esc('userId')} AS ${esc('userId')}, ur.${esc('roleId')} AS ${esc('roleId')}, c.${esc('id')} AS ${esc('channelId')}
             FROM ${escTable(queryRunner, sources.userRoles)} ur
             INNER JOIN ${escTable(queryRunner, t.role)} r ON r.${esc('id')} = ur.${esc('roleId')}
             INNER JOIN ${escTable(queryRunner, t.channel)} c ON c.${esc('code')} = '${DEFAULT_CHANNEL_CODE}'
             INNER JOIN ${escTable(queryRunner, t.user)} u ON u.${esc('id')} = ur.${esc('userId')}
             WHERE r.${esc('code')} = '${SUPER_ADMIN_ROLE_CODE}'
             AND u.${esc('deletedAt')} IS NULL
             AND ${notYetAssigned(`ur.${esc('userId')}`, `ur.${esc('roleId')}`, `c.${esc('id')}`)}`,
    };
}

const MAX_REPORTED_USERS = 20;
const MAX_FETCHED_MISMATCHES = 500;

/**
 * The SELECT yielding the `role_assignment` rows the legacy tables do not grant under the
 * v4 rules: every legacy triple of a User which is not soft-deleted, except the Customer
 * role's, and one default-channel row per such SuperAdmin holder. With `copiedOnly`, only the
 * rows the recorded copy wrote, so that a User soft-deleted on a v3 server since the copy
 * loses the copied rows.
 */
function getExtraGrantsQuery(
    queryRunner: QueryRunner,
    sources: SourceTables,
    { copiedOnly = false }: { copiedOnly?: boolean } = {},
): string {
    const esc = (name: string) => queryRunner.connection.driver.escape(name);
    const t = getTableNames(queryRunner);
    const copiedOnlyJoin = copiedOnly
        ? `INNER JOIN ${escTable(queryRunner, t.copyRecord)} m ON ra.${esc('createdAt')} <= m.${esc('copiedAt')}`
        : '';
    return `SELECT ra.${esc('id')} AS ${esc('id')}, ra.${esc('userId')} AS ${esc('userId')},
                ra.${esc('roleId')} AS ${esc('roleId')}, ra.${esc('channelId')} AS ${esc('channelId')}
         FROM ${escTable(queryRunner, t.roleAssignment)} ra
         LEFT JOIN ${escTable(queryRunner, t.role)} r ON r.${esc('id')} = ra.${esc('roleId')}
         LEFT JOIN ${escTable(queryRunner, t.user)} u ON u.${esc('id')} = ra.${esc('userId')}
         ${copiedOnlyJoin}
         WHERE u.${esc('deletedAt')} IS NOT NULL OR NOT (
             (COALESCE(r.${esc('code')}, '') NOT IN ('${CUSTOMER_ROLE_CODE}', '${SUPER_ADMIN_ROLE_CODE}')
                 AND EXISTS (
                     SELECT 1 FROM ${escTable(queryRunner, sources.userRoles)} ur
                     INNER JOIN ${escTable(queryRunner, sources.roleChannels)} rc ON rc.${esc('roleId')} = ur.${esc('roleId')}
                     WHERE ur.${esc('userId')} = ra.${esc('userId')}
                     AND ur.${esc('roleId')} = ra.${esc('roleId')}
                     AND rc.${esc('channelId')} = ra.${esc('channelId')}
                 ))
             OR (COALESCE(r.${esc('code')}, '') = '${SUPER_ADMIN_ROLE_CODE}'
                 AND ra.${esc('channelId')} IN (
                     SELECT c.${esc('id')} FROM ${escTable(queryRunner, t.channel)} c WHERE c.${esc('code')} = '${DEFAULT_CHANNEL_CODE}'
                 )
                 AND EXISTS (
                     SELECT 1 FROM ${escTable(queryRunner, sources.userRoles)} ur
                     WHERE ur.${esc('userId')} = ra.${esc('userId')}
                     AND ur.${esc('roleId')} = ra.${esc('roleId')}
                 ))
         )`;
}

/**
 * Checks that `role_assignment` holds exactly the grants the legacy tables describe under
 * the v4 rules. Throws on any missing or extra row, naming the affected users, roles and
 * channels.
 */
async function verifyRoleAssignmentData(queryRunner: QueryRunner, sources: SourceTables): Promise<void> {
    const pending = getPendingGrantQueries(queryRunner, sources);
    const missing = await describeGrants(queryRunner, [pending.legacyGrants, pending.superAdminGrants]);
    const extra = await describeGrants(queryRunner, getExtraGrantsQuery(queryRunner, sources));
    if (missing.total === 0 && extra.total === 0) {
        return;
    }
    const lines = [
        'Role assignment verification failed: the copied role assignments do not match the ' +
            'pre-v4 grants. The legacy tables have not been changed, so the migration can be run ' +
            'again once the cause is fixed. If a Vendure server changed Role grants while the ' +
            'migration ran, run it again once no Role grants are being changed.',
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
         FROM ${escTable(queryRunner, t.roleAssignment)} ra
         INNER JOIN ${escTable(queryRunner, t.role)} r ON r.${esc('id')} = ra.${esc('roleId')}
         WHERE r.${esc('code')} = '${CUSTOMER_ROLE_CODE}'`,
    );
    if (customerGrants.total === 0) {
        return;
    }
    throw new Error(
        [
            `The ${t.roleAssignment} table holds ${customerGrants.total} assignment(s) of the legacy ` +
                'Customer role, granted on a v4 server. Deleting the role would remove them without a ' +
                'RoleAssignmentEvent or a session eviction, so the role has been kept. Remove them ' +
                'with removeRolesFromUser and run removeLegacyRoleData() again.',
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
 * Counts the grants the queries yield and fetches up to MAX_FETCHED_MISMATCHES of them with
 * the user identifier, role code and channel code they refer to.
 *
 * Each query is counted on its own: MariaDB plans the anti-join of a `UNION ALL` derived
 * table far worse than that of either branch, which made the count about 7x slower at
 * 2M grants.
 */
async function describeGrants(
    queryRunner: QueryRunner,
    grantsQueries: string | string[],
): Promise<{ total: number; grants: DescribedGrant[] }> {
    const esc = (name: string) => queryRunner.connection.driver.escape(name);
    const t = getTableNames(queryRunner);
    const queries = Array.isArray(grantsQueries) ? grantsQueries : [grantsQueries];
    let total = 0;
    for (const query of queries) {
        const countRows: Array<{ count: string | number }> = await queryRunner.query(
            `SELECT COUNT(*) AS ${esc('count')} FROM (${query}) g`,
        );
        total += Number(countRows[0].count);
    }
    if (total === 0) {
        return { total, grants: [] };
    }
    const grantsQuery = queries.join(' UNION ALL ');
    const grants: DescribedGrant[] = await queryRunner.query(
        `SELECT g.${esc('userId')} AS ${esc('userId')}, u.${esc('identifier')} AS ${esc('userIdentifier')},
                g.${esc('roleId')} AS ${esc('roleId')}, r.${esc('code')} AS ${esc('roleCode')},
                g.${esc('channelId')} AS ${esc('channelId')}, c.${esc('code')} AS ${esc('channelCode')}
         FROM (${grantsQuery}) g
         LEFT JOIN ${escTable(queryRunner, t.user)} u ON u.${esc('id')} = g.${esc('userId')}
         LEFT JOIN ${escTable(queryRunner, t.role)} r ON r.${esc('id')} = g.${esc('roleId')}
         LEFT JOIN ${escTable(queryRunner, t.channel)} c ON c.${esc('id')} = g.${esc('channelId')}
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
    // `sqlite` was removed from the driver type union in TypeORM v1, but 0.3 still reports it.
    const type: string = queryRunner.connection.options.type;
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
