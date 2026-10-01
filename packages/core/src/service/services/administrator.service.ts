import { Injectable } from '@nestjs/common';
import {
    CreateAdministratorInput,
    DeletionResult,
    Permission,
    UpdateAdministratorInput,
} from '@vendure/common/lib/generated-types';
import { ID, PaginatedList } from '@vendure/common/lib/shared-types';
import { unique } from '@vendure/common/lib/unique';
import { IsNull, NotBrackets, SelectQueryBuilder } from 'typeorm';

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
import { RoleAssignment } from '../../entity/role-assignment/role-assignment.entity';
import { User } from '../../entity/user/user.entity';
import { EventBus } from '../../event-bus';
import { AdministratorEvent } from '../../event-bus/events/administrator-event';
import { CustomFieldRelationService } from '../helpers/custom-field-relation/custom-field-relation.service';
import { ListQueryBuilder } from '../helpers/list-query-builder/list-query-builder';
import { PasswordCipher } from '../helpers/password-cipher/password-cipher';
import { RequestContextService } from '../helpers/request-context/request-context.service';
import { checkSuperadminCredentials } from '../helpers/utils/check-superadmin-credentials';
import { patchEntity } from '../helpers/utils/patch-entity';

import { ChannelService } from './channel.service';
import { RoleAssignmentService, RoleChannelPair } from './role-assignment.service';
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
        private roleAssignmentService: RoleAssignmentService,
        private channelService: ChannelService,
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
     * Get a paginated list of the Administrators the active user has authority over
     * ({@link RoleAssignmentService.activeUserCanManageUser}).
     */
    async findAll(
        ctx: RequestContext,
        options?: ListQueryOptions<Administrator>,
        relations?: RelationPaths<Administrator>,
    ): Promise<PaginatedList<Administrator>> {
        const qb = this.listQueryBuilder.build(Administrator, options, {
            relations: relations ?? ['user'],
            where: { deletedAt: IsNull() },
            ctx,
        });
        await this.restrictToManageableAdministrators(ctx, qb);
        const [items, totalItems] = await qb.getManyAndCount();
        return { items, totalItems };
    }

    /**
     * @description
     * Get an Administrator by id.
     *
     * Resolves to `undefined` if the active user has no authority over the Administrator
     * ({@link RoleAssignmentService.activeUserCanManageUser}), so that a caller cannot
     * confirm the existence of an Administrator they are not allowed to see. update(),
     * assignRole() and softDelete() look the target up through this method, so the same rule
     * decides who may modify an Administrator.
     */
    async findOne(
        ctx: RequestContext,
        administratorId: ID,
        relations?: RelationPaths<Administrator>,
    ): Promise<Administrator | undefined> {
        const administrator = await this.connection.getRepository(ctx, Administrator).findOne({
            // The User is always loaded, since it is what the authority check is based on.
            relations: unique([...(relations ?? []), 'user']),
            where: {
                id: administratorId,
                deletedAt: IsNull(),
            },
        });
        if (!administrator) {
            return undefined;
        }
        const manageable = await this.roleAssignmentService.activeUserCanManageUser(
            ctx,
            administrator.user.id,
        );
        return manageable ? administrator : undefined;
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
        this.assertRoleInputsAreExclusive(input);
        // Deprecated `roleIds` input (since 4.0.0): grants the Roles on the active Channel.
        // Remove the roleIds alternative in v5.0.0.
        const roleAssignments: RoleChannelPair[] =
            input.roleAssignments ??
            input.roleIds?.map(roleId => ({ roleId, channelId: ctx.channelId })) ??
            [];
        // Checked before anything is written, so a denied grant leaves no Administrator behind
        // even for callers outside a transaction. RoleAssignmentService.assign checks again.
        await this.roleService.assertActiveUserCanGrantRoles(ctx, roleAssignments);
        const normalizedEmail = normalizeEmailAddress(input.emailAddress);
        await this.checkForDuplicateEmailAddress(ctx, normalizedEmail);
        const administrator = new Administrator(input);
        administrator.emailAddress = normalizedEmail;
        administrator.user = await this.userService.createAdminUser(ctx, input.emailAddress, input.password);
        const savedAdministrator = await this.connection
            .getRepository(ctx, Administrator)
            .save(administrator);
        if (roleAssignments.length) {
            await this.roleAssignmentService.assign(ctx, savedAdministrator.user.id, roleAssignments);
        }
        const createdAdministrator = await assertFound(this.findOne(ctx, savedAdministrator.id));
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
        if (input.emailAddress) {
            const normalizedEmail = normalizeEmailAddress(input.emailAddress);
            await this.checkForDuplicateEmailAddress(ctx, normalizedEmail, input.id);
            input.emailAddress = normalizedEmail;
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
        // Deprecated `roleIds` input (since 4.0.0): replaces the user's Roles on the active
        // Channel, as deltas through assign / remove. Role changes otherwise go through the
        // assignRolesToUser / removeRolesFromUser mutations. Remove this branch in v5.0.0.
        if (input.roleIds) {
            await this.roleAssignmentService.replaceRolesOnChannel(
                ctx,
                administrator.user.id,
                input.roleIds,
                ctx.channelId,
            );
            updatedAdministrator = await assertFound(this.findOne(ctx, administrator.id));
        }
        await this.customFieldRelationService.updateRelations(
            ctx,
            Administrator,
            input,
            updatedAdministrator,
        );
        await this.eventBus.publish(new AdministratorEvent(ctx, updatedAdministrator, 'updated', input));
        return updatedAdministrator;
    }

    /**
     * @description
     * Assigns a Role to the Administrator's User on the active Channel. The write goes
     * through {@link RoleAssignmentService.assign}, so the active user must be permitted to
     * grant the Role on the active Channel and a {@link RoleAssignmentEvent} is published.
     */
    async assignRole(ctx: RequestContext, administratorId: ID, roleId: ID): Promise<Administrator> {
        const administrator = await this.findOne(ctx, administratorId);
        if (!administrator) {
            throw new EntityNotFoundError('Administrator', administratorId);
        }
        await this.roleAssignmentService.assign(ctx, administrator.user.id, [
            { roleId, channelId: ctx.channelId },
        ]);
        return assertFound(this.findOne(ctx, administratorId));
    }

    /**
     * @description
     * Soft deletes an Administrator (sets the `deletedAt` field) and removes all of its
     * User's RoleAssignments. The rows go because a deleted Administrator holds nothing:
     * left in place they would keep counting towards the Channels a Role is assigned on
     * (see {@link RoleService}), and so keep gating the Role for live administrators. One
     * `removed` {@link RoleAssignmentEvent} listing the removed assignments is published
     * ({@link RoleAssignmentService.removeAllAssignmentsForUser}).
     */
    async softDelete(ctx: RequestContext, id: ID) {
        const administrator = await this.findOne(ctx, id);
        if (!administrator) {
            throw new EntityNotFoundError('Administrator', id);
        }
        if (await this.roleAssignmentService.isSoleSuperAdminHolder(ctx, administrator.user.id)) {
            throw new InternalServerError('error.cannot-delete-sole-superadmin');
        }
        await this.connection.getRepository(ctx, Administrator).update({ id }, { deletedAt: new Date() });
        await this.roleAssignmentService.removeAllAssignmentsForUser(ctx, administrator.user.id);
        await this.userService.softDelete(ctx, administrator.user.id);
        await this.eventBus.publish(new AdministratorEvent(ctx, administrator, 'deleted', id));
        return {
            result: DeletionResult.DELETED,
        };
    }

    /**
     * Restricts a list query to the Administrators the active user has authority over, by the
     * rule of {@link RoleAssignmentService.activeUserCanManageUser}. The restriction is applied
     * to the query rather than to its result, so that `totalItems`, sorting, filtering and
     * pagination all operate over the visible Administrators only.
     */
    private async restrictToManageableAdministrators(
        ctx: RequestContext,
        qb: SelectQueryBuilder<Administrator>,
    ) {
        // canGrant holds for every pair for a SuperAdmin, so the sub-query below would exclude
        // nobody. This early return only saves the query.
        if (ctx.userHasPermissions([Permission.SuperAdmin])) {
            return;
        }
        const grantable = await this.roleService.getGrantableChannelIdsByRole(ctx);
        // An Administrator is excluded as soon as they hold a single assignment the active user
        // may not grant. A sub-query is used rather than a join on the main query, so that the
        // Administrator rows are not duplicated by their assignments.
        qb.andWhere(outerQb => {
            const hiddenAdministratorsQuery = outerQb
                .subQuery()
                .select('hidden_administrator.id')
                .from(Administrator, 'hidden_administrator')
                .innerJoin('hidden_administrator.user', 'hidden_user')
                .innerJoin(RoleAssignment, 'hidden_assignment', 'hidden_assignment.userId = hidden_user.id');
            // With nothing grantable, every assignment is hidden, so no condition is needed.
            if (grantable.length) {
                hiddenAdministratorsQuery.where(
                    new NotBrackets(grantableQb => {
                        grantable.forEach(({ roleId, channelIds }, i) => {
                            grantableQb.orWhere(
                                `(hidden_assignment.roleId = :grantableRole${i} AND hidden_assignment.channelId IN (:...grantableChannels${i}))`,
                                { [`grantableRole${i}`]: roleId, [`grantableChannels${i}`]: channelIds },
                            );
                        });
                    }),
                );
            }
            const administratorId = `${outerQb.escape(outerQb.alias)}.${outerQb.escape('id')}`;
            return `${administratorId} NOT IN ${hiddenAdministratorsQuery.getQuery()}`;
        });
    }

    /**
     * Guards the overlap of the deprecated `roleIds` input (since 4.0.0) with `roleAssignments`
     * on creation. Remove in v5.0.0 together with the `roleIds` inputs.
     */
    private assertRoleInputsAreExclusive(input: CreateAdministratorInput) {
        if (input.roleIds && input.roleAssignments) {
            throw new UserInputError('error.role-ids-and-role-assignments-are-mutually-exclusive');
        }
    }

    private async checkForDuplicateEmailAddress(ctx: RequestContext, emailAddress: string, excludeId?: ID) {
        const existing = await this.connection.getRepository(ctx, Administrator).findOne({
            where: {
                emailAddress,
                deletedAt: IsNull(),
            },
        });
        if (existing && (!excludeId || !idsAreEqual(existing.id, excludeId))) {
            throw new UserInputError('error.email-address-already-exists-for-administrator');
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

        checkSuperadminCredentials(superadminCredentials);

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
            await this.connection.getRepository(ctx, Administrator).save(administrator);
            // The SuperAdmin Role is stored as one row on the default Channel (see
            // RoleAssignment); effective permissions on every Channel are derived from it at
            // check time by the RolePermissionResolver.
            const defaultChannel = await this.channelService.getDefaultChannel(ctx);
            await this.roleAssignmentService.createAssignments(ctx, administrator.user.id, [
                { roleId: superAdminRole.id, channelId: defaultChannel.id },
            ]);
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
