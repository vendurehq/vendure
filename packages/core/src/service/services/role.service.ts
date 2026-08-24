import { Injectable } from '@nestjs/common';
import {
    CreateRoleInput,
    DeletionResponse,
    DeletionResult,
    Permission,
    UpdateRoleInput,
} from '@vendure/common/lib/generated-types';
import {
    CUSTOMER_ROLE_CODE,
    CUSTOMER_ROLE_DESCRIPTION,
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
    ) {
        // When a Role is created, updated or deleted, we need to invalidate the roles cache
        this.eventBus.ofType(RoleEvent).subscribe(event => {
            void this.rolesCache.delete(this.rolesCacheKey);
        });
    }

    async initRoles() {
        await this.ensureSuperAdminRoleExists();
        await this.ensureCustomerRoleExists();
        await this.ensureRolesHaveValidPermissions();
    }

    async findAll(
        ctx: RequestContext,
        options?: ListQueryOptions<Role>,
        relations?: RelationPaths<Role>,
    ): Promise<PaginatedList<Role>> {
        // Compute the set of Role IDs the active user can read up front to ensure
        // sort/skip/take operate only over visible Roles.
        const allRoles = await this.getAllRoles(ctx);

        const visibleRoleIds: ID[] = [];
        for (const role of allRoles) {
            if (await this.activeUserCanReadRole(ctx, role)) {
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
     * Returns the special Customer Role, which always exists in Vendure.
     */
    getCustomerRole(ctx?: RequestContext): Promise<Role> {
        return this.getRoleByCode(ctx, CUSTOMER_ROLE_CODE).then(role => {
            if (!role) {
                throw new InternalServerError('error.customer-role-not-found');
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
        // A Role is visible to the active user if they hold its full permission envelope on
        // at least one Channel. Since the SuperAdmin permission cannot be granted to
        // user-created Roles (see checkPermissionsAreValid), this keeps the SuperAdmin role
        // visible only to SuperAdmins by set arithmetic alone.
        return this.activeUserHoldsPermissionsOnAnyChannel(ctx, role.permissions);
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
        await this.checkActiveUserHasSufficientPermissions(ctx, input.permissions);
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
        if (role.code === SUPER_ADMIN_ROLE_CODE || role.code === CUSTOMER_ROLE_CODE) {
            throw new InternalServerError('error.cannot-modify-role', { roleCode: role.code });
        }
        if (input.permissions) {
            await this.checkActiveUserHasSufficientPermissions(ctx, input.permissions);
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
        if (role.code === SUPER_ADMIN_ROLE_CODE || role.code === CUSTOMER_ROLE_CODE) {
            throw new InternalServerError('error.cannot-delete-role', { roleCode: role.code });
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
     * @description
     * Checks that the active User may create or update a Role carrying the given Permissions.
     * The rule is that an Administrator may only grant Permissions that they themselves
     * already possess — on at least one Channel, since a channel-agnostic Role has no channel
     * scope of its own. Without this floor, any administrator with `CreateRole` could mint a
     * Role with arbitrary permissions.
     */
    private async checkActiveUserHasSufficientPermissions(
        ctx: RequestContext,
        permissions?: Permission[] | null,
    ) {
        const permissionsToGrant = unique([Permission.Authenticated, ...(permissions ?? [])]);
        if (!(await this.activeUserHoldsPermissionsOnAnyChannel(ctx, permissionsToGrant))) {
            throw new UserInputError('error.active-user-does-not-have-sufficient-permissions');
        }
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
     * The Customer Role is a special case which must always exist.
     */
    private async ensureCustomerRoleExists() {
        try {
            await this.getCustomerRole();
        } catch (err: any) {
            await this.createRoleEntity(RequestContext.empty(), {
                code: CUSTOMER_ROLE_CODE,
                description: CUSTOMER_ROLE_DESCRIPTION,
                permissions: [Permission.Authenticated],
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
