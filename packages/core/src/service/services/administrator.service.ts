import { Injectable } from '@nestjs/common';
import {
    CreateAdministratorInput,
    DeletionResult,
    UpdateAdministratorInput,
} from '@vendure/common/lib/generated-types';
import { ID, PaginatedList } from '@vendure/common/lib/shared-types';
import { unique } from '@vendure/common/lib/unique';
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
import { Channel } from '../../entity/channel/channel.entity';
import { User } from '../../entity/user/user.entity';
import { EventBus } from '../../event-bus';
import { AdministratorEvent } from '../../event-bus/events/administrator-event';
import { CustomFieldRelationService } from '../helpers/custom-field-relation/custom-field-relation.service';
import { ListQueryBuilder } from '../helpers/list-query-builder/list-query-builder';
import { PasswordCipher } from '../helpers/password-cipher/password-cipher';
import { RequestContextService } from '../helpers/request-context/request-context.service';
import { checkSuperadminCredentials } from '../helpers/utils/check-superadmin-credentials';
import { patchEntity } from '../helpers/utils/patch-entity';

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
                relations: relations ?? ['user'],
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
                relations: relations ?? ['user'],
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
        this.assertRoleInputsAreExclusive(input);
        // Deprecated `roleIds` input (since 4.0.0): remove this branch in v5.0.0.
        if (input.roleIds) {
            await this.roleService.assertActiveUserCanGrantRoles(ctx, input.roleIds, [ctx.channelId]);
        }
        const normalizedEmail = normalizeEmailAddress(input.emailAddress);
        await this.checkForDuplicateEmailAddress(ctx, normalizedEmail);
        const administrator = new Administrator(input);
        administrator.emailAddress = normalizedEmail;
        administrator.user = await this.userService.createAdminUser(ctx, input.emailAddress, input.password);
        const savedAdministrator = await this.connection
            .getRepository(ctx, Administrator)
            .save(administrator);
        if (input.roleAssignments) {
            await this.setRoleAssignmentsForUser(ctx, savedAdministrator.user.id, input.roleAssignments);
        } else if (input.roleIds) {
            // Deprecated `roleIds` input (since 4.0.0): grants the Roles on the active Channel.
            // Remove this branch in v5.0.0.
            await this.roleAssignmentService.replaceUserAssignmentsOnChannel(
                ctx,
                savedAdministrator.user.id,
                input.roleIds,
                ctx.channelId,
            );
        }
        // Every Administrator is granted the RoleEditor role on the Channels of their
        // initial Role grants (the active Channel when created without Roles), giving them
        // the Role CRUD permissions there.
        await this.grantRoleEditor(
            ctx,
            savedAdministrator.user.id,
            input.roleAssignments?.length
                ? input.roleAssignments.map(assignment => assignment.channelId)
                : [ctx.channelId],
        );
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
        this.assertRoleInputsAreExclusive(input);
        // Deprecated `roleIds` input (since 4.0.0): remove this branch in v5.0.0.
        if (input.roleIds) {
            await this.roleService.assertActiveUserCanGrantRoles(ctx, input.roleIds, [ctx.channelId]);
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
        // Deprecated `roleIds` input (since 4.0.0): remove this whole branch in v5.0.0, leaving
        // `roleAssignments` as the only role input.
        if (input.roleIds) {
            const isSoleSuperAdmin = await this.isSoleSuperadmin(ctx, input.id);
            if (isSoleSuperAdmin) {
                const superAdminRole = await this.roleService.getSuperAdminRole(ctx);
                if (!input.roleIds.find(id => idsAreEqual(id, superAdminRole.id))) {
                    throw new InternalServerError('error.superadmin-must-have-superadmin-role');
                }
            }
            // The deprecated `roleIds` input replaces the user's Role assignments on the
            // active Channel; assignments on other Channels are untouched. The write is
            // expressed as a full replace-set so that both role inputs share one write path
            // and one event contract.
            const userId = administrator.user.id;
            const existing = await this.roleAssignmentService.getAssignmentsForUser(ctx, userId);
            const target: RoleChannelPair[] = [
                ...existing
                    .filter(assignment => !idsAreEqual(assignment.channelId, ctx.channelId))
                    .map(assignment => ({ roleId: assignment.roleId, channelId: assignment.channelId })),
                ...input.roleIds.map(roleId => ({ roleId, channelId: ctx.channelId })),
            ];
            await this.setRoleAssignmentsForUser(ctx, userId, target);
            updatedAdministrator = await assertFound(this.findOne(ctx, administrator.id));
        }
        if (input.roleAssignments) {
            await this.setRoleAssignmentsForUser(ctx, administrator.user.id, input.roleAssignments);
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
     * Assigns a Role to the Administrator's User on the active Channel.
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
        await this.roleAssignmentService.assignRoleOnChannel(
            ctx,
            administrator.user.id,
            roleId,
            ctx.channelId,
        );
        return assertFound(this.findOne(ctx, administratorId));
    }

    /**
     * @description
     * Atomically replaces the full set of RoleAssignments of the given User with the given
     * `(roleId, channelId)` pairs, across all Channels: pairs not in the new set are removed.
     *
     * The active user must be permitted to grant every Role involved in the change — added
     * and removed pairs alike — on the Channel of that pair (see
     * {@link RoleService.assertActiveUserCanGrantRoles}). The sole SuperAdmin cannot have
     * the SuperAdmin Role taken away.
     *
     * This is the single write path behind the `roleAssignments` and the deprecated `roleIds`
     * inputs of the administrator mutations. The changed pairs are reported by the
     * {@link RoleAssignmentEvent} published from {@link RoleAssignmentService}; there is no
     * separate administrator-level role event.
     *
     * @since 4.0.0
     */
    async setRoleAssignmentsForUser(
        ctx: RequestContext,
        userId: ID,
        assignments: RoleChannelPair[],
    ): Promise<User> {
        const user = await this.userService.getUserById(ctx, userId);
        if (!user) {
            throw new EntityNotFoundError('User', userId);
        }
        const target = assignments.filter(
            (pair, index) =>
                assignments.findIndex(
                    other =>
                        idsAreEqual(other.roleId, pair.roleId) &&
                        idsAreEqual(other.channelId, pair.channelId),
                ) === index,
        );
        const channelIds = unique(target.map(pair => pair.channelId));
        const channels = await this.connection
            .getRepository(ctx, Channel)
            .find({ where: { id: In(channelIds) } });
        for (const channelId of channelIds) {
            if (!channels.some(channel => idsAreEqual(channel.id, channelId))) {
                throw new EntityNotFoundError('Channel', channelId);
            }
        }
        const existing = await this.roleAssignmentService.getAssignmentsForUser(ctx, userId);
        const added = target.filter(
            pair =>
                !existing.some(
                    assignment =>
                        idsAreEqual(assignment.roleId, pair.roleId) &&
                        idsAreEqual(assignment.channelId, pair.channelId),
                ),
        );
        const removed = existing.filter(
            assignment =>
                !target.some(
                    pair =>
                        idsAreEqual(pair.roleId, assignment.roleId) &&
                        idsAreEqual(pair.channelId, assignment.channelId),
                ),
        );
        const changedPairs: RoleChannelPair[] = [
            ...added,
            ...removed.map(assignment => ({
                roleId: assignment.roleId,
                channelId: assignment.channelId,
            })),
        ];
        for (const roleId of unique(changedPairs.map(pair => pair.roleId))) {
            const roleChannelIds = unique(
                changedPairs.filter(pair => idsAreEqual(pair.roleId, roleId)).map(pair => pair.channelId),
            );
            await this.roleService.assertActiveUserCanGrantRoles(ctx, [roleId], roleChannelIds);
        }
        const administrator = await this.findOneByUserId(ctx, userId);
        if (administrator) {
            const isSoleSuperAdmin = await this.isSoleSuperadmin(ctx, administrator.id);
            if (isSoleSuperAdmin) {
                const superAdminRole = await this.roleService.getSuperAdminRole(ctx);
                if (!target.some(pair => idsAreEqual(pair.roleId, superAdminRole.id))) {
                    throw new InternalServerError('error.superadmin-must-have-superadmin-role');
                }
            }
        }
        await this.roleAssignmentService.setAssignmentsForUser(ctx, userId, target);
        return assertFound(this.userService.getUserById(ctx, userId));
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
        await this.connection.getRepository(ctx, Administrator).update({ id }, { deletedAt: new Date() });
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        await this.userService.softDelete(ctx, administrator.user.id);
        await this.eventBus.publish(new AdministratorEvent(ctx, administrator, 'deleted', id));
        return {
            result: DeletionResult.DELETED,
        };
    }

    /**
     * Grants the RoleEditor role to the given User on the given Channels. The grant is
     * system-mandated rather than actor-made, so it deliberately bypasses
     * assertActiveUserCanGrantRoles: the acting user may hold CreateAdministrator
     * without the Role CRUD permissions.
     */
    private async grantRoleEditor(ctx: RequestContext, userId: ID, channelIds: ID[]): Promise<void> {
        const roleEditorRole = await this.roleService.getRoleEditorRole(ctx);
        for (const channelId of unique(channelIds)) {
            await this.roleAssignmentService.assignRoleOnChannel(ctx, userId, roleEditorRole.id, channelId);
        }
    }

    /**
     * Guards the overlap of the deprecated `roleIds` input (since 4.0.0) with `roleAssignments`.
     * Remove in v5.0.0 together with the `roleIds` inputs.
     */
    private assertRoleInputsAreExclusive(input: {
        roleIds?: ID[] | null;
        roleAssignments?: RoleChannelPair[] | null;
    }) {
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
     * Resolves to `true` if the administrator ID belongs to the only Administrator
     * with SuperAdmin permissions.
     */
    private async isSoleSuperadmin(ctx: RequestContext, id: ID) {
        const superAdminRole = await this.roleService.getSuperAdminRole(ctx);
        const superAdminUserIds = await this.roleAssignmentService.resolveUserIdsWithRole(
            ctx,
            superAdminRole.id,
        );
        const allAdmins = await this.connection.getRepository(ctx, Administrator).find({
            relations: ['user'],
            where: { deletedAt: IsNull() },
        });
        const superAdmins = allAdmins.filter(admin =>
            superAdminUserIds.some(userId => idsAreEqual(userId, admin.user.id)),
        );
        if (superAdmins.length === 0) {
            return false;
        }
        if (superAdmins.length > 1) {
            return false;
        }
        return idsAreEqual(superAdmins[0].id, id);
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
            // Effective permissions are derived at check time from the SuperAdmin permission,
            // so these rows are not what grants access — assigning on every Channel keeps
            // assignment reads consistent with that access when the user is seeded on an
            // instance which already has Channels beyond the default one (e.g. after
            // superadminCredentials.identifier is changed in the config).
            await this.roleAssignmentService.assignRoleOnAllChannels(
                ctx,
                administrator.user.id,
                superAdminRole.id,
            );
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
