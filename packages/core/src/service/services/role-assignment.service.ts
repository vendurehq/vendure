import { Injectable } from '@nestjs/common';
import { SUPER_ADMIN_ROLE_CODE } from '@vendure/common/lib/shared-constants';
import { ID, PaginatedList } from '@vendure/common/lib/shared-types';
import { unique } from '@vendure/common/lib/unique';

import { RequestContext } from '../../api/common/request-context';
import { RelationPaths } from '../../api/decorators/relations.decorator';
import { Instrument } from '../../common/instrument-decorator';
import { ListQueryOptions } from '../../common/types/common-types';
import { idsAreEqual } from '../../common/utils';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { Channel } from '../../entity/channel/channel.entity';
import { RoleAssignment } from '../../entity/role-assignment/role-assignment.entity';
import { Role } from '../../entity/role/role.entity';
import { User } from '../../entity/user/user.entity';
import { ListQueryBuilder } from '../helpers/list-query-builder/list-query-builder';
import {
    ResolvedUserPermissions,
    RolePermissionResolver,
} from '../helpers/role-permission-resolver/role-permission-resolver';

/**
 * @description
 * A `(roleId, channelId)` pair identifying the grant of a Role on a Channel, as used by
 * {@link RoleAssignmentService.setAssignmentsForUser}.
 *
 * @docsCategory services
 * @docsPage RoleAssignmentService
 * @since 4.0.0
 */
export interface RoleChannelPair {
    roleId: ID;
    channelId: ID;
}

/**
 * @description
 * Contains methods relating to {@link RoleAssignment} entities — the `(user, role, channel)`
 * triples which grant a User a Role's permissions on a specific Channel.
 *
 * Write methods do not perform authorization themselves: callers are responsible for
 * asserting that the active user may grant the Roles involved (see
 * {@link RoleService.assertActiveUserCanGrantRoles}). All writes go through entity-based
 * repository operations so that {@link SessionService}'s entity subscriber observes them
 * and evicts the affected User's cached sessions — permission changes therefore take
 * effect on the User's next request.
 *
 * @docsCategory services
 * @since 4.0.0
 */
@Injectable()
@Instrument()
export class RoleAssignmentService {
    constructor(
        private connection: TransactionalConnection,
        private rolePermissionResolver: RolePermissionResolver,
        private listQueryBuilder: ListQueryBuilder,
    ) {}

    /**
     * @description
     * Returns a paginated list of RoleAssignments. No per-channel visibility filtering is
     * applied: any caller holding the `ReadAdministrator` permission reads the assignments
     * of all Users on all Channels. Assignments are read whole or not at all, because a
     * partial read that is written back through {@link setAssignmentsForUser}'s replace-set
     * semantics would misread the hidden rows as removals.
     */
    async findAll(
        ctx: RequestContext,
        options?: ListQueryOptions<RoleAssignment>,
        relations?: RelationPaths<RoleAssignment>,
    ): Promise<PaginatedList<RoleAssignment>> {
        const qb = this.listQueryBuilder.build(RoleAssignment, options, {
            relations: relations ?? [],
            ctx,
        });
        return qb.getManyAndCount().then(([items, totalItems]) => ({ items, totalItems }));
    }

    /**
     * @description
     * Returns all RoleAssignments of the given User across all Channels. See
     * {@link findAll} on why no visibility filtering is applied.
     */
    getAssignmentsForUser(ctx: RequestContext, userId: ID): Promise<RoleAssignment[]> {
        return this.connection.getRepository(ctx, RoleAssignment).find({ where: { userId } });
    }

    /**
     * @description
     * Resolves the effective permissions of the given User. See {@link RolePermissionResolver}.
     */
    resolvePermissions(userId: ID): Promise<ResolvedUserPermissions> {
        return this.rolePermissionResolver.resolvePermissions(userId);
    }

    /**
     * @description
     * Returns the distinct Roles assigned to the given User across all Channels.
     */
    async resolveUserRoles(ctx: RequestContext, userId: ID): Promise<Role[]> {
        const assignments = await this.connection.getRepository(ctx, RoleAssignment).find({
            where: { userId },
            relations: { role: true },
        });
        const roles = assignments.map(({ role }) => role);
        // Customer permissions are membership-derived (see RolePermissionResolver), so a
        // customer User holds no Roles here.
        // The same Role assigned on several Channels yields one row per Channel.
        return unique(roles, 'id');
    }

    /**
     * @description
     * Returns the ids of all non-deleted Users holding the given Role on any Channel.
     */
    async resolveUserIdsWithRole(ctx: RequestContext, roleId: ID): Promise<ID[]> {
        const assignmentRows = await this.connection
            .getRepository(ctx, RoleAssignment)
            .createQueryBuilder('assignment')
            .select('user.id', 'userId')
            .innerJoin(User, 'user', 'user.id = assignment.userId AND user.deletedAt IS NULL')
            .where('assignment.roleId = :roleId', { roleId })
            .getRawMany<{ userId: ID }>();
        const userIds = assignmentRows.map(row => row.userId);
        return unique(userIds);
    }

    /**
     * @description
     * Returns the ids of the Channels on which the given Role currently has assignment rows.
     *
     * @since 4.0.0
     */
    async getChannelIdsWithAssignments(ctx: RequestContext, roleId: ID): Promise<ID[]> {
        const channelIdsByRole = await this.getChannelIdsWithAssignmentsForRoles(ctx, [roleId]);
        return channelIdsByRole.get(roleId.toString()) ?? [];
    }

    /**
     * @description
     * Returns, for each of the given Roles, the ids of the Channels on which it currently
     * has assignment rows, keyed by the stringified role id. Roles without assignments are
     * absent from the Map.
     *
     * @since 4.0.0
     */
    async getChannelIdsWithAssignmentsForRoles(
        ctx: RequestContext,
        roleIds: ID[],
    ): Promise<Map<string, ID[]>> {
        const channelIdsByRole = new Map<string, ID[]>();
        if (roleIds.length === 0) {
            return channelIdsByRole;
        }
        const rows = await this.connection
            .getRepository(ctx, RoleAssignment)
            .createQueryBuilder('assignment')
            .select('assignment.roleId', 'roleId')
            .addSelect('assignment.channelId', 'channelId')
            .distinct(true)
            .where('assignment.roleId IN (:...roleIds)', { roleIds })
            .getRawMany<{ roleId: ID; channelId: ID }>();
        for (const row of rows) {
            const key = row.roleId.toString();
            const channelIds = channelIdsByRole.get(key) ?? [];
            channelIds.push(row.channelId);
            channelIdsByRole.set(key, channelIds);
        }
        return channelIdsByRole;
    }

    /**
     * @description
     * Returns the ids of the Roles assigned to the given User on the given Channel.
     */
    async getAssignedRoleIdsOnChannel(ctx: RequestContext, userId: ID, channelId: ID): Promise<ID[]> {
        const assignments = await this.connection.getRepository(ctx, RoleAssignment).find({
            where: { userId, channelId },
        });
        return unique(assignments.map(a => a.roleId));
    }

    /**
     * @description
     * Replaces the User's Role assignments on the given Channel with the given Roles,
     * leaving assignments on other Channels untouched.
     *
     * This implements the `roleIds` inputs of the administrator and API-key mutations, which
     * are read as "replace this User's Roles on the active Channel" — a `roleIds` grant
     * always carried a channel in the request (the `vendure-token` header), it was just
     * never part of the write. The `roleIds` inputs are deprecated in favor of the
     * `roleAssignments` vocabulary and will be removed in a future major version.
     */
    async replaceUserAssignmentsOnChannel(
        ctx: RequestContext,
        userId: ID,
        roleIds: ID[],
        channelId: ID = ctx.channelId,
    ): Promise<void> {
        const repository = this.connection.getRepository(ctx, RoleAssignment);
        const existing = await repository.find({ where: { userId, channelId } });
        const targetRoleIds = unique(roleIds);
        const toRemove = existing.filter(a => !targetRoleIds.some(id => idsAreEqual(id, a.roleId)));
        const toAdd = targetRoleIds.filter(id => !existing.some(a => idsAreEqual(a.roleId, id)));
        if (toRemove.length) {
            await repository.remove(toRemove);
        }
        if (toAdd.length) {
            await repository.save(toAdd.map(roleId => new RoleAssignment({ userId, roleId, channelId })));
        }
    }

    /**
     * @description
     * Atomically replaces the full set of the User's RoleAssignments across all Channels
     * with the given `(roleId, channelId)` pairs: pairs not in the new set are removed,
     * new pairs are added, unchanged pairs are left as-is.
     *
     * @since 4.0.0
     */
    async setAssignmentsForUser(
        ctx: RequestContext,
        userId: ID,
        assignments: RoleChannelPair[],
    ): Promise<RoleAssignment[]> {
        const repository = this.connection.getRepository(ctx, RoleAssignment);
        const existing = await repository.find({ where: { userId } });
        const target = this.dedupePairs(assignments);
        const toRemove = existing.filter(
            assignment =>
                !target.some(
                    pair =>
                        idsAreEqual(pair.roleId, assignment.roleId) &&
                        idsAreEqual(pair.channelId, assignment.channelId),
                ),
        );
        const toAdd = target.filter(
            pair =>
                !existing.some(
                    assignment =>
                        idsAreEqual(assignment.roleId, pair.roleId) &&
                        idsAreEqual(assignment.channelId, pair.channelId),
                ),
        );
        if (toRemove.length) {
            await repository.remove(toRemove);
        }
        if (toAdd.length) {
            await repository.save(
                toAdd.map(({ roleId, channelId }) => new RoleAssignment({ userId, roleId, channelId })),
            );
        }
        return repository.find({ where: { userId } });
    }

    private dedupePairs(pairs: RoleChannelPair[]): RoleChannelPair[] {
        return pairs.filter(
            (pair, index) =>
                pairs.findIndex(
                    other =>
                        idsAreEqual(other.roleId, pair.roleId) &&
                        idsAreEqual(other.channelId, pair.channelId),
                ) === index,
        );
    }

    /**
     * @description
     * Materializes a RoleAssignment on the given Channel for every User currently holding
     * the SuperAdmin Role on any Channel. Called on Channel creation: SuperAdmin *access*
     * to the new Channel is already granted at check time by the
     * {@link RolePermissionResolver}, so these rows are not what grants it — they keep
     * assignment reads (dashboard, plugins) consistent with what SuperAdmins can do.
     *
     * @since 4.0.0
     */
    async assignSuperAdminRoleHoldersToChannel(ctx: RequestContext, channelId: ID): Promise<void> {
        const superAdminRole = await this.connection
            .getRepository(ctx, Role)
            .findOne({ where: { code: SUPER_ADMIN_ROLE_CODE } });
        if (!superAdminRole) {
            // During bootstrap a Channel can be created before the SuperAdmin role exists.
            return;
        }
        const repository = this.connection.getRepository(ctx, RoleAssignment);
        const holderRows = await repository
            .createQueryBuilder('assignment')
            .select('DISTINCT assignment.userId', 'userId')
            .where('assignment.roleId = :roleId', { roleId: superAdminRole.id })
            .getRawMany<{ userId: ID }>();
        const existing = await repository.find({ where: { roleId: superAdminRole.id, channelId } });
        const toAdd = holderRows
            .map(row => row.userId)
            .filter(userId => !existing.some(assignment => idsAreEqual(assignment.userId, userId)));
        if (toAdd.length) {
            await repository.save(
                toAdd.map(userId => new RoleAssignment({ userId, roleId: superAdminRole.id, channelId })),
            );
        }
    }

    /**
     * @description
     * Assigns the Role to the User on every existing Channel. The counterpart of
     * {@link assignSuperAdminRoleHoldersToChannel}, used when a new SuperAdmin user is
     * seeded on an instance which already has Channels beyond the default one (e.g. after
     * `superadminCredentials.identifier` is changed in the config). Idempotent: Channels
     * on which the assignment already exists are left as-is.
     *
     * @since 4.0.0
     */
    async assignRoleOnAllChannels(ctx: RequestContext, userId: ID, roleId: ID): Promise<void> {
        const channels = await this.connection.getRepository(ctx, Channel).find();
        const repository = this.connection.getRepository(ctx, RoleAssignment);
        const existing = await repository.find({ where: { userId, roleId } });
        const toAdd = channels.filter(
            channel => !existing.some(assignment => idsAreEqual(assignment.channelId, channel.id)),
        );
        if (toAdd.length) {
            await repository.save(
                toAdd.map(channel => new RoleAssignment({ userId, roleId, channelId: channel.id })),
            );
        }
    }

    /**
     * @description
     * Assigns the Role to the User on the given Channel. Idempotent: an existing identical
     * assignment is left as-is.
     */
    async assignRoleOnChannel(
        ctx: RequestContext,
        userId: ID,
        roleId: ID,
        channelId: ID = ctx.channelId,
    ): Promise<void> {
        const repository = this.connection.getRepository(ctx, RoleAssignment);
        const existing = await repository.findOne({ where: { userId, roleId, channelId } });
        if (!existing) {
            await repository.save(new RoleAssignment({ userId, roleId, channelId }));
        }
    }
}
