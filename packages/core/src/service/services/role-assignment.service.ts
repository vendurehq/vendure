import { Injectable } from '@nestjs/common';
import { Permission } from '@vendure/common/lib/generated-types';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { ID, PaginatedList } from '@vendure/common/lib/shared-types';
import { unique } from '@vendure/common/lib/unique';
import { In, IsNull, LockNotSupportedOnGivenDriverError, ObjectLiteral, SelectQueryBuilder } from 'typeorm';

import { RequestContext } from '../../api/common/request-context';
import { RelationPaths } from '../../api/decorators/relations.decorator';
import { EntityNotFoundError, ForbiddenError, InternalServerError } from '../../common/error/errors';
import { Instrument } from '../../common/instrument-decorator';
import { ListQueryOptions } from '../../common/types/common-types';
import { idsAreEqual } from '../../common/utils';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { Administrator } from '../../entity/administrator/administrator.entity';
import { ApiKey } from '../../entity/api-key/api-key.entity';
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
 * the assignments they may change. Beneath them sit the unauthorized row primitives
 * {@link createAssignments}, {@link deleteAssignments} and {@link removeAllAssignmentsForUser},
 * for writes which have no actor to check against. Every one of these publishes a
 * {@link RoleAssignmentEvent} for the pairs it actually changed.
 *
 * The SuperAdmin Role is stored as a single row on the default Channel (see
 * {@link RoleAssignment}). {@link assign} and {@link remove} rewrite a SuperAdmin pair on any
 * Channel to that row, so there is never more than one SuperAdmin row per User.
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
     * Whether the active user has authority over the given User: true iff they may grant
     * ({@link RoleService.canGrant}) every RoleAssignment the User holds. A User holding no
     * assignments is in anyone's authority, and a SuperAdmin target is in a SuperAdmin's only.
     * This decides which Administrators the active user may see, update and delete.
     *
     * @since 4.0.0
     */
    async activeUserCanManageUser(ctx: RequestContext, userId: ID): Promise<boolean> {
        const assignments = await this.getAssignmentsForUser(ctx, userId);
        for (const assignment of assignments) {
            if (!(await this.roleService.canGrant(ctx, assignment.roleId, assignment.channelId))) {
                return false;
            }
        }
        return true;
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
     * hold no rows (see {@link removeAllAssignmentsForUser}), so none are returned.
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
     * Takes a write lock on the SuperAdmin Role row before counting, held until the
     * surrounding transaction commits. Two SuperAdmins removing or deleting each other at
     * the same time would otherwise both count two holders and leave none. The count is a
     * locking read too: under REPEATABLE READ (the MySQL and MariaDB default) a plain read
     * after the lock still sees the snapshot taken at the transaction's first read, so it
     * would miss the other transaction's committed write. Call it inside the transaction
     * which performs the write. On SQLite locks are not supported; SQLite serializes writes
     * itself.
     *
     * @since 4.0.0
     */
    async isSoleSuperAdminHolder(ctx: RequestContext, userId: ID): Promise<boolean> {
        const superAdminRole = await this.roleService.getSuperAdminRole(ctx);
        await this.withLockIfSupported(
            this.connection
                .getRepository(ctx, Role)
                .createQueryBuilder('role')
                .where('role.id = :id', { id: superAdminRole.id }),
            'pessimistic_write',
            qb => qb.getOne(),
        );
        const holders = await this.withLockIfSupported(
            this.connection
                .getRepository(ctx, Administrator)
                .createQueryBuilder('administrator')
                .innerJoin('administrator.user', 'user')
                .innerJoin(RoleAssignment, 'assignment', 'assignment.userId = user.id')
                .select('user.id', 'userId')
                .where('assignment.roleId = :roleId', { roleId: superAdminRole.id })
                .andWhere('administrator.deletedAt IS NULL'),
            'pessimistic_read',
            qb => qb.getRawMany<{ userId: ID }>(),
        );
        const holderIds = unique(holders.map(holder => holder.userId));
        return holderIds.length === 1 && idsAreEqual(holderIds[0], userId);
    }

    private async withLockIfSupported<E extends ObjectLiteral, T>(
        qb: SelectQueryBuilder<E>,
        lockMode: 'pessimistic_read' | 'pessimistic_write',
        run: (qb: SelectQueryBuilder<E>) => Promise<T>,
    ): Promise<T> {
        try {
            return await run(qb.clone().setLock(lockMode));
        } catch (e) {
            if (!(e instanceof LockNotSupportedOnGivenDriverError)) {
                throw e;
            }
            return run(qb);
        }
    }

    /**
     * @description
     * Grants the User each of the given `(roleId, channelId)` pairs. The active user must be
     * permitted to grant every pair ({@link RoleService.canGrant}), pairs the User already
     * holds included; those are then left as-is and not reported, so a write which changes
     * nothing publishes nothing. A SuperAdmin pair on any Channel is stored as the single
     * default-channel row (see {@link RoleAssignment}): the {@link RolePermissionResolver}
     * derives SuperAdmin access on every Channel from that one row.
     *
     * Publishes an `assigned` {@link RoleAssignmentEvent} for the pairs actually added, and
     * returns the User's assignments after the write.
     *
     * @throws {EntityNotFoundError} if the User, a Role or a Channel does not exist
     * @throws {UserInputError} if the active user may not grant one of the pairs
     * @since 4.0.0
     */
    async assign(ctx: RequestContext, userId: ID, pairs: RoleChannelPair[]): Promise<RoleAssignment[]> {
        const allChannels = await this.connection.getRepository(ctx, Channel).find();
        const target = await this.anchorSuperAdminPairs(ctx, pairs, allChannels);
        await this.roleService.assertActiveUserCanGrantRoles(ctx, target);
        for (const channelId of unique(pairs.map(pair => pair.channelId))) {
            if (!allChannels.some(channel => idsAreEqual(channel.id, channelId))) {
                throw new EntityNotFoundError('Channel', channelId);
            }
        }
        await this.createAssignments(ctx, userId, target);
        return this.getAssignmentsForUser(ctx, userId);
    }

    /**
     * @description
     * Revokes each of the given `(roleId, channelId)` pairs from the User. The rule is the
     * same as for {@link assign}: the active user must be permitted to grant every pair
     * ({@link RoleService.canGrant}), so what an actor may take away is exactly what they
     * could hand out. Pairs the User does not hold pass the same check and are then left
     * as-is and not reported. A SuperAdmin pair on any Channel addresses the single
     * default-channel row, mirroring {@link assign}, so removing SuperAdmin on any Channel
     * removes it everywhere. The sole SuperAdmin cannot have the SuperAdmin Role taken away.
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
        const superAdminRole = await this.roleService.getSuperAdminRole(ctx);
        const target = await this.anchorSuperAdminPairs(ctx, pairs);
        await this.roleService.assertActiveUserCanGrantRoles(ctx, target);
        const removesSuperAdmin = target.some(pair => idsAreEqual(pair.roleId, superAdminRole.id));
        if (removesSuperAdmin && (await this.isSoleSuperAdminHolder(ctx, userId))) {
            throw new InternalServerError('error.superadmin-must-have-superadmin-role');
        }
        await this.deleteAssignments(ctx, userId, target);
        return this.getAssignmentsForUser(ctx, userId);
    }

    /**
     * @description
     * Asserts that the User may be the target of an actor-made {@link assign} or {@link remove}.
     * The target must be a non-deleted Administrator, or the User of a non-deleted ApiKey which
     * belongs to the active Channel, in which case the active user must also hold
     * `UpdateApiKey` there. Any other User, a Customer's User included, is reported as not
     * found, so that admin Roles cannot be granted to it and its existence is not disclosed.
     *
     * {@link assign} and {@link remove} do not call this themselves: the services which create
     * Administrators and ApiKeys assign Roles to a User whose entity they are still writing.
     *
     * @throws {EntityNotFoundError} if the User is neither a non-deleted Administrator nor the
     * User of a non-deleted ApiKey on the active Channel
     * @throws {ForbiddenError} if the User belongs to an ApiKey and the active user does not
     * hold `UpdateApiKey` on the active Channel
     * @since 4.0.0
     */
    async assertManageableSubject(ctx: RequestContext, userId: ID): Promise<void> {
        const administrator = await this.connection.getRepository(ctx, Administrator).findOne({
            where: { user: { id: userId }, deletedAt: IsNull() },
        });
        if (administrator) {
            return;
        }
        const apiKey = await this.connection.getRepository(ctx, ApiKey).findOne({
            where: { userId, deletedAt: IsNull() },
        });
        const apiKeyOnChannel =
            apiKey && (await this.connection.findOneInChannel(ctx, ApiKey, apiKey.id, ctx.channelId));
        if (!apiKeyOnChannel) {
            throw new EntityNotFoundError('User', userId);
        }
        if (!ctx.userHasPermissions([Permission.UpdateApiKey])) {
            throw new ForbiddenError();
        }
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
     * Creates a RoleAssignment for each of the given `(roleId, channelId)` pairs the User does
     * not already hold, and publishes one `assigned` {@link RoleAssignmentEvent} for the pairs
     * added. Nothing is published when nothing changes.
     *
     * Performs no authorization and no SuperAdmin anchoring: this is the row primitive beneath
     * {@link assign}, for writes which have no actor to check against, such as granting a User
     * created by an authentication strategy the Roles that strategy resolved. Actor-made
     * changes go through {@link assign}.
     *
     * @throws {EntityNotFoundError} if the User does not exist
     * @since 4.0.0
     */
    async createAssignments(ctx: RequestContext, userId: ID, pairs: RoleChannelPair[]): Promise<void> {
        const user = await this.connection.getEntityOrThrow(ctx, User, userId);
        const repository = this.connection.getRepository(ctx, RoleAssignment);
        const existing = await repository.find({ where: { userId } });
        const toAdd = this.dedupePairs(pairs).filter(
            pair => !existing.some(assignment => this.matches(assignment, pair)),
        );
        if (!toAdd.length) {
            return;
        }
        await repository.save(
            toAdd.map(({ roleId, channelId }) => new RoleAssignment({ userId, roleId, channelId })),
        );
        await this.eventBus.publish(new RoleAssignmentEvent(ctx, user, toAdd, 'assigned'));
    }

    /**
     * @description
     * Deletes the User's RoleAssignments matching the given `(roleId, channelId)` pairs, and
     * publishes one `removed` {@link RoleAssignmentEvent} for the pairs removed. Pairs the User
     * does not hold are ignored, and nothing is published when nothing changes.
     *
     * Performs no authorization, no SuperAdmin anchoring and no sole-SuperAdmin guard: this is
     * the row primitive beneath {@link remove}. Actor-made changes go through {@link remove}.
     *
     * @throws {EntityNotFoundError} if the User does not exist
     * @since 4.0.0
     */
    async deleteAssignments(ctx: RequestContext, userId: ID, pairs: RoleChannelPair[]): Promise<void> {
        const user = await this.connection.getEntityOrThrow(ctx, User, userId);
        const existing = await this.getAssignmentsForUser(ctx, userId);
        const target = this.dedupePairs(pairs);
        const toRemove = existing.filter(assignment => target.some(pair => this.matches(assignment, pair)));
        await this.removeRows(ctx, user, toRemove);
    }

    /**
     * @description
     * Deletes every RoleAssignment of the User across all Channels, and publishes one
     * `removed` {@link RoleAssignmentEvent} for them. Nothing is published for a User
     * holding no assignments.
     *
     * Performs no authorization and no sole-SuperAdmin guard: this is the primitive behind
     * the Administrator and API-Key soft-deletes, which must clear the rows of the deleted
     * User. Left in place, those rows would keep counting towards the Channels a Role is
     * assigned on (see {@link RoleService}) and so keep gating the Role for live administrators.
     *
     * @throws {EntityNotFoundError} if the User does not exist
     * @since 4.0.0
     */
    async removeAllAssignmentsForUser(ctx: RequestContext, userId: ID): Promise<void> {
        const user = await this.connection.getEntityOrThrow(ctx, User, userId);
        const existing = await this.getAssignmentsForUser(ctx, userId);
        await this.removeRows(ctx, user, existing);
    }

    /**
     * @description
     * Deletes every RoleAssignment on the given Channel, and publishes one `removed`
     * {@link RoleAssignmentEvent} per affected User. Call it before the Channel row is
     * deleted: the foreign key would otherwise cascade the rows away with no event and no
     * eviction of the affected Users' cached sessions.
     *
     * Performs no authorization and no sole-SuperAdmin guard: this is the primitive behind
     * the Channel delete. The SuperAdmin row lives on the default Channel, which cannot be
     * deleted.
     *
     * @since 4.0.0
     */
    async removeAllAssignmentsOnChannel(ctx: RequestContext, channelId: ID): Promise<void> {
        const rows = await this.connection
            .getRepository(ctx, RoleAssignment)
            .find({ where: { channelId }, relations: { user: true } });
        for (const userId of unique(rows.map(row => row.userId))) {
            const userRows = rows.filter(row => idsAreEqual(row.userId, userId));
            await this.removeRows(ctx, userRows[0].user, userRows);
        }
    }

    private async removeRows(ctx: RequestContext, user: User, rows: RoleAssignment[]): Promise<void> {
        if (!rows.length) {
            return;
        }
        await this.connection.getRepository(ctx, RoleAssignment).remove(rows);
        await this.eventBus.publish(
            new RoleAssignmentEvent(
                ctx,
                user,
                rows.map(({ roleId, channelId }) => ({ roleId, channelId })),
                'removed',
            ),
        );
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
     * The SuperAdmin Role is held everywhere or not at all, so it is stored as exactly one
     * row per User, on the default Channel (see {@link RoleAssignment}). Rewrites every
     * SuperAdmin pair to that row, so that assign and remove on any Channel address it.
     */
    private async anchorSuperAdminPairs(
        ctx: RequestContext,
        pairs: RoleChannelPair[],
        channels?: Channel[],
    ): Promise<RoleChannelPair[]> {
        const superAdminRole = await this.roleService.getSuperAdminRole(ctx);
        if (!pairs.some(pair => idsAreEqual(pair.roleId, superAdminRole.id))) {
            return this.dedupePairs(pairs);
        }
        const allChannels = channels ?? (await this.connection.getRepository(ctx, Channel).find());
        const defaultChannel = allChannels.find(channel => channel.code === DEFAULT_CHANNEL_CODE);
        if (!defaultChannel) {
            throw new InternalServerError('error.default-channel-not-found');
        }
        return this.dedupePairs(
            pairs.map(pair =>
                idsAreEqual(pair.roleId, superAdminRole.id)
                    ? { roleId: pair.roleId, channelId: defaultChannel.id }
                    : pair,
            ),
        );
    }
}
