// TODO: Remove this file once v4.0 has been stable for a while. It is a one-time
// migration helper and will not be needed after all users have upgraded past v4.0.
import { CUSTOMER_ROLE_CODE, SUPER_ADMIN_ROLE_CODE } from '@vendure/common/lib/shared-constants';
import { QueryRunner } from 'typeorm';

/**
 * @description
 * The intended behavior changes {@link migrateRoleAssignmentData} will cause for a given
 * database, as reported by {@link previewRoleAssignmentMigration}.
 *
 * @docsCategory migration
 * @docsPage previewRoleAssignmentMigration
 * @since 4.0.0
 */
export interface RoleAssignmentMigrationPreview {
    /**
     * @description
     * What {@link migrateRoleAssignmentData} will write in total: the sum of
     * `administrators` and `customersWithRoles`. The migration logs the same numbers when it
     * finishes.
     */
    migration: {
        /**
         * @description
         * The number of Users who will hold at least one `role_assignment` row.
         */
        userCount: number;
        assignmentCount: number;
    };
    /**
     * @description
     * Users holding at least one Role other than the Customer role (Administrators and API
     * keys), except the Customers counted in `customersWithRoles`. Their permissions do not
     * change: every grant is copied, which {@link migrateRoleAssignmentData} verifies before
     * it changes anything.
     */
    administrators: {
        userCount: number;
        superAdminCount: number;
        /**
         * @description
         * The number of `role_assignment` rows the migration will write for these Users.
         */
        assignmentCount: number;
    };
    /**
     * @description
     * Customers who are not Administrators but hold a Role other than the Customer role, for
     * example to unlock B2B features. Their grants are copied like an Administrator's and keep
     * working, but `assignRolesToUser` and `removeRolesFromUser` accept only Administrators
     * and API keys, so these grants cannot be changed through the Admin API after migrating.
     */
    customersWithRoles: {
        userCount: number;
        /**
         * @description
         * The number of `role_assignment` rows the migration will write for these Customers.
         */
        assignmentCount: number;
        roles: Array<{ roleId: string; roleCode: string; holderCount: number }>;
    };
    /**
     * @description
     * The number of distinct Customers who lose access to at least one Channel.
     */
    customersLosingAccess: number;
    /**
     * @description
     * Per Channel, how many Customers lose or gain access. Pre-v4, every holder of the
     * Customer role held its permissions on every Channel the role was assigned to,
     * regardless of membership. In v4, Customers hold `Authenticated` on their member
     * Channels only. A User who keeps access to the Channel through another Role, or as a
     * SuperAdmin, is not counted.
     *
     * The loss is permanent only where the configured {@link CustomerChannelAssignmentStrategy}
     * declines to assign the Customer. With the default strategy a signed-in Customer becomes
     * a member of the Channel on their next request there.
     */
    customerChannelChanges: Array<{
        channelId: string;
        channelCode: string;
        customersLosingAccess: number;
        customersGainingAccess: number;
    }>;
    /**
     * @description
     * Permissions the legacy Customer role carried beyond `Authenticated`. v4 removes the
     * Customer role, so Customers lose these on every Channel.
     */
    customerRoleDroppedPermissions: string[];
    /**
     * @description
     * Roles which are held by Users but assigned to no Channel. They granted nothing
     * pre-v4 and produce no assignment rows, so their holders lose nothing, but the
     * holdings disappear.
     */
    rolesWithoutChannels: Array<{ roleId: string; roleCode: string; holderCount: number }>;
}

/**
 * @description
 * Reports, without writing anything, how the v4 role-assignment migration will change
 * effective permissions for the Users of this database. Run it after upgrading the Vendure
 * packages to v4 and **before** running the migration, while the database still has its
 * pre-v4 shape. It is safe to run against a production database.
 *
 * Only intended behavior changes are reported; whether the migration copies the data
 * correctly is verified by {@link migrateRoleAssignmentData} itself.
 *
 * ```ts
 * import { formatRoleAssignmentMigrationPreview, previewRoleAssignmentMigration } from '\@vendure/core';
 *
 * const queryRunner = dataSource.createQueryRunner();
 * const preview = await previewRoleAssignmentMigration(queryRunner);
 * console.log(formatRoleAssignmentMigrationPreview(preview));
 * await queryRunner.release();
 * ```
 *
 * @since 4.0.0
 * @docsCategory migration
 * @docsPage previewRoleAssignmentMigration
 * @docsWeight 0
 */
export async function previewRoleAssignmentMigration(
    queryRunner: QueryRunner,
): Promise<RoleAssignmentMigrationPreview> {
    // TypeORM applies the entityPrefix to join tables too
    const prefix = queryRunner.connection.options.entityPrefix ?? '';
    const hasLegacyTables =
        (await queryRunner.hasTable(`${prefix}user_roles_role`)) &&
        (await queryRunner.hasTable(`${prefix}role_channels_channel`));
    if (!hasLegacyTables) {
        throw new Error(
            'The user_roles_role and role_channels_channel tables do not exist. Run ' +
                'previewRoleAssignmentMigration() before running the v4 migration.',
        );
    }
    const esc = (name: string) => queryRunner.connection.driver.escape(name);
    const table = (name: string) => esc(`${prefix}${name}`);
    const customerRoleId = `(SELECT ${esc('id')} FROM ${table('role')} WHERE ${esc('code')} = '${CUSTOMER_ROLE_CODE}')`;

    // Counted from set sizes rather than per (customer, channel) pair: the Customer role
    // usually sits on every channel, so the pairs are |customers| x |channels|.
    const superAdminUserIds = `SELECT sa.${esc('userId')} FROM ${table('user_roles_role')} sa
         INNER JOIN ${table('role')} sar ON sar.${esc('id')} = sa.${esc('roleId')}
         WHERE sar.${esc('code')} = '${SUPER_ADMIN_ROLE_CODE}'`;
    // Customer role holders, minus SuperAdmins, who keep access everywhere
    const holderUserIds = `SELECT h.${esc('userId')} FROM ${table('user_roles_role')} h
         WHERE h.${esc('roleId')} = ${customerRoleId}
         AND h.${esc('userId')} NOT IN (${superAdminUserIds})`;
    const customerRoleChannelIds = `SELECT crc.${esc('channelId')} AS ${esc('channelId')} FROM ${table('role_channels_channel')} crc
         WHERE crc.${esc('roleId')} = ${customerRoleId}`;
    // (holder, channel) pairs, on channels the Customer role covered, where the holder keeps
    // access in v4: as a member of the channel, or through an admin role on it
    const coveredPairs = `SELECT cu.${esc('userId')} AS ${esc('userId')}, ccc.${esc('channelId')} AS ${esc('channelId')}
         FROM ${table('customer')} cu
         INNER JOIN ${table('customer_channels_channel')} ccc ON ccc.${esc('customerId')} = cu.${esc('id')}
         WHERE cu.${esc('deletedAt')} IS NULL
         AND cu.${esc('userId')} IN (${holderUserIds})
         AND ccc.${esc('channelId')} IN (${customerRoleChannelIds})
         UNION
         SELECT ur2.${esc('userId')} AS ${esc('userId')}, rc2.${esc('channelId')} AS ${esc('channelId')}
         FROM ${table('user_roles_role')} ur2
         INNER JOIN ${table('role_channels_channel')} rc2 ON rc2.${esc('roleId')} = ur2.${esc('roleId')}
         WHERE ur2.${esc('roleId')} <> ${customerRoleId}
         AND ur2.${esc('userId')} IN (${holderUserIds})
         AND rc2.${esc('channelId')} IN (${customerRoleChannelIds})`;

    // Customers holding a copied Role (not the Customer or SuperAdmin role) who are not
    // Administrators: their grants are written like an Administrator's
    const customerWithRolesUserIds = `SELECT cu2.${esc('userId')} FROM ${table('customer')} cu2
         WHERE cu2.${esc('deletedAt')} IS NULL
         AND cu2.${esc('userId')} IS NOT NULL
         AND cu2.${esc('userId')} NOT IN (
             SELECT a.${esc('userId')} FROM ${table('administrator')} a
             WHERE a.${esc('deletedAt')} IS NULL AND a.${esc('userId')} IS NOT NULL
         )
         AND cu2.${esc('userId')} NOT IN (${superAdminUserIds})`;
    // The rows migrateRoleAssignmentData() writes for every Role except the Customer and
    // SuperAdmin roles; the SuperAdmin role adds one default-channel row per holder
    const copiedGrants = `SELECT ur.${esc('userId')} AS ${esc('userId')}, ur.${esc('roleId')} AS ${esc('roleId')}
         FROM ${table('user_roles_role')} ur
         INNER JOIN ${table('role_channels_channel')} rc ON rc.${esc('roleId')} = ur.${esc('roleId')}
         INNER JOIN ${table('role')} r ON r.${esc('id')} = ur.${esc('roleId')}
         WHERE r.${esc('code')} NOT IN ('${CUSTOMER_ROLE_CODE}', '${SUPER_ADMIN_ROLE_CODE}')`;

    const channelRows: Array<{ id: string | number; code: string }> = await queryRunner.query(
        `SELECT ${esc('id')}, ${esc('code')} FROM ${table('channel')}`,
    );
    const holderCountRows: CountRow[] = await queryRunner.query(
        `SELECT COUNT(*) AS ${esc('count')} FROM (${holderUserIds}) x`,
    );
    const customerRoleChannelRows: Array<{ channelId: string | number }> =
        await queryRunner.query(customerRoleChannelIds);
    const coveredRows: ChannelCountRow[] = await queryRunner.query(
        `SELECT p.${esc('channelId')} AS ${esc('channelId')}, COUNT(*) AS ${esc('count')}
         FROM (${coveredPairs}) p
         GROUP BY p.${esc('channelId')}`,
    );
    const fullyCoveredRows: CountRow[] = await queryRunner.query(
        `SELECT COUNT(*) AS ${esc('count')} FROM (
             SELECT p.${esc('userId')} FROM (${coveredPairs}) p
             GROUP BY p.${esc('userId')}
             HAVING COUNT(*) = ${customerRoleChannelRows.length}
         ) x`,
    );
    // Members of a channel who did not hold the Customer role there and keep no admin access to it
    const gainingRows: ChannelCountRow[] = await queryRunner.query(
        `SELECT ccc.${esc('channelId')} AS ${esc('channelId')}, COUNT(*) AS ${esc('count')}
         FROM ${table('customer')} cu
         INNER JOIN ${table('customer_channels_channel')} ccc ON ccc.${esc('customerId')} = cu.${esc('id')}
         WHERE cu.${esc('deletedAt')} IS NULL
         AND cu.${esc('userId')} IS NOT NULL
         AND NOT (
             cu.${esc('userId')} IN (${holderUserIds})
             AND ccc.${esc('channelId')} IN (${customerRoleChannelIds})
         )
         AND cu.${esc('userId')} NOT IN (${superAdminUserIds})
         AND NOT EXISTS (
             SELECT 1 FROM ${table('user_roles_role')} ur2
             INNER JOIN ${table('role_channels_channel')} rc2 ON rc2.${esc('roleId')} = ur2.${esc('roleId')}
             WHERE ur2.${esc('userId')} = cu.${esc('userId')}
             AND ur2.${esc('roleId')} <> ${customerRoleId}
             AND rc2.${esc('channelId')} = ccc.${esc('channelId')}
         )
         GROUP BY ccc.${esc('channelId')}`,
    );
    const adminUserRows: CountRow[] = await queryRunner.query(
        `SELECT COUNT(DISTINCT ur.${esc('userId')}) AS ${esc('count')}
         FROM ${table('user_roles_role')} ur
         INNER JOIN ${table('role')} r ON r.${esc('id')} = ur.${esc('roleId')}
         WHERE r.${esc('code')} <> '${CUSTOMER_ROLE_CODE}'
         AND ur.${esc('userId')} NOT IN (${customerWithRolesUserIds})`,
    );
    const superAdminRows: CountRow[] = await queryRunner.query(
        `SELECT COUNT(DISTINCT ur.${esc('userId')}) AS ${esc('count')}
         FROM ${table('user_roles_role')} ur
         INNER JOIN ${table('role')} r ON r.${esc('id')} = ur.${esc('roleId')}
         WHERE r.${esc('code')} = '${SUPER_ADMIN_ROLE_CODE}'`,
    );
    const grantRows: CountRow[] = await queryRunner.query(
        `SELECT COUNT(*) AS ${esc('count')} FROM (${copiedGrants}) g
         WHERE g.${esc('userId')} NOT IN (${customerWithRolesUserIds})`,
    );
    const customerGrantRows: Array<{
        roleId: string | number;
        userCount: string | number;
        count: string | number;
    }> = await queryRunner.query(
        `SELECT g.${esc('roleId')} AS ${esc('roleId')}, COUNT(DISTINCT g.${esc('userId')}) AS ${esc('userCount')},
                    COUNT(*) AS ${esc('count')}
             FROM (${copiedGrants}) g
             WHERE g.${esc('userId')} IN (${customerWithRolesUserIds})
             GROUP BY g.${esc('roleId')}`,
    );
    const assignedUserRows: CountRow[] = await queryRunner.query(
        `SELECT COUNT(*) AS ${esc('count')} FROM (
             SELECT g.${esc('userId')} FROM (${copiedGrants}) g
             UNION
             ${superAdminUserIds}
         ) x`,
    );
    const customerWithRolesCountRows: CountRow[] = await queryRunner.query(
        `SELECT COUNT(DISTINCT g.${esc('userId')}) AS ${esc('count')} FROM (${copiedGrants}) g
         WHERE g.${esc('userId')} IN (${customerWithRolesUserIds})`,
    );
    const customerRoleRows: Array<{ permissions: string | null }> = await queryRunner.query(
        `SELECT ${esc('permissions')} FROM ${table('role')} WHERE ${esc('code')} = '${CUSTOMER_ROLE_CODE}'`,
    );
    const rolesWithoutChannelsRows: Array<{
        roleId: string | number;
        roleCode: string;
        holderCount: string | number;
    }> = await queryRunner.query(
        `SELECT r.${esc('id')} AS ${esc('roleId')}, r.${esc('code')} AS ${esc('roleCode')},
                    COUNT(*) AS ${esc('holderCount')}
             FROM ${table('role')} r
             INNER JOIN ${table('user_roles_role')} ur ON ur.${esc('roleId')} = r.${esc('id')}
             WHERE r.${esc('code')} NOT IN ('${CUSTOMER_ROLE_CODE}', '${SUPER_ADMIN_ROLE_CODE}')
             AND NOT EXISTS (
                 SELECT 1 FROM ${table('role_channels_channel')} rc WHERE rc.${esc('roleId')} = r.${esc('id')}
             )
             GROUP BY r.${esc('id')}, r.${esc('code')}`,
    );

    const holderCount = Number(holderCountRows[0].count);
    const covered = toCountMap(coveredRows);
    const losing = new Map(
        customerRoleChannelRows.map(row => [
            String(row.channelId),
            holderCount - (covered.get(String(row.channelId)) ?? 0),
        ]),
    );
    const gaining = toCountMap(gainingRows);
    const customerChannelChanges = channelRows
        .map(channel => ({
            channelId: String(channel.id),
            channelCode: channel.code,
            customersLosingAccess: losing.get(String(channel.id)) ?? 0,
            customersGainingAccess: gaining.get(String(channel.id)) ?? 0,
        }))
        .filter(change => change.customersLosingAccess > 0 || change.customersGainingAccess > 0);
    // Role.permissions is a simple-array column: comma-joined permission names
    const customerRolePermissions = customerRoleRows[0]?.permissions?.split(',') ?? [];

    const superAdminCount = Number(superAdminRows[0].count);
    const roleCodes = new Map<string, string>(
        (await queryRunner.query(`SELECT ${esc('id')}, ${esc('code')} FROM ${table('role')}`)).map(
            (row: { id: string | number; code: string }) => [String(row.id), row.code],
        ),
    );
    const adminAssignmentCount = Number(grantRows[0].count) + superAdminCount;
    const customerAssignmentCount = customerGrantRows.reduce((sum, row) => sum + Number(row.count), 0);
    return {
        migration: {
            userCount: Number(assignedUserRows[0].count),
            assignmentCount: adminAssignmentCount + customerAssignmentCount,
        },
        administrators: {
            userCount: Number(adminUserRows[0].count),
            superAdminCount,
            assignmentCount: adminAssignmentCount,
        },
        customersWithRoles: {
            userCount: Number(customerWithRolesCountRows[0].count),
            assignmentCount: customerAssignmentCount,
            roles: customerGrantRows.map(row => ({
                roleId: String(row.roleId),
                roleCode: roleCodes.get(String(row.roleId)) ?? '',
                holderCount: Number(row.userCount),
            })),
        },
        customersLosingAccess:
            customerRoleChannelRows.length === 0 ? 0 : holderCount - Number(fullyCoveredRows[0].count),
        customerChannelChanges,
        customerRoleDroppedPermissions: customerRolePermissions.filter(
            permission => permission !== 'Authenticated',
        ),
        rolesWithoutChannels: rolesWithoutChannelsRows.map(row => ({
            roleId: String(row.roleId),
            roleCode: row.roleCode,
            holderCount: Number(row.holderCount),
        })),
    };
}

/**
 * @description
 * Renders a {@link RoleAssignmentMigrationPreview} as a human-readable report.
 *
 * @since 4.0.0
 * @docsCategory migration
 * @docsPage previewRoleAssignmentMigration
 */
export function formatRoleAssignmentMigrationPreview(preview: RoleAssignmentMigrationPreview): string {
    const channelChanges = [...preview.customerChannelChanges].sort((a, b) =>
        compareIds(a.channelId, b.channelId),
    );
    const totalLosing = channelChanges.reduce((sum, change) => sum + change.customersLosingAccess, 0);
    const totalGaining = channelChanges.reduce((sum, change) => sum + change.customersGainingAccess, 0);
    const lines: string[] = [
        'Role assignment migration preview',
        '=================================',
        'Read-only: nothing has been changed. This shows what migrateRoleAssignmentData() will do.',
        '',
        sectionHeader('Migration', 'info'),
        ...formatKeyValues([
            ['Users with role assignments', formatCount(preview.migration.userCount)],
            ['Role assignments to be written', formatCount(preview.migration.assignmentCount)],
        ]),
        '',
        `   Estimated migration time: ${formatEstimate(preview.migration.assignmentCount)}, at ` +
            `${formatCount(BENCHMARK_ROWS_PER_SECOND)} rows per second`,
        '   as measured on postgres. The migration logs the same counts and how long it took.',
        '   Time it on a copy of your production database before you plan the downtime.',
    ];

    lines.push(
        '',
        sectionHeader('Administrators and API keys', 'no change'),
        ...formatKeyValues([
            ['Users with admin roles', formatCount(preview.administrators.userCount)],
            ['of which SuperAdmins', formatCount(preview.administrators.superAdminCount)],
            ['Role assignments to be written', formatCount(preview.administrators.assignmentCount)],
        ]),
        '',
        '   Every administrator and API key keeps exactly the permissions they have today, on',
        '   the same channels. The migration checks this before it changes anything, and stops',
        '   if a single grant does not match.',
    );

    if (preview.customersWithRoles.userCount > 0) {
        const roles = [...preview.customersWithRoles.roles].sort((a, b) =>
            a.roleCode.localeCompare(b.roleCode),
        );
        lines.push(
            '',
            sectionHeader('Customers holding other roles', 'review'),
            ...formatKeyValues([
                ['Customers', formatCount(preview.customersWithRoles.userCount)],
                ['Role assignments to be written', formatCount(preview.customersWithRoles.assignmentCount)],
            ]),
            '',
            '   These customers are not administrators but hold roles besides the Customer role,',
            '   for example to unlock B2B features. Their grants are copied and keep working. In',
            '   v4, assignRolesToUser and removeRolesFromUser accept only administrators and API',
            '   keys, so these grants cannot be changed through the Admin API after migrating.',
            '',
            ...formatTable(
                ['Role', 'Id', 'Customers'],
                roles.map(role => [role.roleCode, role.roleId, formatCount(role.holderCount)]),
            ),
        );
    }

    lines.push('', sectionHeader('Shop customers', 'expected'));
    if (channelChanges.length === 0) {
        lines.push('   No change: every customer is a member of exactly the channels they can use today.');
    } else {
        lines.push(
            ...formatKeyValues([
                ['Customers affected', formatCount(preview.customersLosingAccess)],
                ['Channel accesses removed', formatCount(totalLosing)],
                ['Channel accesses added', formatCount(totalGaining)],
            ]),
            '',
            '   This is a fix, not a loss. Before v4, the Customer role let every customer use',
            '   every channel it was assigned to, including channels they never signed up to.',
            '   From v4, a customer can use only the channels they are a member of. Their',
            '   accounts, orders and memberships are untouched.',
            '',
            '   Customers who also hold an admin role on a channel keep their access there and',
            '   are not counted.',
            '',
            ...formatTable(
                ['Channel', 'Customers losing access', 'Customers gaining access'],
                [
                    ...channelChanges.map(change => [
                        change.channelCode,
                        formatCount(change.customersLosingAccess),
                        formatCount(change.customersGainingAccess),
                    ]),
                    ['Total', formatCount(totalLosing), formatCount(totalGaining)],
                ],
            ),
            '',
            '   Losing access: the customer is not a member of the channel (a soft-deleted',
            '   customer counts as not a member). Gaining access: the customer is a member of a',
            '   channel the Customer role did not cover, usually one created programmatically.',
            '',
            '   With the default CustomerChannelAssignmentStrategy, a signed-in customer becomes a',
            '   member of a channel on their next request there, so access lost here comes back',
            '   on its own. It stays lost only on channels where your strategy declines the',
            '   assignment. If customers should keep access to such a channel, add the missing',
            '   memberships before migrating.',
        );
    }

    if (preview.customerRoleDroppedPermissions.length) {
        lines.push(
            '',
            sectionHeader('Customer role permissions', 'action needed'),
            '   v4 has no Customer role. Customers hold only Authenticated on their member',
            '   channels, so these permissions, added to the Customer role by hand, are lost:',
            ...preview.customerRoleDroppedPermissions.map(permission => `   - ${permission}`),
            '   If customers need them, grant them another way before migrating.',
        );
    }

    if (preview.rolesWithoutChannels.length) {
        const roles = [...preview.rolesWithoutChannels].sort((a, b) => a.roleCode.localeCompare(b.roleCode));
        lines.push(
            '',
            sectionHeader('Roles assigned to no channel', 'info'),
            '   These roles granted nothing before v4, so nobody loses access. They stay as roles',
            '   but have no assignments; assign them per channel if they are still needed.',
            '',
            ...formatTable(
                ['Role', 'Id', 'Holders'],
                roles.map(role => [role.roleCode, role.roleId, formatCount(role.holderCount)]),
            ),
        );
    }
    return lines.join('\n');
}

const REPORT_WIDTH = 88;

/**
 * Throughput of migrateRoleAssignmentData() measured on postgres 15, from 100k to 5M rows.
 */
const BENCHMARK_ROWS_PER_SECOND = 80_000;

function formatEstimate(assignmentCount: number): string {
    const seconds = assignmentCount / BENCHMARK_ROWS_PER_SECOND;
    if (seconds < 1) {
        return 'under 1 second';
    }
    if (seconds < 90) {
        const rounded = Math.round(seconds);
        return `about ${rounded} second${rounded === 1 ? '' : 's'}`;
    }
    return `about ${Math.round(seconds / 60)} minutes`;
}

function sectionHeader(title: string, tag: string): string {
    return title + `[${tag}]`.padStart(REPORT_WIDTH - title.length);
}

/**
 * Renders label / value pairs indented by three spaces, values right-aligned in one column.
 */
function formatKeyValues(pairs: Array<[string, string]>): string[] {
    const labelWidth = Math.max(...pairs.map(([label]) => label.length));
    const valueWidth = Math.max(...pairs.map(([, value]) => value.length));
    return pairs.map(([label, value]) => `   ${label.padEnd(labelWidth)}   ${value.padStart(valueWidth)}`);
}

/**
 * Renders rows as a plain-text table, indented by three spaces. The first column is
 * left-aligned, the others right-aligned.
 */
function formatTable(headers: string[], rows: string[][]): string[] {
    const widths = headers.map((header, i) => Math.max(header.length, ...rows.map(row => row[i].length)));
    const formatRow = (row: string[]) =>
        '   ' +
        row.map((cell, i) => (i === 0 ? cell.padEnd(widths[i]) : cell.padStart(widths[i]))).join('   ');
    return [
        formatRow(headers),
        '   ' + widths.map(width => '-'.repeat(width)).join('   '),
        ...rows.map(formatRow),
    ];
}

function formatCount(count: number): string {
    return count.toLocaleString('en-US');
}

function compareIds(a: string, b: string): number {
    const aNumber = Number(a);
    const bNumber = Number(b);
    return Number.isNaN(aNumber) || Number.isNaN(bNumber) ? a.localeCompare(b) : aNumber - bNumber;
}

interface CountRow {
    count: string | number;
}

interface ChannelCountRow {
    channelId: string | number;
    count: string | number;
}

function toCountMap(rows: ChannelCountRow[]): Map<string, number> {
    return new Map(rows.map(row => [String(row.channelId), Number(row.count)]));
}
