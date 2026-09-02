import { Injectable } from '@nestjs/common';
import {
    CreateRoleInput,
    DeletionResponse,
    DeletionResult,
    Permission,
    UpdateRoleInput,
} from '@vendure/common/lib/generated-types';
import {
    ROLE_EDITOR_ROLE_CODE,
    ROLE_EDITOR_ROLE_DESCRIPTION,
    SUPER_ADMIN_ROLE_CODE,
    SUPER_ADMIN_ROLE_DESCRIPTION,
} from '@vendure/common/lib/shared-constants';
import { ID, PaginatedList } from '@vendure/common/lib/shared-types';
import { unique } from '@vendure/common/lib/unique';
import { In } from 'typeorm';

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
import { TransactionalConnection } from '../../connection/transactional-connection';
import { Role } from '../../entity/role/role.entity';
import { EventBus } from '../../event-bus';
import { RoleEvent } from '../../event-bus/events/role-event';
import { ListQueryBuilder } from '../helpers/list-query-builder/list-query-builder';
import {
    ResolvedUserPermissions,
    RolePermissionResolver,
} from '../helpers/role-permission-resolver/role-permission-resolver';
import { patchEntity } from '../helpers/utils/patch-entity';

import { RoleAssignmentService } from './role-assignment.service';

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
        private roleAssignmentService: RoleAssignmentService,
    ) {
        // When a Role is created, updated or deleted, we need to invalidate the roles cache
        this.eventBus.ofType(RoleEvent).subscribe(event => {
            void this.rolesCache.delete(this.rolesCacheKey);
        });
    }

    async initRoles() {
        await this.ensureSuperAdminRoleExists();
        await this.ensureRoleEditorRoleExists();
        await this.ensureRolesHaveValidPermissions();
    }

    async findAll(
        ctx: RequestContext,
        options?: ListQueryOptions<Role>,
        relations?: RelationPaths<Role>,
    ): Promise<PaginatedList<Role>> {
        // Compute the set of Role IDs the active user can read up front to ensure
        // sort/skip/take operate only over visible Roles. System roles bypass the gate
        // (see activeUserCanReadRole).
        // TODO (OSS-755): this materializes the full role list per request and builds
        // IN clauses proportional to the role count; rework the gate into a SQL
        // predicate on the list query for instances with thousands of Roles.
        const allRoles = await this.getAllRoles(ctx);
        const gatedRoles = allRoles.filter(role => !this.isSystemRole(role));
        const assignedChannelIdsByRole =
            await this.roleAssignmentService.getChannelIdsWithAssignmentsForRoles(
                ctx,
                gatedRoles.map(role => role.id),
            );

        const visibleRoleIds: ID[] = allRoles.filter(role => this.isSystemRole(role)).map(role => role.id);
        for (const role of gatedRoles) {
            const assignedChannelIds = assignedChannelIdsByRole.get(role.id.toString()) ?? [];
            if (
                await this.activeUserHoldsPermissionOnChannels(ctx, Permission.ReadRole, assignedChannelIds)
            ) {
                visibleRoleIds.push(role.id);
            }
        }

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

    findOne(ctx: RequestContext, roleId: ID, relations?: RelationPaths<Role>): Promise<Role | undefined> {
        return this.connection
            .getRepository(ctx, Role)
            .findOne({
                where: { id: roleId },
                relations: relations ?? [],
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
     * Role CRUD permissions (`CreateRole`, `ReadRole`, `UpdateRole`, `DeleteRole`) and is
     * granted to every Administrator on creation. Unlike the SuperAdmin and Customer roles
     * it is assigned and revoked like any ordinary Role.
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

    private async activeUserCanReadRole(ctx: RequestContext, role: Role): Promise<boolean> {
        // System roles cannot be modified or deleted through the API, so the gate protects
        // nothing when reading them: they are visible to any actor holding ReadRole.
        if (this.isSystemRole(role)) {
            return true;
        }
        return this.activeUserCanManageRole(ctx, role, Permission.ReadRole);
    }

    /**
     * The role CRUD gate: the active user may read / update / delete a Role iff they hold
     * the corresponding Role permission on every Channel on which that Role currently has
     * assignment rows. A Role with no assignments passes vacuously. System roles never
     * reach this gate: reads bypass it (activeUserCanReadRole) and writes are refused
     * earlier by the isSystemRole check.
     */
    private async activeUserCanManageRole(
        ctx: RequestContext,
        role: Role,
        permission: Permission,
    ): Promise<boolean> {
        const assignedChannelIds = await this.roleAssignmentService.getChannelIdsWithAssignments(
            ctx,
            role.id,
        );
        return this.activeUserHoldsPermissionOnChannels(ctx, permission, assignedChannelIds);
    }

    private async activeUserHoldsPermissionOnChannels(
        ctx: RequestContext,
        permission: Permission,
        channelIds: ID[],
    ): Promise<boolean> {
        const { channels, globalPermissions } = await this.getActiveUserResolvedPermissions(ctx);
        if (globalPermissions.includes(permission)) {
            return true;
        }
        return channelIds.every(channelId =>
            channels.some(
                channel => idsAreEqual(channel.id, channelId) && channel.permissions.includes(permission),
            ),
        );
    }

    private async getAllRoles(ctx: RequestContext): Promise<Role[]> {
        const allRolesJson = await this.rolesCache.get(this.rolesCacheKey, async () => {
            const roles = await this.connection.getRepository(ctx, Role).find();
            return JSON.stringify(roles);
        });

        return JSON.parse(allRolesJson);
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
     * This is the fail-closed floor beneath the permission guards: a Role is a
     * channel-agnostic template carrying no channel scope of its own, so the only meaningful
     * question a guard can ask about the actor is whether they could grant the Role's
     * permissions somewhere. An actor with no permissions anywhere is always denied.
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
     * Asserts that the active user may grant every one of the given Roles, and returns those
     * Roles. The rule is that an administrator may only grant permissions which they
     * themselves possess: on at least one Channel (the fail-closed floor for channel-agnostic
     * Roles), and — when the Channels the grant applies to are known — on each of those
     * Channels.
     *
     * @throws {EntityNotFoundError} if one of the given ids does not match an existing Role
     * @throws {UserInputError} if the active user has insufficient permissions
     * @since 4.0.0
     */
    async assertActiveUserCanGrantRoles(
        ctx: RequestContext,
        roleIds: ID[],
        channelIds?: ID[],
    ): Promise<Role[]> {
        if (roleIds.length === 0) {
            return [];
        }
        const roles = await this.connection.getRepository(ctx, Role).find({
            where: { id: In(roleIds) },
        });
        for (const roleId of roleIds) {
            if (!roles.some(role => idsAreEqual(role.id, roleId))) {
                throw new EntityNotFoundError('Role', roleId);
            }
        }
        for (const role of roles) {
            if (!(await this.activeUserHoldsPermissionsOnAnyChannel(ctx, role.permissions))) {
                throw new UserInputError('error.active-user-does-not-have-sufficient-permissions');
            }
            for (const channelId of channelIds ?? []) {
                if (!(await this.userHasAllPermissionsOnChannel(ctx, channelId, role.permissions))) {
                    throw new UserInputError('error.active-user-does-not-have-sufficient-permissions');
                }
            }
        }
        return roles;
    }

    async create(ctx: RequestContext, input: CreateRoleInput): Promise<Role> {
        this.checkPermissionsAreValid(input.permissions);
        const role = await this.createRoleEntity(ctx, input);
        await this.eventBus.publish(new RoleEvent(ctx, role, 'created', input));
        return role;
    }

    async update(ctx: RequestContext, input: UpdateRoleInput): Promise<Role> {
        this.checkPermissionsAreValid(input.permissions);
        const role = await this.findOne(ctx, input.id);
        if (!role) {
            throw new EntityNotFoundError('Role', input.id);
        }
        if (this.isSystemRole(role)) {
            throw new InternalServerError('error.cannot-modify-role', { roleCode: role.code });
        }
        if (!(await this.activeUserCanManageRole(ctx, role, Permission.UpdateRole))) {
            throw new UserInputError('error.active-user-cannot-manage-role', { roleCode: role.code });
        }
        patchEntity(role, {
            code: input.code,
            description: input.description,
            permissions: input.permissions
                ? unique([Permission.Authenticated, ...input.permissions])
                : undefined,
        });
        await this.connection.getRepository(ctx, Role).save(role, { reload: false });
        const updatedRole = await assertFound(this.findOne(ctx, role.id));
        await this.eventBus.publish(new RoleEvent(ctx, updatedRole, 'updated', input));
        return updatedRole;
    }

    async delete(ctx: RequestContext, id: ID): Promise<DeletionResponse> {
        const role = await this.findOne(ctx, id);
        if (!role) {
            throw new EntityNotFoundError('Role', id);
        }
        if (this.isSystemRole(role)) {
            throw new InternalServerError('error.cannot-delete-role', { roleCode: role.code });
        }
        if (!(await this.activeUserCanManageRole(ctx, role, Permission.DeleteRole))) {
            throw new UserInputError('error.active-user-cannot-manage-role', { roleCode: role.code });
        }
        const deletedRole = new Role(role);
        await this.connection.getRepository(ctx, Role).remove(role);
        await this.eventBus.publish(new RoleEvent(ctx, deletedRole, 'deleted', id));
        return {
            result: DeletionResult.DELETED,
        };
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

    private getRoleByCode(ctx: RequestContext | undefined, code: string) {
        const repository = ctx
            ? this.connection.getRepository(ctx, Role)
            : this.connection.rawConnection.getRepository(Role);

        return repository.findOne({
            where: { code },
        });
    }

    /**
     * Ensure that the SuperAdmin role exists. The effective permissions of a SuperAdmin
     * are derived at check time from the `SuperAdmin` permission, so the role's own
     * permission array is not re-synced with all assignable permissions on boot.
     */
    private async ensureSuperAdminRoleExists() {
        try {
            await this.getSuperAdminRole();
        } catch (err: any) {
            await this.createRoleEntity(RequestContext.empty(), {
                code: SUPER_ADMIN_ROLE_CODE,
                description: SUPER_ADMIN_ROLE_DESCRIPTION,
                permissions: [Permission.SuperAdmin],
            });
        }
    }

    /**
     * The RoleEditor Role bundles the Role CRUD permissions and is granted to every
     * Administrator on creation. It must always exist.
     */
    private async ensureRoleEditorRoleExists() {
        try {
            await this.getRoleEditorRole();
        } catch (err: any) {
            await this.createRoleEntity(RequestContext.empty(), {
                code: ROLE_EDITOR_ROLE_CODE,
                description: ROLE_EDITOR_ROLE_DESCRIPTION,
                permissions: [
                    Permission.CreateRole,
                    Permission.ReadRole,
                    Permission.UpdateRole,
                    Permission.DeleteRole,
                ],
            });
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

    private createRoleEntity(ctx: RequestContext, input: CreateRoleInput) {
        const role = new Role({
            code: input.code,
            description: input.description,
            permissions: unique([Permission.Authenticated, ...input.permissions]),
        });
        return this.connection.getRepository(ctx, Role).save(role);
    }

    private getAllAssignablePermissions(): Permission[] {
        return getAllPermissionsMetadata(this.configService.authOptions.customPermissions)
            .filter(p => p.assignable)
            .map(p => p.name as Permission);
    }
}
