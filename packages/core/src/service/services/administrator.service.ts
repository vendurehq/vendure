import { Injectable } from '@nestjs/common';
import {
    CreateAdministratorInput,
    DeletionResult,
    Permission,
    UpdateAdministratorInput,
} from '@vendure/common/lib/generated-types';
import { ID, PaginatedList } from '@vendure/common/lib/shared-types';
import { unique } from '@vendure/common/lib/unique';
import { IsNull } from 'typeorm';

import { RequestContext } from '../../api/common/request-context';
import { RelationPaths } from '../../api/decorators/relations.decorator';
import { Instrument } from '../../common';
import { isGraphQlErrorResult } from '../../common/error/error-result';
import { EntityNotFoundError, InternalServerError, UserInputError } from '../../common/error/errors';
import {
    PasswordResetTokenExpiredError,
    PasswordResetTokenInvalidError,
    PasswordValidationError,
} from '../../common/error/generated-graphql-admin-errors';
import { ListQueryOptions } from '../../common/types/common-types';
import { assertFound, idsAreEqual, normalizeEmailAddress } from '../../common/utils';
import { API_KEY_AUTH_STRATEGY_NAME, ConfigService, Logger } from '../../config';
import { findOptionsArrayToObject } from '../../connection/find-options-array-to-object';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { Administrator } from '../../entity/administrator/administrator.entity';
import { ApiKey } from '../../entity/api-key/api-key.entity';
import { NativeAuthenticationMethod } from '../../entity/authentication-method/native-authentication-method.entity';
import { User } from '../../entity/user/user.entity';
import { EventBus } from '../../event-bus';
import { AdministratorEvent } from '../../event-bus/events/administrator-event';
import { AdministratorPasswordResetEvent } from '../../event-bus/events/administrator-password-reset-event';
import { PasswordResetVerifiedEvent } from '../../event-bus/events/password-reset-verified-event';
import { CustomFieldRelationService } from '../helpers/custom-field-relation/custom-field-relation.service';
import { ListQueryBuilder } from '../helpers/list-query-builder/list-query-builder';
import { PasswordCipher } from '../helpers/password-cipher/password-cipher';
import { RequestContextService } from '../helpers/request-context/request-context.service';
import { StoredMediaUpload } from '../helpers/stored-media/stored-media.service';
import { checkSuperadminCredentials } from '../helpers/utils/check-superadmin-credentials';
import { patchEntity } from '../helpers/utils/patch-entity';
import { getRequestedRoleAssignments } from '../helpers/utils/requested-role-assignments';

import { AssetService } from './asset.service';
import { ChannelService } from './channel.service';
import { RoleAssignmentService } from './role-assignment.service';
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
        private assetService: AssetService,
        private eventBus: EventBus,
        private requestContextService: RequestContextService,
    ) {}

    /**
     * Replaces or removes profile-owned media for an Administrator.
     *
     * The Administrator is read through {@link AdministratorService.findOne}, so an Administrator
     * which is not visible to the active user cannot have their avatar changed.
     */
    async setAvatar(
        ctx: RequestContext,
        administratorId: ID,
        upload: Promise<StoredMediaUpload> | StoredMediaUpload | null,
    ): Promise<Administrator> {
        const administrator = await this.findOne(ctx, administratorId);
        if (!administrator) {
            throw new EntityNotFoundError('Administrator', administratorId);
        }
        return this.writeAvatar(ctx, administrator, upload);
    }

    /**
     * Replaces or removes profile-owned media for an Administrator without applying the visibility
     * rule that {@link AdministratorService.setAvatar} applies.
     *
     * External authentication runs while the request is still anonymous: the session is minted only
     * once the strategy has returned a User. An anonymous active user holds no permissions, so the
     * visibility rule hides every Administrator from it, including the one the strategy has just
     * created. A strategy which synchronizes a provider profile image therefore cannot go through
     * the visibility-scoped read.
     *
     * The caller is responsible for establishing that it may write to this Administrator. Do not
     * use this method to serve a request whose Administrator id comes from the client.
     *
     * @internal
     */
    async setAvatarWithoutVisibilityCheck(
        ctx: RequestContext,
        administratorId: ID,
        upload: Promise<StoredMediaUpload> | StoredMediaUpload | null,
    ): Promise<Administrator> {
        const administrator = await this.connection.getRepository(ctx, Administrator).findOne({
            relations: { avatar: true },
            where: {
                id: administratorId,
                deletedAt: IsNull(),
            },
        });
        if (!administrator) {
            throw new EntityNotFoundError('Administrator', administratorId);
        }
        return this.writeAvatar(ctx, administrator, upload);
    }

    /**
     * Writes the avatar of an already-loaded Administrator. The new files are persisted before the
     * old files are deleted so a failed upload never destroys the currently-visible avatar.
     */
    private async writeAvatar(
        ctx: RequestContext,
        administrator: Administrator,
        upload: Promise<StoredMediaUpload> | StoredMediaUpload | null,
    ): Promise<Administrator> {
        const previousAvatar = administrator.avatar;

        if (upload == null) {
            administrator.avatar = null;
            await this.connection.getRepository(ctx, Administrator).save(administrator, { reload: false });
            if (previousAvatar) {
                await this.assetService.deleteSystemAsset(ctx, previousAvatar);
            }
            return administrator;
        }

        const avatar = await this.assetService.createSystemAsset(ctx, upload, { imageOnly: true });
        if (isGraphQlErrorResult(avatar)) {
            throw new UserInputError('error.mime-type-not-permitted', {
                fileName: avatar.fileName,
                mimeType: avatar.mimeType,
            });
        }
        administrator.avatar = avatar;
        try {
            await this.connection.getRepository(ctx, Administrator).save(administrator, { reload: false });
        } catch (error) {
            await this.assetService.deleteSystemAsset(ctx, avatar);
            throw error;
        }
        if (previousAvatar) {
            await this.assetService.deleteSystemAsset(ctx, previousAvatar);
        }
        return administrator;
    }

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
            relations: relations ?? ['avatar', 'user'],
            where: { deletedAt: IsNull() },
            ctx,
        });
        // Restricted to the Administrators the active user has authority over, in the query so that
        // totalItems, sorting, filtering and pagination operate over the visible ones only.
        await this.roleAssignmentService.restrictToManageableUsers(
            ctx,
            qb,
            'userId',
            Permission.ReadAdministrator,
        );
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
            relations: findOptionsArrayToObject<Administrator>(unique([...(relations ?? ['avatar']), 'user'])),
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
                relations: findOptionsArrayToObject<Administrator>(relations ?? ['avatar']),
                where: {
                    user: { id: userId },
                    deletedAt: IsNull(),
                },
            })
            .then(result => result ?? undefined);
    }

    /**
     * @description
     * Resolves the Administrator to be credited as the actor of the current request when
     * recording an audit trail, e.g. the `administrator` of a {@link HistoryEntry}.
     *
     * For a regular session this is the Administrator of the active User, exactly as returned by
     * {@link AdministratorService.findOneByUserId}.
     *
     * An API-Key session authenticates as the synthetic "API-Key user" created alongside the key,
     * which has no Administrator of its own. For those sessions we fall back to the Administrator
     * of the {@link ApiKey}'s `owner`, so that actions performed with the key are attributed to the
     * Administrator who created it. The owner is not required to be an Administrator — it may be a
     * Customer's User — in which case `undefined` is returned and the entry stays unattributed.
     *
     * This is deliberately kept separate from {@link AdministratorService.findOneByUserId}, which
     * answers the literal question "which Administrator belongs to this User id?".
     *
     * **Never use this method to make authorization decisions.** The Administrator it returns is not
     * the authenticated principal of the request, and their permissions do not apply to it.
     *
     * @since 3.6.4
     */
    async resolveActorAdministrator(
        ctx: RequestContext,
        relations?: RelationPaths<Administrator>,
    ): Promise<Administrator | undefined> {
        if (!ctx.activeUserId) {
            return undefined;
        }
        const activeAdministrator = await this.findOneByUserId(ctx, ctx.activeUserId, relations);
        if (activeAdministrator) {
            return activeAdministrator;
        }
        if (ctx.session?.authenticationStrategy !== API_KEY_AUTH_STRATEGY_NAME) {
            return undefined;
        }
        // The ApiKey lookup is intentionally not Channel-scoped: the AuthGuard resolves the key
        // via the Channel-aware ApiKeyService.findOneByLookupId() on every request, so a key which
        // gets this far is by definition valid for the current Channel.
        const apiKey = await this.connection.getRepository(ctx, ApiKey).findOne({
            select: { id: true, ownerId: true },
            where: {
                userId: ctx.activeUserId,
                deletedAt: IsNull(),
            },
        });
        if (!apiKey) {
            return undefined;
        }
        const ownerAdministrator = await this.findOneByUserId(ctx, apiKey.ownerId, relations);
        if (!ownerAdministrator) {
            Logger.verbose(
                `The owner (User ${String(apiKey.ownerId)}) of ApiKey ${String(apiKey.id)} is not an ` +
                    'Administrator, so the current request cannot be attributed to one.',
            );
        }
        return ownerAdministrator;
    }

    /**
     * @description
     * Create a new Administrator.
     */
    async create(ctx: RequestContext, input: CreateAdministratorInput): Promise<Administrator> {
        const roleAssignments = getRequestedRoleAssignments(ctx, input);
        // Checked before anything is written, so a denied grant leaves no Administrator behind
        // even for callers outside a transaction. RoleAssignmentService.assign checks again.
        this.roleAssignmentService.assertActiveUserHasPermissionOnChannels(
            ctx,
            Permission.CreateAdministrator,
            roleAssignments.map(pair => pair.channelId),
        );
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
        const administrator = await this.findManageable(ctx, input.id, Permission.UpdateAdministrator);
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
     * Publishes a new {@link AdministratorPasswordResetEvent} for the Administrator with the given
     * email address. The event contains a token which can then be used in the `resetPassword()`
     * method. If no Administrator exists with the given email address, no action is taken.
     *
     * @since 3.8.0
     */
    async requestPasswordReset(ctx: RequestContext, emailAddress: string): Promise<void> {
        // Verify that a non-deleted Administrator exists for the email address *before*
        // writing a reset token, so that this publicly-accessible mutation can never
        // create or overwrite a token on a non-administrator User.
        const user = await this.userService.getUserByEmailAddress(ctx, emailAddress, 'administrator');
        if (!user) {
            return;
        }
        const administrator = await this.findOneByUserId(ctx, user.id);
        if (!administrator) {
            return;
        }
        const userWithToken = await this.userService.setPasswordResetToken(ctx, emailAddress);
        if (!userWithToken) {
            return;
        }
        await this.eventBus.publish(new AdministratorPasswordResetEvent(ctx, administrator, userWithToken));
    }

    /**
     * @description
     * Given a valid password reset token created by a call to the `requestPasswordReset()` method,
     * this method will change the Administrator's password to that given as the `password` argument.
     *
     * @since 3.8.0
     */
    async resetPassword(
        ctx: RequestContext,
        passwordResetToken: string,
        password: string,
    ): Promise<
        User | PasswordResetTokenExpiredError | PasswordResetTokenInvalidError | PasswordValidationError
    > {
        const userForToken = await this.userService.getUserByPasswordResetToken(ctx, passwordResetToken);
        if (!userForToken) {
            return new PasswordResetTokenInvalidError();
        }
        const administrator = await this.findOneByUserId(ctx, userForToken.id);
        if (!administrator) {
            // The token belongs to a non-administrator User (e.g. a Customer), so
            // it may not be used to reset a password via the Admin API.
            return new PasswordResetTokenInvalidError();
        }
        const result = await this.userService.resetPasswordByToken(ctx, passwordResetToken, password);
        if (isGraphQlErrorResult(result)) {
            // The UserService is typed against the Shop API error results, so the
            // structurally-identical Admin API equivalents are returned instead.
            switch (result.__typename) {
                case 'PasswordResetTokenExpiredError':
                    return new PasswordResetTokenExpiredError();
                case 'PasswordValidationError':
                    return new PasswordValidationError({
                        validationErrorMessage: result.validationErrorMessage,
                    });
                default:
                    return new PasswordResetTokenInvalidError();
            }
        }
        await this.eventBus.publish(new PasswordResetVerifiedEvent(ctx, result));
        return result;
    }

    /**
     * @description
     * Assigns a Role to the Administrator's User on the active Channel. The write goes
     * through {@link RoleAssignmentService.assign}, so the active user must be permitted to
     * grant the Role on the active Channel and a {@link RoleAssignmentEvent} is published.
     */
    async assignRole(ctx: RequestContext, administratorId: ID, roleId: ID): Promise<Administrator> {
        const administrator = await this.findManageable(
            ctx,
            administratorId,
            Permission.UpdateAdministrator,
        );
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
        const administrator = await this.findManageable(ctx, id, Permission.DeleteAdministrator);
        if (!administrator) {
            throw new EntityNotFoundError('Administrator', id);
        }
        if (await this.roleAssignmentService.isSoleSuperAdminHolder(ctx, administrator.user.id)) {
            throw new InternalServerError('error.cannot-delete-sole-superadmin');
        }
        // Deleting oneself ends the active session and leaves no way back through the API
        if (ctx.activeUserId != null && idsAreEqual(administrator.user.id, ctx.activeUserId)) {
            throw new UserInputError('error.cannot-delete-own-administrator');
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
     * {@link findOne}, where an Administrator holding no RoleAssignments also requires the given
     * permission on every Channel ({@link RoleAssignmentService.activeUserCanManageUser}).
     */
    private async findManageable(
        ctx: RequestContext,
        id: ID,
        permission: Permission,
    ): Promise<Administrator | undefined> {
        const administrator = await this.findOne(ctx, id);
        if (
            administrator &&
            (await this.roleAssignmentService.activeUserCanManageUser(ctx, administrator.user.id, permission))
        ) {
            return administrator;
        }
        return undefined;
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

        const ctx = await this.requestContextService.create({ apiType: 'admin' });
        const superAdminRole = await this.roleService.getSuperAdminRole();
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        // The SuperAdmin Role is stored as one row on the default Channel (see
        // RoleAssignment); effective permissions on every Channel are derived from it at
        // check time by the RolePermissionResolver.
        const superAdminPair = { roleId: superAdminRole.id, channelId: defaultChannel.id };

        if (!superAdminUser) {
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
            await this.roleAssignmentService.createAssignments(ctx, administrator.user.id, [superAdminPair]);
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
            const wasDeleted = superAdministrator?.deletedAt != null || superAdminUser.deletedAt != null;
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

            // Soft-deleting an Administrator removes its RoleAssignments, so a restored
            // superadmin would come back holding no Role. A live superadmin whose SuperAdmin
            // Role was revoked keeps that revocation.
            if (wasDeleted) {
                await this.roleAssignmentService.createAssignments(ctx, superAdminUser.id, [superAdminPair]);
            }
        }
    }
}
