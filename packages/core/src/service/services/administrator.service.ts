import { Injectable } from '@nestjs/common';
import {
    CreateAdministratorInput,
    DeletionResult,
    UpdateAdministratorInput,
} from '@vendure/common/lib/generated-types';
import { ID, PaginatedList } from '@vendure/common/lib/shared-types';
import { In, IsNull } from 'typeorm';

import { RequestContext } from '../../api/common/request-context';
import { RelationPaths } from '../../api/decorators/relations.decorator';
import { Instrument } from '../../common';
import { EntityNotFoundError, InternalServerError, UserInputError } from '../../common/error/errors';
import { ListQueryOptions } from '../../common/types/common-types';
import { assertFound, idsAreEqual, normalizeEmailAddress } from '../../common/utils';
import { ConfigService } from '../../config';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { Administrator } from '../../entity/administrator/administrator.entity';
import { NativeAuthenticationMethod } from '../../entity/authentication-method/native-authentication-method.entity';
import { Role } from '../../entity/role/role.entity';
import { User } from '../../entity/user/user.entity';
import { EventBus } from '../../event-bus';
import { AdministratorEvent } from '../../event-bus/events/administrator-event';
import { RoleChangeEvent } from '../../event-bus/events/role-change-event';
import { CustomFieldRelationService } from '../helpers/custom-field-relation/custom-field-relation.service';
import { ListQueryBuilder } from '../helpers/list-query-builder/list-query-builder';
import { PasswordCipher } from '../helpers/password-cipher/password-cipher';
import { RequestContextService } from '../helpers/request-context/request-context.service';
import { getChannelPermissions } from '../helpers/utils/get-user-channels-permissions';
import { patchEntity } from '../helpers/utils/patch-entity';

import { RoleService } from './role.service';
import { UserService } from './user.service';

/**
 * @description
 * Contains methods relating to {@link Administrator} entities.
 *
 * @docsCategory services
 */
@Injectable()
@Instrument()
export class AdministratorService {
    constructor(
        private connection: TransactionalConnection,
        private configService: ConfigService,
        private listQueryBuilder: ListQueryBuilder,
        private passwordCipher: PasswordCipher,
        private userService: UserService,
        private roleService: RoleService,
        private customFieldRelationService: CustomFieldRelationService,
        private eventBus: EventBus,
        private requestContextService: RequestContextService,
    ) {}

    /** @internal */
    async initAdministrators() {
        await this.ensureSuperAdminExists();
    }

    /**
     * @description
     * Get a paginated list of Administrators.
     */
    findAll(
        ctx: RequestContext,
        options?: ListQueryOptions<Administrator>,
        relations?: RelationPaths<Administrator>,
    ): Promise<PaginatedList<Administrator>> {
        return this.listQueryBuilder
            .build(Administrator, options, {
                relations: relations ?? ['user', 'user.roles'],
                where: { deletedAt: IsNull() },
                ctx,
            })
            .getManyAndCount()
            .then(([items, totalItems]) => ({
                items,
                totalItems,
            }));
    }

    /**
     * @description
     * Get an Administrator by id.
     */
    findOne(
        ctx: RequestContext,
        administratorId: ID,
        relations?: RelationPaths<Administrator>,
    ): Promise<Administrator | undefined> {
        return this.connection
            .getRepository(ctx, Administrator)
            .findOne({
                relations: relations ?? ['user', 'user.roles'],
                where: {
                    id: administratorId,
                    deletedAt: IsNull(),
                },
            })
            .then(result => result ?? undefined);
    }

    /**
     * @description
     * Get an Administrator based on the User id.
     */
    findOneByUserId(
        ctx: RequestContext,
        userId: ID,
        relations?: RelationPaths<Administrator>,
    ): Promise<Administrator | undefined> {
        return this.connection
            .getRepository(ctx, Administrator)
            .findOne({
                relations,
                where: {
                    user: { id: userId },
                    deletedAt: IsNull(),
                },
            })
            .then(result => result ?? undefined);
    }

    /**
     * @description
     * Create a new Administrator.
     */
    async create(ctx: RequestContext, input: CreateAdministratorInput): Promise<Administrator> {
        await this.checkActiveUserCanGrantRoles(ctx, input.roleIds);
        const administrator = new Administrator(input);
        administrator.emailAddress = normalizeEmailAddress(input.emailAddress);
        administrator.user = await this.userService.createAdminUser(ctx, input.emailAddress, input.password);
        let createdAdministrator = await this.connection
            .getRepository(ctx, Administrator)
            .save(administrator);
        for (const roleId of input.roleIds) {
            createdAdministrator = await this.assignRole(ctx, createdAdministrator.id, roleId);
        }
        await this.customFieldRelationService.updateRelations(
            ctx,
            Administrator,
            input,
            createdAdministrator,
        );
        await this.eventBus.publish(new AdministratorEvent(ctx, createdAdministrator, 'created', input));
        return createdAdministrator;
    }

    /**
     * @description
     * Update an existing Administrator.
     */
    async update(ctx: RequestContext, input: UpdateAdministratorInput): Promise<Administrator> {
        const administrator = await this.findOne(ctx, input.id);
        if (!administrator) {
            throw new EntityNotFoundError('Administrator', input.id);
        }
        if (input.roleIds) {
            await this.checkActiveUserCanGrantRoles(ctx, input.roleIds);
        }
        let updatedAdministrator = patchEntity(administrator, input);
        await this.connection.getRepository(ctx, Administrator).save(administrator, { reload: false });

        if (input.emailAddress) {
            updatedAdministrator.user.identifier = input.emailAddress;
            await this.connection.getRepository(ctx, User).save(updatedAdministrator.user);
        }
        if (input.password) {
            const user = await this.userService.getUserById(ctx, administrator.user.id);
            if (user) {
                const nativeAuthMethod = user.getNativeAuthenticationMethod();
                nativeAuthMethod.passwordHash = await this.passwordCipher.hash(input.password);
                await this.connection.getRepository(ctx, NativeAuthenticationMethod).save(nativeAuthMethod);
            }
        }
        if (input.roleIds) {
            const isSoleSuperAdmin = await this.isSoleSuperadmin(ctx, input.id);
            if (isSoleSuperAdmin) {
                const superAdminRole = await this.roleService.getSuperAdminRole(ctx);
                if (!input.roleIds.find(id => idsAreEqual(id, superAdminRole.id))) {
                    throw new InternalServerError('error.superadmin-must-have-superadmin-role');
                }
            }
            const removeIds = administrator.user.roles
                .map(role => role.id)
                .filter(roleId => (input.roleIds as ID[]).indexOf(roleId) === -1);

            const addIds = (input.roleIds as ID[]).filter(
                roleId => !administrator.user.roles.some(role => role.id === roleId),
            );

            administrator.user.roles = [];
            await this.connection.getRepository(ctx, User).save(administrator.user, { reload: false });
            for (const roleId of input.roleIds) {
                updatedAdministrator = await this.assignRole(ctx, administrator.id, roleId);
            }
            await this.eventBus.publish(new RoleChangeEvent(ctx, administrator, addIds, 'assigned'));
            await this.eventBus.publish(new RoleChangeEvent(ctx, administrator, removeIds, 'removed'));
        }
        await this.customFieldRelationService.updateRelations(
            ctx,
            Administrator,
            input,
            updatedAdministrator,
        );
        await this.eventBus.publish(new AdministratorEvent(ctx, administrator, 'updated', input));
        return updatedAdministrator;
    }

    /**
     * @description
     * Checks that the active user is allowed to grant the specified Roles when creating or
     * updating an Administrator.
     */
    private async checkActiveUserCanGrantRoles(ctx: RequestContext, roleIds: ID[]) {
        const roles = await this.connection.getRepository(ctx, Role).find({
            where: { id: In(roleIds) },
            relations: { channels: true },
        });
        const permissionsRequired = getChannelPermissions(roles);
        for (const channelPermissions of permissionsRequired) {
            const activeUserHasRequiredPermissions = await this.roleService.userHasAllPermissionsOnChannel(
                ctx,
                channelPermissions.id,
                channelPermissions.permissions,
            );
            if (!activeUserHasRequiredPermissions) {
                throw new UserInputError('error.active-user-does-not-have-sufficient-permissions');
            }
        }
    }

    /**
     * @description
     * Assigns a Role to the Administrator's User entity.
     */
    async assignRole(ctx: RequestContext, administratorId: ID, roleId: ID): Promise<Administrator> {
        const administrator = await this.findOne(ctx, administratorId);
        if (!administrator) {
            throw new EntityNotFoundError('Administrator', administratorId);
        }
        const role = await this.roleService.findOne(ctx, roleId);
        if (!role) {
            throw new EntityNotFoundError('Role', roleId);
        }
        administrator.user.roles.push(role);
        await this.connection.getRepository(ctx, User).save(administrator.user, { reload: false });
        return administrator;
    }

    /**
     * @description
     * Soft deletes an Administrator (sets the `deletedAt` field).
     */
    async softDelete(ctx: RequestContext, id: ID) {
        const administrator = await this.connection.getEntityOrThrow(ctx, Administrator, id, {
            relations: ['user'],
        });
        const isSoleSuperadmin = await this.isSoleSuperadmin(ctx, id);
        if (isSoleSuperadmin) {
            throw new InternalServerError('error.cannot-delete-sole-superadmin');
        }
        await this.connection
            .getRepository(ctx, Administrator)
            .update({ id }, { isCurrent: null, deletedAt: new Date() });
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        await this.userService.softDelete(ctx, administrator.user.id);
        await this.eventBus.publish(new AdministratorEvent(ctx, administrator, 'deleted', id));
        return {
            result: DeletionResult.DELETED,
        };
    }

    /**
     * @description
     * Resolves to `true` if the administrator ID belongs to the only Administrator
     * with SuperAdmin permissions.
     */
    private async isSoleSuperadmin(ctx: RequestContext, id: ID) {
        const superAdminRole = await this.roleService.getSuperAdminRole(ctx);
        const allAdmins = await this.connection.getRepository(ctx, Administrator).find({
            relations: ['user', 'user.roles'],
        });
        const superAdmins = allAdmins.filter(
            admin => !!admin.user.roles.find(r => r.id === superAdminRole.id),
        );
        if (1 < superAdmins.length) {
            return false;
        } else {
            return idsAreEqual(superAdmins[0].id, id);
        }
    }

    /**
     * @description
     * There must always exist a SuperAdmin, otherwise full administration via API will
     * no longer be possible.
     *
     * @internal
     */
    private async ensureSuperAdminExists() {
        const { superadminCredentials } = this.configService.authOptions;

        const superAdminUser = await this.connection.rawConnection.getRepository(User).findOne({
            where: {
                identifier: superadminCredentials.identifier,
            },
        });

        if (!superAdminUser) {
            const ctx = await this.requestContextService.create({ apiType: 'admin' });
            const superAdminRole = await this.roleService.getSuperAdminRole();
            const administrator = new Administrator({
                emailAddress: superadminCredentials.identifier,
                firstName: 'Super',
                lastName: 'Admin',
            });
            administrator.user = await this.userService.createAdminUser(
                ctx,
                superadminCredentials.identifier,
                superadminCredentials.password,
            );
            const { id } = await this.connection.getRepository(ctx, Administrator).save(administrator);
            const createdAdministrator = await assertFound(this.findOne(ctx, id));
            createdAdministrator.user.roles.push(superAdminRole);
            await this.connection.getRepository(ctx, User).save(createdAdministrator.user, { reload: false });
        } else {
            const superAdministrator = await this.connection.rawConnection
                .getRepository(Administrator)
                .findOne({
                    where: {
                        user: {
                            id: superAdminUser.id,
                        },
                    },
                });
            if (!superAdministrator) {
                const administrator = new Administrator({
                    emailAddress: superadminCredentials.identifier,
                    firstName: 'Super',
                    lastName: 'Admin',
                });
                const createdAdministrator = await this.connection.rawConnection
                    .getRepository(Administrator)
                    .save(administrator);
                createdAdministrator.user = superAdminUser;
                await this.connection.rawConnection.getRepository(Administrator).save(createdAdministrator);
            } else if (superAdministrator.deletedAt != null) {
                superAdministrator.deletedAt = null;
                await this.connection.rawConnection.getRepository(Administrator).save(superAdministrator);
            }

            if (superAdminUser.deletedAt != null) {
                superAdminUser.deletedAt = null;
                await this.connection.rawConnection.getRepository(User).save(superAdminUser);
            }
        }
    }
}
