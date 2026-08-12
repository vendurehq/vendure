import { Injectable } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import { Brackets } from 'typeorm';

import { Logger } from '../../config/logger/vendure-logger';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { Customer } from '../../entity/customer/customer.entity';
import { User } from '../../entity/user/user.entity';

import { loggerCtx } from './constants';
import { RoleAssignment } from './role-assignment.entity';

export interface MigrateLegacyRolesResult {
    /** The number of RoleAssignment rows which were newly created by this run */
    created: number;
}

/**
 * Migrates the legacy `User -> Role -> Channel` relations into explicit {@link RoleAssignment}
 * rows: for each (user, role) pair in `user_roles_role`, the role's channels are joined in
 * from `role_channels_channel`, yielding one RoleAssignment per (user, role, channel).
 *
 * Customer users are additionally restricted to the channels they actually belong to
 * (via `customer_channels_channel`): without this check every customer would receive an
 * assignment on every channel, because the Customer role itself is auto-assigned to all
 * channels. Administrator users have no channel membership of their own, so their
 * assignments follow the role's channels directly. A user which is both an administrator
 * and a customer is treated as a customer user, i.e. all of its assignments are restricted
 * to the customer's channels. Permission resolution is driven by this table (see
 * {@link RoleAssignmentPermissionResolverStrategy}); operations which extend the legacy
 * relations after this backfill (role grants, channel creation auto-assigning the
 * SuperAdmin role, customer registration) are not yet mirrored into RoleAssignment rows —
 * until that sync layer lands in a subsequent stage, a manual re-run of
 * `migrateLegacyRoles()` picks them up.
 *
 * To keep memory usage bounded regardless of store size, the candidate rows are processed
 * in keyset-paginated batches, and rows which already have a RoleAssignment are excluded
 * DB-side via an anti-join rather than being loaded and diffed in memory.
 *
 * The migration is purely additive and idempotent: existing legacy relations are left
 * untouched (they remain writable through the existing admin API, and keeping them makes
 * removing the plugin non-destructive), and re-running it only creates
 * whatever RoleAssignments are missing.
 * It runs on server bootstrap while the `RoleAssignmentPlugin` is registered, but only
 * when the `role_assignment` table is still empty (see {@link RoleAssignmentPlugin});
 * it can be invoked manually to pick up relations created since.
 *
 * TODO: consider also exporting this as a standalone `migrateRoleAssignmentData(queryRunner)`
 * helper in `migration-utils/` (the v3.6 pattern, see `migrateProductOptionGroupData()`), so
 * users can run the backfill inside the same TypeORM migration that creates the
 * `role_assignment` table rather than relying on boot-time run-once logic.
 *
 * @internal
 */
@Injectable()
export class RoleAssignmentMigrationService {
    constructor(private connection: TransactionalConnection) {}

    async migrateLegacyRoles(): Promise<MigrateLegacyRolesResult> {
        // TODO: this runs inside `onApplicationBootstrap` and therefore blocks server startup
        // until the migration completes — on stores with many users x channels this can be a
        // long delay. Consider moving the backfill to a job-queue job or emitting progress.
        // TODO: two instances booting concurrently against an empty table will both run the
        // full migration. On postgres/mysql/sqlite `orIgnore()` makes this safe (duplicate
        // work only), but on SQL Server `orIgnore()` degrades to a plain INSERT, so the losing
        // instance hits a unique-constraint violation and its startup aborts. Consider an
        // advisory lock, or catching the error and logging instead of failing bootstrap.
        Logger.info('Starting migration of legacy user-role relations to RoleAssignments...', loggerCtx);
        const rawConnection = this.connection.rawConnection;
        const batchSize = 500;
        let created = 0;

        // A single transaction so that a mid-run failure cannot leave the table partially
        // populated, which would prevent the empty-table bootstrap check from re-running
        // the migration on the next start.
        await rawConnection.transaction(async manager => {
            let lastKey: { userId: ID; roleId: ID; channelId: ID } | undefined;
            let batch: Array<{ userId: ID; roleId: ID; channelId: ID }>;
            do {
                // user_roles_role -> role_channels_channel: one row per (user, role, channel),
                // excluding rows which already have a RoleAssignment. The keyset pagination
                // (rather than relying on the anti-join alone) ensures each batch resumes
                // where the previous one ended instead of re-scanning already-migrated rows.
                const qb = manager
                    .getRepository(User)
                    .createQueryBuilder('user')
                    .innerJoin('user.roles', 'role')
                    .innerJoin('role.channels', 'channel')
                    .select('user.id', 'userId')
                    .addSelect('role.id', 'roleId')
                    .addSelect('channel.id', 'channelId')
                    .where('user.deletedAt IS NULL')
                    .andWhere(outerQb => {
                        const sub = outerQb
                            .subQuery()
                            .select('1')
                            .from(RoleAssignment, 'assignment')
                            .where('assignment.userId = user.id')
                            .andWhere('assignment.roleId = role.id')
                            .andWhere('assignment.channelId = channel.id')
                            .getQuery();
                        return `NOT EXISTS ${sub}`;
                    })
                    // Customer users only receive assignments for channels they belong to;
                    // users without a customer record (administrators) are not restricted.
                    .andWhere(outerQb => {
                        const hasCustomerRecord = outerQb
                            .subQuery()
                            .select('1')
                            .from(Customer, 'customer')
                            .innerJoin('customer.user', 'customerUser')
                            .where('customerUser.id = user.id')
                            .andWhere('customer.deletedAt IS NULL')
                            .getQuery();
                        const isMemberOfChannel = outerQb
                            .subQuery()
                            .select('1')
                            .from(Customer, 'member')
                            .innerJoin('member.user', 'memberUser')
                            .innerJoin('member.channels', 'memberChannel')
                            .where('memberUser.id = user.id')
                            .andWhere('member.deletedAt IS NULL')
                            .andWhere('memberChannel.id = channel.id')
                            .getQuery();
                        return `(NOT EXISTS ${hasCustomerRecord} OR EXISTS ${isMemberOfChannel})`;
                    })
                    .orderBy('user.id', 'ASC')
                    .addOrderBy('role.id', 'ASC')
                    .addOrderBy('channel.id', 'ASC')
                    .limit(batchSize);
                if (lastKey) {
                    qb.andWhere(
                        new Brackets(qb1 => {
                            qb1.where('user.id > :lastUserId')
                                .orWhere('user.id = :lastUserId AND role.id > :lastRoleId')
                                .orWhere(
                                    'user.id = :lastUserId AND role.id = :lastRoleId AND channel.id > :lastChannelId',
                                );
                        }),
                    ).setParameters({
                        lastUserId: lastKey.userId,
                        lastRoleId: lastKey.roleId,
                        lastChannelId: lastKey.channelId,
                    });
                }
                batch = await qb.getRawMany<{ userId: ID; roleId: ID; channelId: ID }>();
                if (batch.length > 0) {
                    await manager
                        .createQueryBuilder()
                        .insert()
                        .into(RoleAssignment)
                        .values(batch)
                        .orIgnore()
                        .execute();
                    created += batch.length;
                    lastKey = batch[batch.length - 1];
                }
                // A full batch means there may be more rows; a short batch was the last page.
            } while (batch.length === batchSize);
        });

        if (created > 0) {
            Logger.info(
                `Created ${created} RoleAssignment(s) from legacy user-role relations`,
                loggerCtx,
            );
        }
        return { created };
    }
}
