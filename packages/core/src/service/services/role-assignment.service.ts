import { Injectable } from '@nestjs/common';
import { SUPER_ADMIN_ROLE_CODE } from '@vendure/common/lib/shared-constants';
import { ID, PaginatedList } from '@vendure/common/lib/shared-types';
import { unique } from '@vendure/common/lib/unique';
import { In, IsNull } from 'typeorm';

import { RequestContext } from '../../api/common/request-context';
import { RelationPaths } from '../../api/decorators/relations.decorator';
import { EntityNotFoundError, InternalServerError } from '../../common/error/errors';
import { Instrument } from '../../common/instrument-decorator';
import { ListQueryOptions } from '../../common/types/common-types';
import { idsAreEqual } from '../../common/utils';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { Administrator } from '../../entity/administrator/administrator.entity';
import { Channel } from '../../entity/channel/channel.entity';
import { RoleAssignment } from '../../entity/role-assignment/role-assignment.entity';
import { Role } from '../../entity/role/role.entity';
import { User } from '../../entity/user/user.entity';
import { EventBus } from '../../event-bus/event-bus';
import { RoleAssignmentEvent } from '../../event-bus/events/role-assignment-event';
import { ListQueryBuilder } from '../helpers/list-query-builder/list-query-builder';
import {
    ResolvedUserPermissions,
    RolePermissionResolver,
} from '../helpers/role-permission-resolver/role-permission-resolver';

import { RoleService } from './role.service';

/**
 * @description
 * A `(roleId, channelId)` pair identifying the grant of a Role on a Channel, as taken by
 * {@link RoleAssignmentService.assign} and {@link RoleAssignmentService.remove}.
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
 * The actor-made writes are {@link assign} and {@link remove}. Both authorize every pair
 * through {@link RoleService.canGrant}, and the filtered reads ({@link findAll},
 * {@link getGrantableAssignmentsForUser}) apply the same predicate, so an actor sees exactly
 * the assignments they may change. {@link setAssignmentsForUser} is the unauthorized
 * primitive beneath them, for writes which have no actor to check against.
 *
 * All writes go through entity-based repository operations so that {@link SessionService}'s
 * entity subscriber observes them and evicts the affected User's cached sessions — permission
 * changes therefore take effect on the User's next request.
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
        private eventBus: EventBus,
        private roleService: RoleService,
    ) {}

    /**
     * @description
     * Returns a paginated list of the RoleAssignments the active user may grant or remove
     * ({@link RoleService.canGrant}). Assignments outside that set are neither returned nor
     * counted, so for an actor who does not hold every permission on every Channel the list
     * is partial: it is the set of grants they may change, not the full set of a User's grants.
     */
    async findAll(
        ctx: RequestContext,
        options?: ListQueryOptions<RoleAssignment>,
        relations?: RelationPaths<RoleAssignment>,
    ): Promise<PaginatedList<RoleAssignment>> {
        const grantable = await this.roleService.getGrantableChannelIdsByRole(ctx);
        if (grantable.length === 0) {
            return { items: [], totalItems: 0 };
        }
        const qb = this.listQueryBuilder.build(RoleAssignment, options, {
            relations: relations ?? [],
            ctx,
        });
        const roleCount = await this.connection.getRepository(ctx, Role).count();
        const channelCount = await this.connection.getRepository(ctx, Channel).count();
        const grantsEverything =
            grantable.length === roleCount && grantable.every(g => g.channelIds.length === channelCount);
        if (!grantsEverything) {
            // One disjunct per grantable Role, narrowed to its grantable Channels unless the
            // Role is grantable on every Channel.
            qb.andWhere(
                grantable.map(({ roleId, channelIds }) =>
                    channelIds.length === channelCount ? { roleId } : { roleId, channelId: In(channelIds) },
                ),
            );
        }
        return qb.getManyAndCount().then(([items, totalItems]) => ({ items, totalItems }));
    }

    /**
     * @description
     * Returns all RoleAssignments of the given User across all Channels, unfiltered. For
     * what the active user may see of them, use {@link getGrantableAssignmentsForUser}.
     */
    getAssignmentsForUser(ctx: RequestContext, userId: ID): Promise<RoleAssignment[]> {
        return this.connection.getRepository(ctx, RoleAssignment).find({ where: { userId } });
    }

    /**
     * @description
     * Returns the RoleAssignments of the given User which the active user may grant or
     * remove ({@link RoleService.canGrant}). This is what `User.roleAssignments` resolves to
     * in the Admin API.
     *
     * @since 4.0.0
     */
    async getGrantableAssignmentsForUser(ctx: RequestContext, userId: ID): Promise<RoleAssignment[]> {
        const assignments = await this.getAssignmentsForUser(ctx, userId);
        const grantable: RoleAssignment[] = [];
        for (const assignment of assignments) {
            if (await this.roleService.canGrant(ctx, assignment.roleId, assignment.channelId)) {
                grantable.push(assignment);
            }
        }
        return grantable;
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
     * Returns the ids of all Users holding the given Role on any Channel. Soft-deleted Users
     * hold no rows (see {@link setAssignmentsForUser}), so none are returned.
     */
    async resolveUserIdsWithRole(ctx: RequestContext, roleId: ID): Promise<ID[]> {
        const assignments = await this.connection.getRepository(ctx, RoleAssignment).find({
            where: { roleId },
        });
        return unique(assignments.map(assignment => assignment.userId));
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
     * Whether the given User is the only non-deleted Administrator holding the SuperAdmin
     * Role. There must always be one, otherwise full administration through the API is no
     * longer possible: {@link remove} and the Administrator soft-delete both refuse to break
     * this.
     *
     * @since 4.0.0
     */
    async isSoleSuperAdminHolder(ctx: RequestContext, userId: ID): Promise<boolean> {
        const superAdminRole = await this.roleService.getSuperAdminRole(ctx);
        const holderIds = await this.resolveUserIdsWithRole(ctx, superAdminRole.id);
        if (!holderIds.some(id => idsAreEqual(id, userId))) {
            return false;
        }
        const superAdmins = await this.connection.getRepository(ctx, Administrator).find({
            relations: ['user'],
            where: { deletedAt: IsNull(), user: { id: In(holderIds) } },
        });
        return superAdmins.length === 1 && idsAreEqual(superAdmins[0].user.id, userId);
    }

    /**
     * @description
     * Grants the User each of the given `(roleId, channelId)` pairs. The active user must be
     * permitted to grant every pair ({@link RoleService.canGrant}), pairs the User already
     * holds included; those are then left as-is and not reported, so a write which changes
     * nothing publishes nothing. Granting the SuperAdmin Role on any Channel grants it on
     * every Channel: the {@link RolePermissionResolver} derives SuperAdmin access on all
     * Channels from a single row, and the stored rows must match that access.
     *
     * Publishes an `assigned` {@link RoleAssignmentEvent} for the pairs actually added, and
     * returns the User's assignments after the write.
     *
     * @throws {EntityNotFoundError} if the User, a Role or a Channel does not exist
     * @throws {UserInputError} if the active user may not grant one of the pairs
     * @since 4.0.0
     */
    async assign(ctx: RequestContext, userId: ID, pairs: RoleChannelPair[]): Promise<RoleAssignment[]> {
        const user = await this.connection.getEntityOrThrow(ctx, User, userId);
        const superAdminRole = await this.roleService.getSuperAdminRole(ctx);
        const allChannels = await this.connection.getRepository(ctx, Channel).find();
        let target = this.dedupePairs(pairs);
        if (target.some(pair => idsAreEqual(pair.roleId, superAdminRole.id))) {
            target = this.dedupePairs([
                ...target,
                ...allChannels.map(channel => ({ roleId: superAdminRole.id, channelId: channel.id })),
            ]);
        }
        await this.roleService.assertActiveUserCanGrantRoles(ctx, target);
        for (const channelId of unique(target.map(pair => pair.channelId))) {
            if (!allChannels.some(channel => idsAreEqual(channel.id, channelId))) {
                throw new EntityNotFoundError('Channel', channelId);
            }
        }
        const repository = this.connection.getRepository(ctx, RoleAssignment);
        const existing = await repository.find({ where: { userId } });
        const toAdd = target.filter(pair => !existing.some(assignment => this.matches(assignment, pair)));
        if (toAdd.length) {
            await repository.save(
                toAdd.map(({ roleId, channelId }) => new RoleAssignment({ userId, roleId, channelId })),
            );
            await this.eventBus.publish(new RoleAssignmentEvent(ctx, user, toAdd, 'assigned'));
        }
        return repository.find({ where: { userId } });
    }

    /**
     * @description
     * Revokes each of the given `(roleId, channelId)` pairs from the User. The rule is the
     * same as for {@link assign}: the active user must be permitted to grant every pair
     * ({@link RoleService.canGrant}), so what an actor may take away is exactly what they
     * could hand out. Pairs the User does not hold pass the same check and are then left
     * as-is and not reported. Removing the SuperAdmin Role on any Channel removes it on
     * every Channel, mirroring the expansion on assign. The sole SuperAdmin cannot have the
     * SuperAdmin Role taken away.
     *
     * Publishes a `removed` {@link RoleAssignmentEvent} for the pairs actually removed, and
     * returns the User's assignments after the write.
     *
     * @throws {EntityNotFoundError} if the User or a Role does not exist
     * @throws {UserInputError} if the active user may not grant one of the pairs
     * @throws {InternalServerError} if a pair names the SuperAdmin Role and the User is the sole SuperAdmin
     * @since 4.0.0
     */
    async remove(ctx: RequestContext, userId: ID, pairs: RoleChannelPair[]): Promise<RoleAssignment[]> {
        const user = await this.connection.getEntityOrThrow(ctx, User, userId);
        const superAdminRole = await this.roleService.getSuperAdminRole(ctx);
        const repository = this.connection.getRepository(ctx, RoleAssignment);
        const existing = await repository.find({ where: { userId } });
        let target = this.dedupePairs(pairs);
        const removesSuperAdmin = target.some(pair => idsAreEqual(pair.roleId, superAdminRole.id));
        if (removesSuperAdmin) {
            target = this.dedupePairs([
                ...target,
                ...existing
                    .filter(assignment => idsAreEqual(assignment.roleId, superAdminRole.id))
                    .map(assignment => ({ roleId: assignment.roleId, channelId: assignment.channelId })),
            ]);
        }
        await this.roleService.assertActiveUserCanGrantRoles(ctx, target);
        if (removesSuperAdmin && (await this.isSoleSuperAdminHolder(ctx, userId))) {
            throw new InternalServerError('error.superadmin-must-have-superadmin-role');
        }
        const toRemove = existing.filter(assignment => target.some(pair => this.matches(assignment, pair)));
        if (toRemove.length) {
            await repository.remove(toRemove);
            await this.eventBus.publish(
                new RoleAssignmentEvent(
                    ctx,
                    user,
                    toRemove.map(assignment => ({
                        roleId: assignment.roleId,
                        channelId: assignment.channelId,
                    })),
                    'removed',
                ),
            );
        }
        return repository.find({ where: { userId } });
    }

    /**
     * @description
     * Implements the deprecated `roleIds` inputs of the administrator and API-key mutations,
     * which replace the User's Roles on one Channel. The replacement is applied as deltas:
     * Roles in `roleIds` not yet held on the Channel are granted through {@link assign},
     * Roles held there but absent from `roleIds` are revoked through {@link remove}, so every
     * changed pair is authorized by {@link RoleService.canGrant}. A `roleIds` list which
     * omits a pair the active user may not revoke fails rather than being applied in part.
     *
     * The `roleIds` inputs are deprecated since 4.0.0 in favor of the `assignRolesToUser` and
     * `removeRolesFromUser` mutations. Remove this method in v5.0.0 together with them.
     */
    async replaceRolesOnChannel(
        ctx: RequestContext,
        userId: ID,
        roleIds: ID[],
        channelId: ID = ctx.channelId,
    ): Promise<void> {
        const existing = await this.connection
            .getRepository(ctx, RoleAssignment)
            .find({ where: { userId, channelId } });
        const targetRoleIds = unique(roleIds);
        const toAdd = targetRoleIds
            .filter(roleId => !existing.some(assignment => idsAreEqual(assignment.roleId, roleId)))
            .map(roleId => ({ roleId, channelId }));
        const toRemove = existing
            .filter(assignment => !targetRoleIds.some(roleId => idsAreEqual(roleId, assignment.roleId)))
            .map(assignment => ({ roleId: assignment.roleId, channelId }));
        if (toAdd.length) {
            await this.assign(ctx, userId, toAdd);
        }
        if (toRemove.length) {
            await this.remove(ctx, userId, toRemove);
        }
    }

    /**
     * @description
     * Replaces the full set of the User's RoleAssignments across all Channels with the given
     * `(roleId, channelId)` pairs: pairs not in the new set are removed, new pairs are added,
     * unchanged pairs are left as-is.
     *
     * Performs no authorization and no SuperAdmin expansion: it is the primitive for writes
     * which have no actor to check against, namely clearing the rows of a soft-deleted
     * Administrator or API-Key User and granting a User created by an authentication strategy
     * the Roles that strategy resolved. Actor-made changes go through {@link assign} and {@link remove}.
     *
     * Publishes a {@link RoleAssignmentEvent} for the added and for the removed pairs.
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
        const toRemove = existing.filter(assignment => !target.some(pair => this.matches(assignment, pair)));
        const toAdd = target.filter(pair => !existing.some(assignment => this.matches(assignment, pair)));
        if (toRemove.length) {
            await repository.remove(toRemove);
        }
        if (toAdd.length) {
            await repository.save(
                toAdd.map(({ roleId, channelId }) => new RoleAssignment({ userId, roleId, channelId })),
            );
        }
        await this.publishAssignmentEvents(
            ctx,
            userId,
            toAdd,
            toRemove.map(assignment => ({ roleId: assignment.roleId, channelId: assignment.channelId })),
        );
        return repository.find({ where: { userId } });
    }

    /**
     * Publishes one `assigned` and/or one `removed` {@link RoleAssignmentEvent} for the
     * pairs a write actually changed. Nothing is published for a no-op write. Deliberately
     * not called by the system-mandated writes ({@link assignSuperAdminRoleHoldersToChannel},
     * {@link assignRoleOnAllChannels}), which stay silent as their legacy counterparts did.
     */
    private async publishAssignmentEvents(
        ctx: RequestContext,
        userId: ID,
        added: RoleChannelPair[],
        removed: RoleChannelPair[],
    ): Promise<void> {
        if (!added.length && !removed.length) {
            return;
        }
        const user = await this.connection.getEntityOrThrow(ctx, User, userId);
        if (added.length) {
            await this.eventBus.publish(new RoleAssignmentEvent(ctx, user, added, 'assigned'));
        }
        if (removed.length) {
            await this.eventBus.publish(new RoleAssignmentEvent(ctx, user, removed, 'removed'));
        }
    }

    private matches(assignment: RoleAssignment, pair: RoleChannelPair): boolean {
        return (
            idsAreEqual(assignment.roleId, pair.roleId) && idsAreEqual(assignment.channelId, pair.channelId)
        );
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
