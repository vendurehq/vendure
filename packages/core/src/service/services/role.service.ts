import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
    CreateRoleInput,
    DeletionResponse,
    DeletionResult,
    Permission,
    RoleAssignmentInput,
    UpdateRoleInput,
} from '@vendure/common/lib/generated-types';
import {
    CUSTOMER_ROLE_CODE,
    DEFAULT_CHANNEL_CODE,
    ROLE_EDITOR_ROLE_CODE,
    ROLE_EDITOR_ROLE_DESCRIPTION,
    SUPER_ADMIN_ROLE_CODE,
    SUPER_ADMIN_ROLE_DESCRIPTION,
} from '@vendure/common/lib/shared-constants';
import { ID, PaginatedList } from '@vendure/common/lib/shared-types';
import { unique } from '@vendure/common/lib/unique';
import { In, IsNull } from 'typeorm';

import { RequestContext } from '../../api/common/request-context';
import { RelationPaths } from '../../api/decorators/relations.decorator';
import { CacheService } from '../../cache';
import { RequestContextCacheService } from '../../cache/request-context-cache.service';
import { getAllPermissionsMetadata } from '../../common/constants';
import { EntityNotFoundError, InternalServerError, UserInputError } from '../../common/error/errors';
import { Instrument } from '../../common/instrument-decorator';
import { ListQueryOptions } from '../../common/types/common-types';
import { assertFound, idsAreEqual } from '../../common/utils';
import { ConfigService } from '../../config/config.service';
import { Logger } from '../../config/logger/vendure-logger';
import { findOptionsArrayToObject } from '../../connection/find-options-array-to-object';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { Channel } from '../../entity/channel/channel.entity';
import { Role } from '../../entity/role/role.entity';
import { RoleAssignment } from '../../entity/role-assignment/role-assignment.entity';
import { EventBus } from '../../event-bus';
import { RoleEvent } from '../../event-bus/events/role-event';
import { hasLegacyRoleTables } from '../../migration-utils/v4_0_role_assignments';
import { CustomFieldRelationService } from '../helpers/custom-field-relation/custom-field-relation.service';
import { ListQueryBuilder } from '../helpers/list-query-builder/list-query-builder';
import {
    ResolvedUserPermissions,
    RolePermissionResolver,
} from '../helpers/role-permission-resolver/role-permission-resolver';
import { patchEntity } from '../helpers/utils/patch-entity';
import { withLockIfSupported } from '../helpers/utils/with-lock-if-supported';

/**
 * @description
 * Contains methods relating to {@link Role} entities.
 *
 * @docsCategory services
 */
@Injectable()
@Instrument()
export class RoleService {
    private rolesCacheKey = 'RoleService.allRoles';
    private rolesCache = this.cacheService.createCache({
        getKey: () => this.rolesCacheKey,
        options: {
            ttl: 1000 * 60 * 60, // 1 hour
        },
    });

    constructor(
        private connection: TransactionalConnection,
        private listQueryBuilder: ListQueryBuilder,
        private configService: ConfigService,
        private eventBus: EventBus,
        private requestContextCache: RequestContextCacheService,
        private cacheService: CacheService,
        private rolePermissionResolver: RolePermissionResolver,
        private customFieldRelationService: CustomFieldRelationService,
        private moduleRef: ModuleRef,
    ) {
        // When a Role is created, updated or deleted, we need to invalidate the roles cache
        this.eventBus.ofType(RoleEvent).subscribe(event => {
            void this.rolesCache.delete(this.rolesCacheKey);
        });
    }

    async initRoles() {
        const defaultChannel = await this.connection.rawConnection
            .getRepository(Channel)
            .findOne({ where: { code: DEFAULT_CHANNEL_CODE } });
        if (!defaultChannel) {
            throw new InternalServerError('error.default-channel-not-found');
        }
        await this.ensureSuperAdminRoleExists(defaultChannel.id);
        await this.ensureRoleEditorRoleExists(defaultChannel.id);
        await this.ensureRolesHaveOwners(defaultChannel.id);
        await this.ensureRolesHaveValidPermissions();
    }

    async findAll(
        ctx: RequestContext,
        options?: ListQueryOptions<Role>,
        relations?: RelationPaths<Role>,
    ): Promise<PaginatedList<Role>> {
        // Compute the set of Role IDs the active user can read up front to ensure
        // sort/skip/take operate only over visible Roles.
        const visibleRoleIds = await this.getVisibleRoleIds(ctx);
        if (visibleRoleIds.length === 0) {
            return { items: [], totalItems: 0 };
        }

        const [items, totalItems] = await this.listQueryBuilder
            .build(Role, options, {
                relations: relations ?? [],
                ctx,
            })
            .andWhere({ id: In(visibleRoleIds) })
            .getManyAndCount();
        return { items, totalItems };
    }

    /**
     * @description
     * Returns the ids of all the Roles which the active user may read: the system roles, the
     * Roles owned by a Channel on which the active user holds `ReadRole`, and the Roles they may
     * grant somewhere ({@link canGrant}). Cached for the duration of the request, since a single
     * request may resolve it many times, e.g. once per User in a list query.
     *
     * @since 3.7.3
     */
    getVisibleRoleIds(ctx: RequestContext): Promise<ID[]> {
        return this.requestContextCache.get(
            ctx,
            `RoleService.getVisibleRoleIds.user(${String(ctx.activeUserId)})`,
            async () => {
                // TODO: this materializes the full role list per request and builds
                // IN clauses proportional to the role count; rework the gate into a SQL
                // predicate on the list query (role.channelId makes that possible) for
                // instances with thousands of Roles.
                const allRoles = await this.getAllRoles(ctx);
                const visibleRoleIds: ID[] = [];
                for (const role of allRoles) {
                    if (await this.activeUserCanReadRole(ctx, role)) {
                        visibleRoleIds.push(role.id);
                    }
                }
                return visibleRoleIds;
            },
        );
    }

    findOne(ctx: RequestContext, roleId: ID, relations?: RelationPaths<Role>): Promise<Role | undefined> {
        return this.connection
            .getRepository(ctx, Role)
            .findOne({
                where: { id: roleId },
                relations: findOptionsArrayToObject<Role>(relations ?? []),
            })
            .then(async result => {
                if (result && (await this.activeUserCanReadRole(ctx, result))) {
                    return result;
                }
            });
    }

    /**
     * @description
     * Returns the special SuperAdmin Role, which always exists in Vendure.
     */
    getSuperAdminRole(ctx?: RequestContext): Promise<Role> {
        return this.getRoleByCode(ctx, SUPER_ADMIN_ROLE_CODE).then(role => {
            if (!role) {
                throw new InternalServerError('error.super-admin-role-not-found');
            }
            return role;
        });
    }

    /**
     * @description
     * Returns the special RoleEditor Role, which always exists in Vendure. It bundles the
     * Role CRUD permissions (`CreateRole`, `ReadRole`, `UpdateRole`, `DeleteRole`). It is
     * granted and revoked like any ordinary Role, by an actor who holds those permissions
     * on the target Channel; no Administrator receives it automatically.
     *
     * @since 4.0.0
     */
    getRoleEditorRole(ctx?: RequestContext): Promise<Role> {
        return this.getRoleByCode(ctx, ROLE_EDITOR_ROLE_CODE).then(role => {
            if (!role) {
                throw new InternalServerError('error.role-editor-role-not-found');
            }
            return role;
        });
    }

    /**
     * @description
     * Returns all the valid Permission values
     */
    getAllPermissions(): string[] {
        return Object.values(Permission);
    }

    /**
     * @description
     * Returns true if the User has the specified permission on that Channel
     */
    async userHasPermissionOnChannel(
        ctx: RequestContext,
        channelId: ID,
        permission: Permission,
    ): Promise<boolean> {
        return this.userHasAnyPermissionsOnChannel(ctx, channelId, [permission]);
    }

    /**
     * @description
     * Returns true if the User has any of the specified permissions on that Channel
     */
    async userHasAnyPermissionsOnChannel(
        ctx: RequestContext,
        channelId: ID,
        permissions: Permission[],
    ): Promise<boolean> {
        const permissionsOnChannel = await this.getActiveUserPermissionsOnChannel(ctx, channelId);
        for (const permission of permissions) {
            if (permissionsOnChannel.includes(permission)) {
                return true;
            }
        }
        return false;
    }

    /**
     * @description
     * Returns true if the User has all the specified permissions on that Channel
     */
    async userHasAllPermissionsOnChannel(
        ctx: RequestContext,
        channelId: ID,
        permissions: Permission[],
    ): Promise<boolean> {
        const permissionsOnChannel = await this.getActiveUserPermissionsOnChannel(ctx, channelId);
        for (const permission of permissions) {
            if (!permissionsOnChannel.includes(permission)) {
                return false;
            }
        }
        return true;
    }

    /**
     * @description
     * Whether the Role is a shared Role: owned by the default Channel, and so assignable on
     * every Channel. See {@link Role}.
     *
     * @since 4.0.0
     */
    async isSharedRole(ctx: RequestContext, role: Role): Promise<boolean> {
        return role.channelId != null && idsAreEqual(role.channelId, await this.getDefaultChannelId(ctx));
    }

    /**
     * The read gate. A Role is visible to an actor who holds `ReadRole` on its owning Channel,
     * and to an actor who may grant it ({@link canGrant}) somewhere. The second clause lets an
     * administrator who manages other administrators list the Roles they may grant without
     * holding the Role CRUD permissions. A Role owned by another Channel can only be granted
     * on that Channel, so it stays invisible to administrators of other Channels.
     *
     * The system roles are visible to any actor holding `ReadRole` or `ReadAdministrator`:
     * they cannot be modified or deleted through the API, so there is nothing to protect.
     */
    private async activeUserCanReadRole(ctx: RequestContext, role: Role): Promise<boolean> {
        if (this.isSystemRole(role)) {
            return true;
        }
        const gatingChannelId = await this.getGatingChannelId(ctx, role);
        if (await this.userHasPermissionOnChannel(ctx, gatingChannelId, Permission.ReadRole)) {
            return true;
        }
        if (role.channelId == null) {
            return false;
        }
        if (await this.isSharedRole(ctx, role)) {
            return this.activeUserHoldsPermissionsOnAnyChannel(ctx, role.permissions);
        }
        return this.roleIsGrantableOnChannel(ctx, role, role.channelId);
    }

    /**
     * The Channel on which the Role CRUD permissions gate reading, updating and deleting the
     * Role: its owning Channel. A Role without an owner, which only a v3 server can create
     * during a rolling upgrade, is gated on the default Channel until the migration sets its
     * owner.
     */
    private async getGatingChannelId(ctx: RequestContext, role: Role): Promise<ID> {
        return role.channelId ?? (await this.getDefaultChannelId(ctx));
    }

    /**
     * @description
     * The id of the default Channel, which owns the shared Roles and holds the SuperAdmin
     * assignment rows. Cached for the request.
     *
     * @internal
     */
    getDefaultChannelId(ctx: RequestContext): Promise<ID> {
        return this.requestContextCache.get(ctx, 'RoleService.getDefaultChannelId', async () => {
            const channel = await this.connection
                .getRepository(ctx, Channel)
                .findOne({ where: { code: DEFAULT_CHANNEL_CODE } });
            if (!channel) {
                throw new InternalServerError('error.default-channel-not-found');
            }
            return channel.id;
        });
    }

    private async getAllRoles(ctx: RequestContext): Promise<Role[]> {
        const allRolesJson = await this.rolesCache.get(this.rolesCacheKey, async () => {
            const roles = await this.connection.getRepository(ctx, Role).find();
            return JSON.stringify(roles);
        });

        return JSON.parse(allRolesJson);
    }

    private async getActiveUserPermissionsOnChannel(
        ctx: RequestContext,
        channelId: ID,
    ): Promise<Permission[]> {
        const { channels, globalPermissions } = await this.getActiveUserResolvedPermissions(ctx);
        const channel = channels.find(c => idsAreEqual(c.id, channelId));
        return unique([...globalPermissions, ...(channel?.permissions ?? [])]);
    }

    /**
     * Resolves (and request-caches) the active user's effective permissions. Cached per
     * request since guard-heavy code paths (e.g. the GetActiveAdministrator query in the
     * admin ui) would otherwise re-resolve for every check, causing unbounded quadratic
     * slowdown on instances with many channels.
     */
    private async getActiveUserResolvedPermissions(ctx: RequestContext): Promise<ResolvedUserPermissions> {
        const { activeUserId } = ctx;
        if (activeUserId == null) {
            return { channels: [], globalPermissions: [] };
        }
        return this.requestContextCache.get(
            ctx,
            `RoleService.getActiveUserResolvedPermissions.user(${activeUserId})`,
            () => this.rolePermissionResolver.resolvePermissions(activeUserId),
        );
    }

    /**
     * @description
     * Returns true if the active user holds all of the specified permissions on at least one
     * Channel.
     *
     * @since 4.0.0
     */
    async activeUserHoldsPermissionsOnAnyChannel(
        ctx: RequestContext,
        permissions: Permission[],
    ): Promise<boolean> {
        const { channels, globalPermissions } = await this.getActiveUserResolvedPermissions(ctx);
        if (permissions.every(permission => globalPermissions.includes(permission))) {
            return true;
        }
        return channels.some(channelPermissions =>
            permissions.every(
                permission =>
                    channelPermissions.permissions.includes(permission) ||
                    globalPermissions.includes(permission),
            ),
        );
    }

    /**
     * @description
     * The grant predicate: whether the active user may grant the Role on the Channel, or
     * take it away again. True iff
     *
     * - the Role may be assigned on that Channel at all: it is a shared Role (owned by the
     *   default Channel), or the Channel is the Role's owning Channel, and
     * - the active user holds every permission of the Role on that Channel. The Role's
     *   permission list is the ceiling, so an actor can only hand out what they hold
     *   themselves: a holder of `UpdateAdministrator` cannot grant themselves the strongest
     *   Role present on their Channel, and only a SuperAdmin can grant the SuperAdmin Role.
     *
     * An unknown Role, and a Role without an owner (see {@link Role}), is never grantable.
     *
     * The same predicate decides every assignment write ({@link RoleAssignmentService.assign},
     * {@link RoleAssignmentService.remove}) and filters every assignment read
     * ({@link RoleAssignmentService.findAll}, `User.roleAssignments`), so the assignments an
     * actor sees are exactly the ones they may change.
     *
     * @since 4.0.0
     */
    async canGrant(ctx: RequestContext, roleId: ID, channelId: ID): Promise<boolean> {
        // Cached for the request: authority checks call this once per assignment of a User.
        const role = await this.requestContextCache.get(
            ctx,
            `RoleService.canGrant.role(${String(roleId)})`,
            () => this.connection.getRepository(ctx, Role).findOne({ where: { id: roleId } }),
        );
        if (!role) {
            return false;
        }
        return this.roleIsGrantableOnChannel(ctx, role, channelId);
    }

    /**
     * @description
     * Asserts {@link canGrant} for every one of the given `(roleId, channelId)` pairs.
     *
     * The Roles are read with a shared lock held until the surrounding transaction commits.
     * {@link update} takes an exclusive lock on the Role before checking the Channels it is
     * assigned on, so a Role's permissions cannot widen between this check and the write of
     * the assignment, nor the assignment slip past the permission check of a concurrent
     * update. Call it inside the transaction which writes the assignments.
     *
     * @throws {EntityNotFoundError} if a pair names a Role which does not exist
     * @throws {UserInputError} if the active user may not grant one of the pairs
     * @since 4.0.0
     */
    async assertActiveUserCanGrantRoles(ctx: RequestContext, pairs: RoleAssignmentInput[]): Promise<void> {
        if (pairs.length === 0) {
            return;
        }
        const roles = await withLockIfSupported(
            this.connection
                .getRepository(ctx, Role)
                .createQueryBuilder('role')
                .where('role.id IN (:...ids)', { ids: unique(pairs.map(pair => pair.roleId)) }),
            'pessimistic_read',
            qb => qb.getMany(),
        );
        for (const pair of pairs) {
            const role = roles.find(r => idsAreEqual(r.id, pair.roleId));
            if (!role) {
                throw new EntityNotFoundError('Role', pair.roleId);
            }
            if (!(await this.roleIsGrantableOnChannel(ctx, role, pair.channelId))) {
                throw new UserInputError('error.active-user-does-not-have-sufficient-permissions');
            }
        }
    }

    /**
     * @description
     * Evaluates {@link canGrant} over every Role and every Channel: for each Role the active
     * user may grant somewhere, the ids of the Channels they may grant it on. Roles the
     * active user may grant nowhere are absent. `everywhere` is true when the Role is grantable
     * on every Channel it may be assigned on, so that a query can match the Role without listing
     * the Channels. This is the batch form of `canGrant` behind the filtered assignment list
     * ({@link RoleAssignmentService.findAll}).
     *
     * @since 4.0.0
     */
    async getGrantableChannelIdsByRole(
        ctx: RequestContext,
    ): Promise<Array<{ roleId: ID; channelIds: ID[]; everywhere: boolean }>> {
        const roles = await this.connection.getRepository(ctx, Role).find();
        const channels = await this.connection.getRepository(ctx, Channel).find();
        const defaultChannelId = await this.getDefaultChannelId(ctx);
        const result: Array<{ roleId: ID; channelIds: ID[]; everywhere: boolean }> = [];
        for (const role of roles) {
            if (role.channelId == null) {
                continue;
            }
            // A Role owned by a Channel other than the default one can only be assigned there
            const assignableChannelIds = idsAreEqual(role.channelId, defaultChannelId)
                ? channels.map(channel => channel.id)
                : [role.channelId];
            const channelIds: ID[] = [];
            for (const channelId of assignableChannelIds) {
                if (await this.roleIsGrantableOnChannel(ctx, role, channelId)) {
                    channelIds.push(channelId);
                }
            }
            if (channelIds.length) {
                result.push({
                    roleId: role.id,
                    channelIds,
                    everywhere: channelIds.length === assignableChannelIds.length,
                });
            }
        }
        return result;
    }

    /**
     * @description
     * Whether the Role may be assigned on the Channel at all, whoever assigns it: a shared Role
     * on any Channel, any other Role on its owning Channel only. See {@link Role}.
     *
     * @since 4.0.0
     */
    async roleIsAssignableOnChannel(ctx: RequestContext, role: Role, channelId: ID): Promise<boolean> {
        if (role.channelId == null) {
            return false;
        }
        return idsAreEqual(role.channelId, channelId) || this.isSharedRole(ctx, role);
    }

    private async roleIsGrantableOnChannel(ctx: RequestContext, role: Role, channelId: ID): Promise<boolean> {
        if (!(await this.roleIsAssignableOnChannel(ctx, role, channelId))) {
            return false;
        }
        return this.userHasAllPermissionsOnChannel(ctx, channelId, role.permissions);
    }

    /**
     * The ids of the Channels on which the Role currently has assignment rows, read with a
     * shared lock (see {@link assertActiveUserCanGrantRoles}). Soft-deleted Users hold no
     * rows: the Administrator and API-Key soft-deletes remove them
     * ({@link RoleAssignmentService.removeAllAssignmentsForUser}).
     */
    private async getChannelIdsWithAssignments(ctx: RequestContext, roleId: ID): Promise<ID[]> {
        // No DISTINCT: Postgres does not allow it together with a row lock.
        const rows = await withLockIfSupported(
            this.connection
                .getRepository(ctx, RoleAssignment)
                .createQueryBuilder('assignment')
                .select('assignment.channelId', 'channelId')
                .where('assignment.roleId = :roleId', { roleId }),
            'pessimistic_read',
            qb => qb.getRawMany<{ channelId: ID }>(),
        );
        return unique(rows.map(row => row.channelId));
    }

    /**
     * @description
     * Creates a Role owned by the active Channel. A Role created on the default Channel is a
     * shared Role, which may be assigned on any Channel; a Role created on any other Channel
     * may only be assigned on that Channel. See {@link Role}.
     *
     * The active user must hold `CreateRole` and every permission of the new Role on the
     * active Channel.
     */
    async create(ctx: RequestContext, input: CreateRoleInput): Promise<Role> {
        this.checkPermissionsAreValid(input.permissions);
        this.checkCodeIsNotReserved(input.code);
        const permissions = unique([Permission.Authenticated, ...input.permissions]);
        if (
            !(await this.userHasPermissionOnChannel(ctx, ctx.channelId, Permission.CreateRole)) ||
            !(await this.userHasAllPermissionsOnChannel(ctx, ctx.channelId, permissions))
        ) {
            throw new UserInputError('error.active-user-does-not-have-sufficient-permissions');
        }
        const role = await this.createRoleEntity(ctx, input, ctx.channelId);
        await this.eventBus.publish(new RoleEvent(ctx, role, 'created', input));
        return assertFound(this.findOne(ctx, role.id));
    }

    /**
     * @description
     * Updates a Role. The active user must hold `UpdateRole` on the Role's owning Channel.
     * When the permissions change, the active user must also hold every permission of the
     * new list on the owning Channel and on every Channel where the Role is assigned:
     * otherwise an actor could add permissions they do not hold to a Role they hold
     * themselves, or to one held on a Channel where they lack them, and so widen what its
     * holders may do.
     *
     * The Role is locked until the surrounding transaction commits, see
     * {@link assertActiveUserCanGrantRoles}.
     */
    async update(ctx: RequestContext, input: UpdateRoleInput): Promise<Role> {
        this.checkPermissionsAreValid(input.permissions);
        this.checkCodeIsNotReserved(input.code);
        const visibleRole = await this.findOne(ctx, input.id);
        if (!visibleRole) {
            throw new EntityNotFoundError('Role', input.id);
        }
        if (this.isSystemRole(visibleRole)) {
            throw new InternalServerError('error.cannot-modify-role', { roleCode: visibleRole.code });
        }
        const role = await withLockIfSupported(
            this.connection
                .getRepository(ctx, Role)
                .createQueryBuilder('role')
                .where('role.id = :id', { id: visibleRole.id }),
            'pessimistic_write',
            qb => qb.getOne(),
        );
        if (!role) {
            throw new EntityNotFoundError('Role', input.id);
        }
        const gatingChannelId = await this.getGatingChannelId(ctx, role);
        if (!(await this.userHasPermissionOnChannel(ctx, gatingChannelId, Permission.UpdateRole))) {
            throw new UserInputError('error.active-user-cannot-manage-role', { roleCode: role.code });
        }
        if (input.permissions) {
            const permissions = unique([Permission.Authenticated, ...input.permissions]);
            const channelIds = unique([
                gatingChannelId,
                ...(await this.getChannelIdsWithAssignments(ctx, role.id)),
            ]);
            for (const channelId of channelIds) {
                if (!(await this.userHasAllPermissionsOnChannel(ctx, channelId, permissions))) {
                    throw new UserInputError('error.active-user-does-not-have-sufficient-permissions');
                }
            }
        }
        patchEntity(role, {
            code: input.code,
            description: input.description,
            permissions: input.permissions
                ? unique([Permission.Authenticated, ...input.permissions])
                : undefined,
            customFields: input.customFields,
        });
        await this.connection.getRepository(ctx, Role).save(role, { reload: false });
        await this.customFieldRelationService.updateRelations(ctx, Role, input, role);
        const updatedRole = await assertFound(this.findOne(ctx, role.id));
        await this.eventBus.publish(new RoleEvent(ctx, updatedRole, 'updated', input));
        return updatedRole;
    }

    /**
     * @description
     * Deletes a Role. The active user must hold `DeleteRole` on the Role's owning Channel.
     */
    async delete(ctx: RequestContext, id: ID): Promise<DeletionResponse> {
        const role = await this.findOne(ctx, id);
        if (!role) {
            throw new EntityNotFoundError('Role', id);
        }
        if (this.isSystemRole(role)) {
            throw new InternalServerError('error.cannot-delete-role', { roleCode: role.code });
        }
        const gatingChannelId = await this.getGatingChannelId(ctx, role);
        if (!(await this.userHasPermissionOnChannel(ctx, gatingChannelId, Permission.DeleteRole))) {
            throw new UserInputError('error.active-user-cannot-manage-role', { roleCode: role.code });
        }
        const deletedRole = new Role(role);
        await this.removeAssignmentsOfRole(ctx, role.id);
        await this.connection.getRepository(ctx, Role).remove(role);
        await this.eventBus.publish(new RoleEvent(ctx, deletedRole, 'deleted', id));
        return {
            result: DeletionResult.DELETED,
        };
    }

    /**
     * @description
     * Deletes every Role owned by the given Channel and publishes a `deleted` {@link RoleEvent}
     * for each. Performs no authorization: this is the primitive behind the Channel delete,
     * which calls it after removing the Channel's assignments. A Role owned by a Channel
     * other than the default one can only be assigned there, so no Role deleted here is held
     * on another Channel.
     *
     * @since 4.0.0
     */
    async deleteRolesOwnedByChannel(ctx: RequestContext, channelId: ID): Promise<void> {
        const roles = await this.connection.getRepository(ctx, Role).find({ where: { channelId } });
        for (const role of roles) {
            const deletedRole = new Role(role);
            await this.removeAssignmentsOfRole(ctx, role.id);
            await this.connection.getRepository(ctx, Role).remove(role);
            await this.eventBus.publish(new RoleEvent(ctx, deletedRole, 'deleted', deletedRole.id));
        }
    }

    /**
     * Removes the Role's assignments with a RoleAssignmentEvent per affected User before the Role
     * row goes, since the foreign key would otherwise cascade them away silently. The
     * RoleAssignmentService depends on this service, so it is resolved lazily.
     */
    private async removeAssignmentsOfRole(ctx: RequestContext, roleId: ID): Promise<void> {
        const { RoleAssignmentService } = await import('./role-assignment.service.js');
        await this.moduleRef.get(RoleAssignmentService).removeAllAssignmentsOfRole(ctx, roleId);
    }

    private checkPermissionsAreValid(permissions?: Permission[] | null) {
        if (!permissions) {
            return;
        }
        const allAssignablePermissions = this.getAllAssignablePermissions();
        for (const permission of permissions) {
            if (!allAssignablePermissions.includes(permission) || permission === Permission.SuperAdmin) {
                throw new UserInputError('error.permission-invalid', { permission });
            }
        }
    }

    /**
     * The system roles are managed by Vendure itself and cannot be modified or deleted
     * through the API.
     */
    private isSystemRole(role: Role): boolean {
        return role.code === SUPER_ADMIN_ROLE_CODE || role.code === ROLE_EDITOR_ROLE_CODE;
    }

    /**
     * Role codes are not unique, so a system Role is looked up among the Roles owned by the
     * default Channel, or owned by none while a rolling upgrade has not set the owners yet. A
     * Role with the same code on another Channel is never taken for it.
     */
    private getRoleByCode(ctx: RequestContext | undefined, code: string) {
        const repository = ctx
            ? this.connection.getRepository(ctx, Role)
            : this.connection.rawConnection.getRepository(Role);

        return repository.findOne({
            where: [
                { code, channel: { code: DEFAULT_CHANNEL_CODE } },
                { code, channelId: IsNull() },
            ],
        });
    }

    /**
     * The codes of the system Roles, and of the pre-v4 Customer role, cannot be taken by
     * another Role: they would be shown on every Channel as system Roles, which nobody may
     * modify or delete.
     */
    private checkCodeIsNotReserved(code: string | null | undefined) {
        if (code && [SUPER_ADMIN_ROLE_CODE, ROLE_EDITOR_ROLE_CODE, CUSTOMER_ROLE_CODE].includes(code)) {
            throw new UserInputError('error.role-code-is-reserved', { roleCode: code });
        }
    }

    /**
     * Ensure that the SuperAdmin role exists. The effective permissions of a SuperAdmin
     * are derived at check time from the `SuperAdmin` permission, so the role's own
     * permission array is not re-synced with all assignable permissions on boot.
     */
    private async ensureSuperAdminRoleExists(defaultChannelId: ID) {
        try {
            await this.getSuperAdminRole();
        } catch (err: any) {
            await this.createRoleEntity(
                RequestContext.empty(),
                {
                    code: SUPER_ADMIN_ROLE_CODE,
                    description: SUPER_ADMIN_ROLE_DESCRIPTION,
                    permissions: [Permission.SuperAdmin],
                },
                defaultChannelId,
            );
        }
    }

    /**
     * The RoleEditor Role bundles the Role CRUD permissions. It is never granted
     * automatically, but it must always exist so that it can be granted explicitly.
     */
    private async ensureRoleEditorRoleExists(defaultChannelId: ID) {
        try {
            await this.getRoleEditorRole();
        } catch (err: any) {
            await this.createRoleEntity(
                RequestContext.empty(),
                {
                    code: ROLE_EDITOR_ROLE_CODE,
                    description: ROLE_EDITOR_ROLE_DESCRIPTION,
                    permissions: [
                        Permission.CreateRole,
                        Permission.ReadRole,
                        Permission.UpdateRole,
                        Permission.DeleteRole,
                    ],
                },
                defaultChannelId,
            );
        }
    }

    /**
     * The system roles are shared Roles, owned by the default Channel. Any other Role without
     * an owner was either created by a v3 server during a rolling upgrade, in which case
     * removeLegacyRoleData() derives its owner from the legacy role_channels_channel table,
     * or written to the database directly, bypassing {@link create}. Once the legacy tables
     * are gone, the latter become shared Roles, as every pre-v4 Role not confined to a single
     * Channel does.
     */
    private async ensureRolesHaveOwners(defaultChannelId: ID) {
        const repository = this.connection.rawConnection.getRepository(Role);
        const ownerless = await repository.find({ where: { channelId: IsNull() } });
        if (!ownerless.length) {
            return;
        }
        const queryRunner = this.connection.rawConnection.createQueryRunner();
        let legacyTablesExist: boolean;
        try {
            legacyTablesExist = await hasLegacyRoleTables(queryRunner);
        } finally {
            await queryRunner.release();
        }
        const toUpdate = ownerless.filter(role => this.isSystemRole(role) || !legacyTablesExist);
        for (const role of toUpdate) {
            await repository.update({ id: role.id }, { channelId: defaultChannelId });
        }
        const others = toUpdate.filter(role => !this.isSystemRole(role));
        if (others.length) {
            Logger.warn(
                `Roles without an owning Channel have been assigned to the default Channel, which ` +
                    `makes them shared Roles: ${others.map(role => role.code).join(', ')}`,
            );
        }
    }

    /**
     * Since custom permissions can be added and removed by config, there may exist one or more Roles with
     * invalid permissions (i.e. permissions that were set previously to a custom permission, which has been
     * subsequently removed from config). This method should run on startup to ensure that any such invalid
     * permissions are removed from those Roles.
     */
    private async ensureRolesHaveValidPermissions() {
        const roles = await this.connection.rawConnection.getRepository(Role).find();
        const assignablePermissions = this.getAllAssignablePermissions();
        for (const role of roles) {
            const invalidPermissions = role.permissions.filter(p => !assignablePermissions.includes(p));
            if (invalidPermissions.length) {
                role.permissions = role.permissions.filter(p => assignablePermissions.includes(p));
                await this.connection.rawConnection.getRepository(Role).save(role);
            }
        }
    }

    private async createRoleEntity(ctx: RequestContext, input: CreateRoleInput, channelId: ID) {
        const role = new Role({
            code: input.code,
            description: input.description,
            permissions: unique([Permission.Authenticated, ...input.permissions]),
            customFields: input.customFields,
            channelId,
        });
        const newRole = await this.connection.getRepository(ctx, Role).save(role);
        await this.customFieldRelationService.updateRelations(ctx, Role, input, newRole);
        return newRole;
    }

    private getAllAssignablePermissions(): Permission[] {
        return getAllPermissionsMetadata(this.configService.authOptions.customPermissions)
            .filter(p => p.assignable)
            .map(p => p.name as Permission);
    }
}
