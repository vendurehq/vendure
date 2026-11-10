import { Injectable } from '@nestjs/common';
import { Permission, RoleAssignmentInput } from '@vendure/common/lib/generated-types';
import { CUSTOMER_ROLE_CODE } from '@vendure/common/lib/shared-constants';
import { ID, PaginatedList } from '@vendure/common/lib/shared-types';
import { unique } from '@vendure/common/lib/unique';
import { IsNull, NotBrackets, ObjectLiteral, SelectQueryBuilder } from 'typeorm';

import { RequestContext } from '../../api/common/request-context';
import { RelationPaths } from '../../api/decorators/relations.decorator';
import {
    EntityNotFoundError,
    ForbiddenError,
    IllegalOperationError,
    InternalServerError,
    UserInputError,
} from '../../common/error/errors';
import { Instrument } from '../../common/instrument-decorator';
import { ListQueryOptions } from '../../common/types/common-types';
import { idsAreEqual } from '../../common/utils';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { Administrator } from '../../entity/administrator/administrator.entity';
import { ApiKey } from '../../entity/api-key/api-key.entity';
import { Channel } from '../../entity/channel/channel.entity';
import { Role } from '../../entity/role/role.entity';
import { RoleAssignment } from '../../entity/role-assignment/role-assignment.entity';
import { User } from '../../entity/user/user.entity';
import { EventBus } from '../../event-bus/event-bus';
import { RoleAssignmentEvent } from '../../event-bus/events/role-assignment-event';
import { ListQueryBuilder } from '../helpers/list-query-builder/list-query-builder';
import { withLockIfSupported } from '../helpers/utils/with-lock-if-supported';

import { RoleService } from './role.service';

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
        private listQueryBuilder: ListQueryBuilder,
        private eventBus: EventBus,
        private roleService: RoleService,
    ) {}

    /**
     * @description
     * Returns a paginated list of the RoleAssignments the active user may grant or remove: the
     * assignments of the Users they have authority over ({@link activeUserCanManageUser}).
     * Since that authority means the active user may grant every assignment the User holds
     * ({@link RoleService.canGrant}), a User's assignments are either all listed or none.
     * Assignments outside that set are neither returned nor counted, so for an actor who does
     * not hold every permission on every Channel the list is partial.
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
        await this.restrictToManageableUsers(ctx, qb);
        return qb.getManyAndCount().then(([items, totalItems]) => ({ items, totalItems }));
    }

    /**
     * @description
     * Restricts a list query to the rows whose User the active user has authority over
     * ({@link activeUserCanManageUser}): it excludes every row whose User holds a single
     * RoleAssignment the active user may not grant. The restriction is applied to the query
     * rather than to its result, so that `totalItems`, sorting, filtering and pagination all
     * operate over the visible rows only.
     *
     * With `unassignedAdministratorPermission`, an Administrator holding no assignments is
     * kept only if the active user holds that permission on every Channel (see
     * {@link activeUserCanManageUser}).
     *
     * @param userIdProperty the property of the query's main alias which holds the User id
     */
    async restrictToManageableUsers<E extends ObjectLiteral>(
        ctx: RequestContext,
        qb: SelectQueryBuilder<E>,
        userIdProperty = 'userId',
        unassignedAdministratorPermission?: Permission,
    ): Promise<void> {
        // A SuperAdmin may grant every assignment. This early return only saves the query.
        if (ctx.userHasPermissions([Permission.SuperAdmin])) {
            return;
        }
        if (
            unassignedAdministratorPermission &&
            !(await this.activeUserHoldsPermissionOnEveryChannel(ctx, unassignedAdministratorPermission))
        ) {
            qb.andWhere(outerQb => {
                const assignedQuery = outerQb
                    .subQuery()
                    .select('assigned.userId')
                    .from(RoleAssignment, 'assigned')
                    .getQuery();
                const userId = `${outerQb.escape(outerQb.alias)}.${outerQb.escape(userIdProperty)}`;
                return `${userId} IN ${assignedQuery}`;
            });
        }
        const grantable = await this.roleService.getGrantableChannelIdsByRole(ctx);
        const roleCount = await this.connection.getRepository(ctx, Role).count();
        if (grantable.length === roleCount && grantable.every(g => g.everywhere)) {
            return;
        }
        qb.andWhere(outerQb => {
            const ungrantableQuery = outerQb
                .subQuery()
                .select('ungrantable.userId')
                .from(RoleAssignment, 'ungrantable');
            // With nothing grantable, every assignment is ungrantable, so no condition is needed.
            if (grantable.length) {
                ungrantableQuery.where(
                    new NotBrackets(grantableQb => {
                        // A Role grantable on every Channel it may be assigned on needs no Channel
                        // list, which keeps the parameter count down on instances with many
                        // Channels.
                        grantable.forEach(({ roleId, channelIds, everywhere }, i) => {
                            if (everywhere) {
                                grantableQb.orWhere(`ungrantable.roleId = :grantableRole${i}`, {
                                    [`grantableRole${i}`]: roleId,
                                });
                            } else {
                                grantableQb.orWhere(
                                    `(ungrantable.roleId = :grantableRole${i} AND ungrantable.channelId IN (:...grantableChannels${i}))`,
                                    { [`grantableRole${i}`]: roleId, [`grantableChannels${i}`]: channelIds },
                                );
                            }
                        });
                    }),
                );
            }
            const userId = `${outerQb.escape(outerQb.alias)}.${outerQb.escape(userIdProperty)}`;
            return `${userId} NOT IN ${ungrantableQuery.getQuery()}`;
        });
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
     * remove: all of them if the active user has authority over the User
     * ({@link activeUserCanManageUser}), none otherwise, as in {@link findAll}. This is what
     * `User.roleAssignments` resolves to in the Admin API.
     */
    async getGrantableAssignmentsForUser(ctx: RequestContext, userId: ID): Promise<RoleAssignment[]> {
        const assignments = await this.getAssignmentsForUser(ctx, userId);
        for (const assignment of assignments) {
            if (!(await this.roleService.canGrant(ctx, assignment.roleId, assignment.channelId))) {
                return [];
            }
        }
        return assignments;
    }

    /**
     * @description
     * Whether the active user has authority over the given User: true iff they may grant
     * ({@link RoleService.canGrant}) every RoleAssignment the User holds. A SuperAdmin target is
     * therefore in a SuperAdmin's authority only. This decides which Administrators the active
     * user may see, update and delete.
     *
     * An Administrator holding no assignments belongs to no Channel, for instance after all of
     * their Roles were removed to suspend them. Such an Administrator is in the authority of an
     * active user holding `unassignedAdministratorPermission` on every Channel only, so that an
     * Administrator of one Channel cannot take over a suspended Administrator of another. The
     * User of an ApiKey holding no assignments is in anyone's authority: ApiKeys are looked up
     * on the active Channel, which already scopes them.
     */
    async activeUserCanManageUser(
        ctx: RequestContext,
        userId: ID,
        unassignedAdministratorPermission: Permission = Permission.ReadAdministrator,
    ): Promise<boolean> {
        const assignments = await this.getAssignmentsForUser(ctx, userId);
        if (assignments.length === 0) {
            const isAdministrator = await this.connection
                .getRepository(ctx, Administrator)
                .exists({ where: { user: { id: userId } } });
            return (
                !isAdministrator ||
                this.activeUserHoldsPermissionOnEveryChannel(ctx, unassignedAdministratorPermission)
            );
        }
        for (const assignment of assignments) {
            if (!(await this.roleService.canGrant(ctx, assignment.roleId, assignment.channelId))) {
                return false;
            }
        }
        return true;
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
     */
    async isSoleSuperAdminHolder(ctx: RequestContext, userId: ID): Promise<boolean> {
        const superAdminRole = await this.roleService.getSuperAdminRole(ctx);
        await withLockIfSupported(
            this.connection
                .getRepository(ctx, Role)
                .createQueryBuilder('role')
                .where('role.id = :id', { id: superAdminRole.id }),
            'pessimistic_write',
            qb => qb.getOne(),
        );
        const holders = await withLockIfSupported(
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
     */
    async assign(ctx: RequestContext, userId: ID, pairs: RoleAssignmentInput[]): Promise<RoleAssignment[]> {
        const allChannels = await this.connection.getRepository(ctx, Channel).find();
        const target = await this.anchorSuperAdminPairs(ctx, pairs);
        await this.roleService.assertActiveUserCanGrantRoles(ctx, target);
        const apiKey = await this.connection.getRepository(ctx, ApiKey).findOne({
            where: { userId, deletedAt: IsNull() },
            relations: { channels: true },
        });
        if (apiKey) {
            await this.assertValidApiKeyGrants(
                ctx,
                apiKey.channels.map(channel => channel.id),
                pairs,
            );
        }
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
     */
    async remove(ctx: RequestContext, userId: ID, pairs: RoleAssignmentInput[]): Promise<RoleAssignment[]> {
        const superAdminRole = await this.roleService.getSuperAdminRole(ctx);
        const target = await this.anchorSuperAdminPairs(ctx, pairs);
        await this.roleService.assertActiveUserCanGrantRoles(ctx, target);
        const removesSuperAdmin = target.some(pair => idsAreEqual(pair.roleId, superAdminRole.id));
        if (removesSuperAdmin && (await this.isSoleSuperAdminHolder(ctx, userId))) {
            throw new InternalServerError('error.superadmin-must-have-superadmin-role');
        }
        if (ctx.activeUserId != null && idsAreEqual(userId, ctx.activeUserId)) {
            // Removing one's own last assignment locks the active user out with no way back
            // through the API, so it is refused. Other changes to one's own Roles cannot escalate,
            // since the grant rule still applies.
            const existing = await this.getAssignmentsForUser(ctx, userId);
            const remaining = existing.filter(
                assignment => !this.selectRows([assignment], target, superAdminRole.id).length,
            );
            if (existing.length && !remaining.length) {
                throw new UserInputError('error.cannot-remove-own-last-role-assignment');
            }
        }
        await this.deleteAssignments(ctx, userId, target);
        return this.getAssignmentsForUser(ctx, userId);
    }

    /**
     * @description
     * Asserts that the active user may change the given `(roleId, channelId)` pairs of the
     * User through an actor-made {@link assign} or {@link remove}:
     *
     * - The User must be a non-deleted Administrator, or the User of a non-deleted ApiKey which
     *   belongs to the active Channel. Any other User, a Customer's User included, is reported
     *   as not found, so that admin Roles cannot be granted to it and its existence is not
     *   disclosed.
     * - The active user must have authority over the User ({@link activeUserCanManageUser}):
     *   they may change the assignments only of a User whose every assignment they could
     *   grant themselves. This is the same rule which decides which Administrators they may
     *   see, so a User outside it is reported as not found too.
     * - The active user must hold `UpdateAdministrator` (for an Administrator) or
     *   `UpdateApiKey` (for an ApiKey) on the Channel of every pair, not just on the active
     *   Channel which the `@Allow()` decorator checks.
     *
     * {@link assign} and {@link remove} do not call this themselves: the services which create
     * Administrators and ApiKeys assign Roles to a User whose entity they are still writing.
     * They check the pairs' Channels with {@link assertActiveUserHasPermissionOnChannels}.
     *
     * @throws {EntityNotFoundError} if the User is neither a non-deleted Administrator nor the
     * User of a non-deleted ApiKey on the active Channel, or the active user has no authority
     * over it
     * @throws {ForbiddenError} if the active user lacks the update permission on the active
     * Channel or on the Channel of one of the pairs
     */
    async assertManageableSubject(
        ctx: RequestContext,
        userId: ID,
        pairs: RoleAssignmentInput[],
    ): Promise<void> {
        const permission = await this.getSubjectUpdatePermission(ctx, userId);
        if (!(await this.activeUserCanManageUser(ctx, userId, permission))) {
            throw new EntityNotFoundError('User', userId);
        }
        this.assertActiveUserHasPermissionOnChannels(ctx, permission, [
            ctx.channelId,
            ...pairs.map(pair => pair.channelId),
        ]);
    }

    /**
     * @description
     * Asserts that the active user holds the permission on every one of the given Channels,
     * typically the Channels of the `(roleId, channelId)` pairs an actor-made write names. The
     * `@Allow()` decorator checks a mutation's permission on the active Channel only, while a
     * pair may name any Channel: without this check an actor holding `UpdateAdministrator` on
     * one Channel and a Role's permissions on another could change that other Channel's
     * assignments.
     *
     * @throws {ForbiddenError} if the active user lacks the permission on one of the Channels
     */
    assertActiveUserHasPermissionOnChannels(
        ctx: RequestContext,
        permission: Permission,
        channelIds: ID[],
    ): void {
        for (const channelId of unique(channelIds)) {
            if (!ctx.userHasPermissions([permission], channelId)) {
                throw new ForbiddenError();
            }
        }
    }

    /**
     * The permission which guards changing the assignments of the User: `UpdateAdministrator`
     * for an Administrator, `UpdateApiKey` for the User of an ApiKey on the active Channel.
     */
    private async activeUserHoldsPermissionOnEveryChannel(
        ctx: RequestContext,
        permission: Permission,
    ): Promise<boolean> {
        if (ctx.userHasPermissions([Permission.SuperAdmin])) {
            return true;
        }
        const channels = await this.connection.getRepository(ctx, Channel).find({ select: { id: true } });
        return channels.every(channel => ctx.userHasPermissions([permission], channel.id));
    }

    private async getSubjectUpdatePermission(ctx: RequestContext, userId: ID): Promise<Permission> {
        const administrator = await this.connection.getRepository(ctx, Administrator).findOne({
            where: { user: { id: userId }, deletedAt: IsNull() },
        });
        if (administrator) {
            return Permission.UpdateAdministrator;
        }
        const apiKey = await this.connection.getRepository(ctx, ApiKey).findOne({
            where: { userId, deletedAt: IsNull() },
        });
        const apiKeyOnChannel =
            apiKey && (await this.connection.findOneInChannel(ctx, ApiKey, apiKey.id, ctx.channelId));
        if (!apiKeyOnChannel) {
            throw new EntityNotFoundError('User', userId);
        }
        return Permission.UpdateApiKey;
    }

    /**
     * @description
     * Asserts that the given `(roleId, channelId)` pairs may be granted to the User of an API key
     * which belongs to the given Channels:
     *
     * - The SuperAdmin Role cannot be granted to an API key. A key holding it would be a
     *   credential with every permission on every Channel, outside the guard which keeps at
     *   least one Administrator a SuperAdmin. Keys which already hold it, e.g. after migrating
     *   from v3, keep it until it is removed.
     * - A Role can only be granted on a Channel the key belongs to. An API key authenticates
     *   only on its own Channels, so a grant elsewhere could never be used.
     *
     * {@link assign} applies this to the User of an existing API key. Call it directly for a
     * key which is still being created.
     *
     * @throws {UserInputError} if a pair names the SuperAdmin Role or a Channel the key does not
     * belong to
     */
    async assertValidApiKeyGrants(
        ctx: RequestContext,
        apiKeyChannelIds: ID[],
        pairs: RoleAssignmentInput[],
    ): Promise<void> {
        const superAdminRole = await this.roleService.getSuperAdminRole(ctx);
        if (pairs.some(pair => idsAreEqual(pair.roleId, superAdminRole.id))) {
            throw new UserInputError('error.api-key-cannot-hold-superadmin-role');
        }
        if (pairs.some(pair => !apiKeyChannelIds.some(channelId => idsAreEqual(channelId, pair.channelId)))) {
            throw new UserInputError('error.api-key-role-channel-not-assigned');
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
     * Performs no authorization: this is the row primitive beneath {@link assign}, for writes
     * which have no actor to check against, such as granting a User created by an
     * authentication strategy the Roles that strategy resolved. Actor-made changes go through
     * {@link assign}. A SuperAdmin pair on any Channel is stored as the single default-channel
     * row, as in {@link assign}, so no write path can create a SuperAdmin row elsewhere. Role
     * ownership still applies ({@link RoleService.roleIsAssignableOnChannel}): no write path
     * can assign a Role owned by one Channel on another.
     *
     * @throws {EntityNotFoundError} if the User or a Role does not exist
     * @throws {IllegalOperationError} if a pair names the legacy Customer role
     * @throws {UserInputError} if a Role may not be assigned on the pair's Channel
     */
    async createAssignments(ctx: RequestContext, userId: ID, pairs: RoleAssignmentInput[]): Promise<void> {
        const user = await this.connection.getEntityOrThrow(ctx, User, userId);
        const repository = this.connection.getRepository(ctx, RoleAssignment);
        const existing = await repository.find({ where: { userId } });
        const toAdd = (await this.anchorSuperAdminPairs(ctx, pairs)).filter(
            pair => !existing.some(assignment => this.matches(assignment, pair)),
        );
        if (!toAdd.length) {
            return;
        }
        await this.assertNoLegacyCustomerRole(ctx, toAdd);
        for (const { roleId, channelId } of toAdd) {
            const role = await this.connection.getEntityOrThrow(ctx, Role, roleId);
            if (!(await this.roleService.roleIsAssignableOnChannel(ctx, role, channelId))) {
                throw new UserInputError('error.role-not-assignable-on-channel', { roleCode: role.code });
            }
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
     * Performs no authorization and no sole-SuperAdmin guard: this is the row primitive beneath
     * {@link remove}. Actor-made changes go through {@link remove}. A SuperAdmin pair on any
     * Channel removes the User's SuperAdmin row, as in {@link remove}.
     *
     * @throws {EntityNotFoundError} if the User does not exist
     */
    async deleteAssignments(ctx: RequestContext, userId: ID, pairs: RoleAssignmentInput[]): Promise<void> {
        const user = await this.connection.getEntityOrThrow(ctx, User, userId);
        const existing = await this.getAssignmentsForUser(ctx, userId);
        const superAdminRole = await this.roleService.getSuperAdminRole(ctx);
        await this.removeRows(ctx, user, this.selectRows(existing, pairs, superAdminRole.id));
    }

    /**
     * The rows among `rows` which the pairs address. A SuperAdmin pair names the SuperAdmin Role
     * on every Channel, so it addresses the User's SuperAdmin row wherever it is stored: rows which
     * predate the anchoring in {@link createAssignments} may name another Channel than the
     * default one.
     */
    private selectRows(rows: RoleAssignment[], pairs: RoleAssignmentInput[], superAdminRoleId: ID) {
        const removesSuperAdmin = pairs.some(pair => idsAreEqual(pair.roleId, superAdminRoleId));
        return rows.filter(
            assignment =>
                pairs.some(pair => this.matches(assignment, pair)) ||
                (removesSuperAdmin && idsAreEqual(assignment.roleId, superAdminRoleId)),
        );
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
     */
    async removeAllAssignmentsOnChannel(ctx: RequestContext, channelId: ID): Promise<void> {
        const rows = await this.connection
            .getRepository(ctx, RoleAssignment)
            .find({ where: { channelId }, relations: { user: true } });
        await this.removeRowsPerUser(ctx, rows);
    }

    /**
     * @description
     * Deletes every RoleAssignment of the given Role, and publishes one `removed`
     * {@link RoleAssignmentEvent} per affected User. Call it before the Role row is deleted:
     * the foreign key would otherwise cascade the rows away with no event.
     *
     * Performs no authorization and no sole-SuperAdmin guard: this is the primitive behind the
     * Role delete, which refuses the system Roles.
     */
    async removeAllAssignmentsOfRole(ctx: RequestContext, roleId: ID): Promise<void> {
        const rows = await this.connection
            .getRepository(ctx, RoleAssignment)
            .find({ where: { roleId }, relations: { user: true } });
        await this.removeRowsPerUser(ctx, rows);
    }

    private async removeRowsPerUser(ctx: RequestContext, rows: RoleAssignment[]): Promise<void> {
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

    /**
     * The pre-v4 Customer role exists until `removeLegacyRoleData()` deletes it. v4 derives
     * Customer permissions from channel memberships, and an assignment of the role would make
     * `removeLegacyRoleData()` refuse to delete it.
     */
    private async assertNoLegacyCustomerRole(
        ctx: RequestContext,
        pairs: RoleAssignmentInput[],
    ): Promise<void> {
        const customerRole = await this.connection
            .getRepository(ctx, Role)
            .findOne({ where: { code: CUSTOMER_ROLE_CODE } });
        if (customerRole && pairs.some(pair => idsAreEqual(pair.roleId, customerRole.id))) {
            throw new IllegalOperationError('error.cannot-assign-legacy-customer-role');
        }
    }

    private matches(assignment: RoleAssignment, pair: RoleAssignmentInput): boolean {
        return (
            idsAreEqual(assignment.roleId, pair.roleId) && idsAreEqual(assignment.channelId, pair.channelId)
        );
    }

    private dedupePairs(pairs: RoleAssignmentInput[]): RoleAssignmentInput[] {
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
        pairs: RoleAssignmentInput[],
    ): Promise<RoleAssignmentInput[]> {
        const superAdminRole = await this.roleService.getSuperAdminRole(ctx);
        if (!pairs.some(pair => idsAreEqual(pair.roleId, superAdminRole.id))) {
            return this.dedupePairs(pairs);
        }
        const defaultChannelId = await this.roleService.getDefaultChannelId(ctx);
        return this.dedupePairs(
            pairs.map(pair =>
                idsAreEqual(pair.roleId, superAdminRole.id)
                    ? { roleId: pair.roleId, channelId: defaultChannelId }
                    : pair,
            ),
        );
    }
}
