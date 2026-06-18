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
import {
    EntityNotFoundError,
    ForbiddenError,
    InternalServerError,
    UserInputError,
} from '../../common/error/errors';
import { Instrument } from '../../common/instrument-decorator';
import { ListQueryOptions } from '../../common/types/common-types';
import { assertFound, idsAreEqual } from '../../common/utils';
import { ConfigService } from '../../config/config.service';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { Channel } from '../../entity/channel/channel.entity';
import { Role } from '../../entity/role/role.entity';
import { User } from '../../entity/user/user.entity';
import { EventBus } from '../../event-bus';
import { RoleEvent } from '../../event-bus/events/role-event';
import { ListQueryBuilder } from '../helpers/list-query-builder/list-query-builder';
import {
    getChannelPermissions,
    getUserChannelsPermissions,
} from '../helpers/utils/get-user-channels-permissions';
import { patchEntity } from '../helpers/utils/patch-entity';

import { ChannelService } from './channel.service';

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
        private channelService: ChannelService,
        private listQueryBuilder: ListQueryBuilder,
        private configService: ConfigService,
        private eventBus: EventBus,
        private requestContextCache: RequestContextCacheService,
        private cacheService: CacheService,
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
        // Compute the set of Role IDs the active user can read (channel + permission check) up front to ensure sort/skip/take operate only over visible Roles.
        const allRoles = await this.getAllRolesWithChannels(ctx);

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
                relations: unique([...(relations ?? []), 'channels']),
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
                relations: unique([...(relations ?? []), 'channels']),
            })
            .then(async result => {
                if (result && (await this.activeUserCanReadRole(ctx, result))) {
                    return result;
                }
            });
    }

    getChannelsForRole(ctx: RequestContext, roleId: ID): Promise<Channel[]> {
        return this.findOne(ctx, roleId).then(role => (role ? role.channels : []));
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
        const permissionsRequired = getChannelPermissions([role]);
        for (const channelPermissions of permissionsRequired) {
            const activeUserHasRequiredPermissions = await this.userHasAllPermissionsOnChannel(
                ctx,
                channelPermissions.id,
                channelPermissions.permissions,
            );
            if (!activeUserHasRequiredPermissions) {
                return false;
            }
        }
        return true;
    }

    private async getAllRolesWithChannels(ctx: RequestContext): Promise<Role[]> {
        const allRolesJson = await this.rolesCache.get(this.rolesCacheKey, async () => {
            const roles = await this.connection.getRepository(ctx, Role).find({ relations: ['channels'] });
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
        const { activeUserId } = ctx;
        if (activeUserId == null) {
            return [];
        }
        // For apps with many channels, this is a performance bottleneck as it will be called
        // for each channel in certain code paths such as the GetActiveAdministrator query in the
        // admin ui. Caching the result prevents unbounded quadratic slowdown.
        const userChannels = await this.requestContextCache.get(
            ctx,
            `RoleService.getActiveUserPermissionsOnChannel.user(${activeUserId})`,
            async () => {
                const user = await this.connection.getEntityOrThrow(ctx, User, activeUserId, {
                    relations: ['roles', 'roles.channels'],
                });
                return getUserChannelsPermissions(user);
            },
        );

        const channel = userChannels.find(c => idsAreEqual(c.id, channelId));
        if (!channel) {
            return [];
        }
        return channel.permissions;
    }

    async create(ctx: RequestContext, input: CreateRoleInput): Promise<Role> {
        this.checkPermissionsAreValid(input.permissions);

        let targetChannels: Channel[] = [];
        if (input.channelIds) {
            targetChannels = await this.getPermittedChannels(ctx, input.channelIds);
        } else {
            targetChannels = [ctx.channel];
        }
        await this.checkActiveUserHasSufficientPermissions(ctx, targetChannels, input.permissions);
        const role = await this.createRoleForChannels(ctx, input, targetChannels);
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
        const targetChannels = input.channelIds
            ? await this.getPermittedChannels(ctx, input.channelIds)
            : undefined;
        if (input.permissions) {
            await this.checkActiveUserHasSufficientPermissions(
                ctx,
                targetChannels ?? role.channels,
                input.permissions,
            );
        }
        patchEntity(role, {
            code: input.code,
            description: input.description,
            permissions: input.permissions
                ? unique([Permission.Authenticated, ...input.permissions])
                : undefined,
        });
        if (targetChannels) {
            role.channels = targetChannels;
        }
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

    async assignRoleToChannel(ctx: RequestContext, roleId: ID, channelId: ID) {
        await this.channelService.assignToChannels(ctx, Role, roleId, [channelId]);
    }

    private async getPermittedChannels(ctx: RequestContext, channelIds: ID[]): Promise<Channel[]> {
        let permittedChannels: Channel[] = [];
        for (const channelId of channelIds) {
            const channel = await this.connection.getEntityOrThrow(ctx, Channel, channelId);
            const hasPermission = await this.userHasPermissionOnChannel(
                ctx,
                channelId,
                Permission.CreateAdministrator,
            );
            if (!hasPermission) {
                throw new ForbiddenError();
            }
            permittedChannels = [...permittedChannels, channel];
        }
        return permittedChannels;
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
     * Checks that the active User has sufficient Permissions on the target Channels to create
     * a Role with the given Permissions. The rule is that an Administrator may only grant
     * Permissions that they themselves already possess.
     */
    private async checkActiveUserHasSufficientPermissions(
        ctx: RequestContext,
        targetChannels: Channel[],
        permissions: Permission[],
    ) {
        const permissionsRequired = getChannelPermissions([
            new Role({
                permissions: unique([Permission.Authenticated, ...permissions]),
                channels: targetChannels,
            }),
        ]);
        for (const channelPermissions of permissionsRequired) {
            const activeUserHasRequiredPermissions = await this.userHasAllPermissionsOnChannel(
                ctx,
                channelPermissions.id,
                channelPermissions.permissions,
            );
            if (!activeUserHasRequiredPermissions) {
                throw new UserInputError('error.active-user-does-not-have-sufficient-permissions');
            }
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
     * Ensure that the SuperAdmin role exists and that it has all possible Permissions.
     */
    private async ensureSuperAdminRoleExists() {
        const assignablePermissions = this.getAllAssignablePermissions();
        try {
            const superAdminRole = await this.getSuperAdminRole();
            superAdminRole.permissions = assignablePermissions;
            await this.connection.rawConnection.getRepository(Role).save(superAdminRole, { reload: false });
        } catch (err: any) {
            const defaultChannel = await this.channelService.getDefaultChannel();
            await this.createRoleForChannels(
                RequestContext.empty(),
                {
                    code: SUPER_ADMIN_ROLE_CODE,
                    description: SUPER_ADMIN_ROLE_DESCRIPTION,
                    permissions: assignablePermissions,
                },
                [defaultChannel],
            );
        }
    }

    /**
     * The Customer Role is a special case which must always exist.
     */
    private async ensureCustomerRoleExists() {
        try {
            await this.getCustomerRole();
        } catch (err: any) {
            const defaultChannel = await this.channelService.getDefaultChannel();
            await this.createRoleForChannels(
                RequestContext.empty(),
                {
                    code: CUSTOMER_ROLE_CODE,
                    description: CUSTOMER_ROLE_DESCRIPTION,
                    permissions: [Permission.Authenticated],
                },
                [defaultChannel],
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

    private createRoleForChannels(ctx: RequestContext, input: CreateRoleInput, channels: Channel[]) {
        const role = new Role({
            code: input.code,
            description: input.description,
            permissions: unique([Permission.Authenticated, ...input.permissions]),
        });
        role.channels = channels;
        return this.connection.getRepository(ctx, Role).save(role);
    }

    private getAllAssignablePermissions(): Permission[] {
        return getAllPermissionsMetadata(this.configService.authOptions.customPermissions)
            .filter(p => p.assignable)
            .map(p => p.name as Permission);
    }
}
