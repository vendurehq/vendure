import { Injectable } from '@nestjs/common';
import {
    CreateApiKeyInput,
    CreateApiKeyResult,
    DeletionResponse,
    DeletionResult,
    Permission,
    RoleAssignmentInput,
    RotateApiKeyResult,
    UpdateApiKeyInput,
} from '@vendure/common/lib/generated-types';
import { ID, PaginatedList } from '@vendure/common/lib/shared-types';
import { unique } from '@vendure/common/lib/unique';
import { IsNull, UpdateResult } from 'typeorm';

import { ApiType, RelationPaths, RequestContext } from '../../api';
import {
    assertFound,
    EntityNotFoundError,
    Instrument,
    ListQueryOptions,
    Translated,
    UserInputError,
} from '../../common';
import { API_KEY_AUTH_STRATEGY_NAME, ConfigService, Logger } from '../../config';
import { ApiKeyStrategy } from '../../config/api-key-strategy/api-key-strategy';
import { TransactionalConnection } from '../../connection';
import { findOptionsArrayToObject } from '../../connection/find-options-array-to-object';
import { AuthenticationMethod, User } from '../../entity';
import { ApiKeyTranslation } from '../../entity/api-key/api-key-translation.entity';
import { ApiKey } from '../../entity/api-key/api-key.entity';
import { EventBus } from '../../event-bus';
import { ApiKeyEvent } from '../../event-bus/events/api-key-event';
import { CustomFieldRelationService } from '../helpers/custom-field-relation/custom-field-relation.service';
import { ListQueryBuilder } from '../helpers/list-query-builder/list-query-builder';
import { TranslatableSaver } from '../helpers/translatable-saver/translatable-saver';
import { TranslatorService } from '../helpers/translator/translator.service';
import { getRequestedRoleAssignments } from '../helpers/utils/requested-role-assignments';

import { ChannelService } from './channel.service';
import { RoleAssignmentService } from './role-assignment.service';
import { RoleService } from './role.service';
import { SessionService } from './session.service';
import { UserService } from './user.service';

@Injectable()
@Instrument()
export class ApiKeyService {
    constructor(
        private channelService: ChannelService,
        private configService: ConfigService,
        private connection: TransactionalConnection,
        private customFieldRelationService: CustomFieldRelationService,
        private eventBus: EventBus,
        private listQueryBuilder: ListQueryBuilder,
        private roleAssignmentService: RoleAssignmentService,
        private roleService: RoleService,
        private sessionService: SessionService,
        private translatableSaver: TranslatableSaver,
        private translator: TranslatorService,
        private userService: UserService,
    ) {}

    /**
     * @description
     * Returns the appropriate {@link ApiKeyStrategy} based on the {@link ApiType}.
     * This is needed because the admin and shop ApiKeyStrategy may differ.
     */
    getApiKeyStrategyByApiType(apiType: ApiType): ApiKeyStrategy {
        return apiType === 'admin'
            ? this.configService.authOptions.adminApiKeyStrategy
            : this.configService.authOptions.shopApiKeyStrategy;
    }

    /**
     * The API a new key belongs to. Only a request which arrived on the Admin API creates an Admin API
     * key: a context built outside the request-response cycle carries a placeholder apiType, and a REST
     * route is served by the shop api-key strategy. The value is stored on the key, so rotation and
     * session recovery use it instead of the context they happen to run in.
     */
    private getApiTypeForNewApiKey(ctx: RequestContext): ApiType {
        return ctx.req && ctx.apiType === 'admin' ? 'admin' : 'shop';
    }

    /**
     * @description
     * Simple user identifier generation function because it is a non-nullable field on User.
     *
     * Because this simply appends the lookupId, some databases like MySQL/Maria may run into
     * length issues if the lookupId has too many characters. Practically speaking this
     * should not happen but worth to keep in mind.
     *
     * @internal
     */
    private generateApiKeyUserIdentifier(lookupId: string): string {
        return `apikey-user-${lookupId}`;
    }

    /**
     * @description
     * Creates a new API-Key for the given User
     *
     * **Important**: The caller is responsible for avoiding privilege escalations by
     * verifying `userIdOwner` and `userIdApiKeyUser`; **Use this with great care!**
     *
     * If you allow users to specify these IDs, they may leak existing User IDs via thrown errors.
     *
     * @throws {EntityNotFoundError} When either Owner or ApiKeyUser cannot be found
     * @throws {UserInputError} When the User tries to grant a role which they themselves dont have
     */
    async create(
        ctx: RequestContext,
        input: CreateApiKeyInput,
        userIdOwner: ID,
        /**
         * Optionally allow overriding the creation of a separate User.
         * This is an advanced use case for plugin-authors to allow impersonation.
         * You are responsible for avoiding privilege escalation by verifying this ID.
         */
        userIdApiKeyUser?: ID,
    ): Promise<CreateApiKeyResult> {
        const roleAssignments = getRequestedRoleAssignments(ctx, input);
        if (userIdApiKeyUser) {
            this.assertNoRoleInputsForImpersonatedUser(input);
        }
        // Checked before anything is written, so a denied grant leaves no User or ApiKey
        // behind even for callers outside a transaction. RoleAssignmentService.assign checks again.
        this.roleAssignmentService.assertActiveUserHasPermissionOnChannels(
            ctx,
            Permission.CreateApiKey,
            roleAssignments.map(pair => pair.channelId),
        );
        await this.roleService.assertActiveUserCanGrantRoles(ctx, roleAssignments);
        // The key is created on the active and the default Channel (assignToCurrentChannel)
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        await this.roleAssignmentService.assertValidApiKeyGrants(
            ctx,
            unique([ctx.channelId, defaultChannel.id]),
            roleAssignments,
        );

        const ownerUser = await this.connection.getEntityOrThrow(ctx, User, userIdOwner);
        const apiType = this.getApiTypeForNewApiKey(ctx);
        const strategy = this.getApiKeyStrategyByApiType(apiType);
        const lookupId = await strategy.generateLookupId(ctx);
        const existingUser = userIdApiKeyUser
            ? await this.connection.getEntityOrThrow(ctx, User, userIdApiKeyUser)
            : undefined;
        // The session binds to an existing User, whose assignments may exceed the caller's, so the
        // returned secret would be a credential more powerful than the caller. The same authority
        // rule as rotate, update and softDelete (GHSA-37xp-mjp8-6f9x), checked before anything is
        // written.
        if (
            existingUser &&
            !(await this.roleAssignmentService.activeUserCanManageUser(
                ctx,
                existingUser.id,
                Permission.UpdateAdministrator,
            ))
        ) {
            throw new UserInputError('error.active-user-does-not-have-sufficient-permissions');
        }
        const apiKeyUser =
            existingUser ??
            (await this.userService.createApiKeyUser(ctx, this.generateApiKeyUserIdentifier(lookupId)));
        // An impersonated existing User (userIdApiKeyUser) keeps their own assignments
        // instead of being granted new ones.
        if (!userIdApiKeyUser && roleAssignments.length) {
            await this.roleAssignmentService.assign(ctx, apiKeyUser.id, roleAssignments);
        }

        const secret = await strategy.generateSecret(ctx);
        const apiKey = strategy.constructApiKey(lookupId, secret);
        const hash = await strategy.hashingStrategy.hash(apiKey);

        const newEntity = await this.translatableSaver.create({
            ctx,
            input,
            entityType: ApiKey,
            translationType: ApiKeyTranslation,
            beforeSave: async e => {
                e.ownerId = ownerUser.id;
                e.userId = apiKeyUser.id;
                e.apiKeyHash = hash;
                e.lookupId = lookupId;
                e.apiType = apiType;
                await this.channelService.assignToCurrentChannel(e, ctx);
            },
        });

        await this.customFieldRelationService.updateRelations(ctx, ApiKey, input, newEntity);

        // Important: The hash becomes the session token, this is what allows us to authorize on a per-request basis
        // Important: The User of the session may be new User to allow configuring separate permissions
        // The session records the API whose strategy hashed the key, so a key created from a Shop API
        // context, for example by a plugin resolver, cannot be used on the Admin API.
        await this.sessionService.createNewAuthenticatedSession(
            ctx,
            apiKeyUser,
            API_KEY_AUTH_STRATEGY_NAME,
            hash,
            apiType,
        );

        Logger.verbose(
            `Created ApiKey (${newEntity.id}) for User (${userIdOwner}) with ApiKeyUser (${apiKeyUser.id}, ${apiKeyUser.identifier})`,
        );
        await this.eventBus.publish(new ApiKeyEvent(ctx, newEntity, 'created', input));

        return { apiKey, entityId: newEntity.id };
    }

    /**
     * Loads an API-Key in the active Channel, with its User, if the active user may manage it: they
     * must have authority over the key's User, that is, be able to grant every RoleAssignment it
     * holds ({@link RoleAssignmentService.activeUserCanManageUser}), the rule which also decides
     * which Administrators they may see. A key they may not manage throws the same error as a key
     * which does not exist, since {@link findOne} hides it and a different error would disclose
     * that it exists (GHSA-37xp-mjp8-6f9x).
     *
     * @throws {EntityNotFoundError} If the API-Key does not exist or the active user may not manage it
     */
    private async getManageableApiKeyOrThrow(ctx: RequestContext, id: ID): Promise<ApiKey> {
        const entity = await this.connection.getEntityOrThrow(ctx, ApiKey, id, {
            channelId: ctx.channelId,
            includeSoftDeleted: false,
            relations: { user: true },
        });
        if (!(await this.roleAssignmentService.activeUserCanManageUser(ctx, entity.userId))) {
            throw new EntityNotFoundError('ApiKey', id);
        }
        return entity;
    }

    /**
     * @description
     * Updates an API-Key. Is Channel-Aware.
     *
     * @throws {EntityNotFoundError} If API-Key cannot be found
     */
    async update(
        ctx: RequestContext,
        input: UpdateApiKeyInput,
        relations?: RelationPaths<ApiKey>,
    ): Promise<Translated<ApiKey>> {
        // Without this an Administrator holding only UpdateApiKey could rename a higher-privileged
        // key or strip its roles. The roleIds input is additionally checked pair by pair, which
        // stops them raising a key's power.
        const entity = await this.getManageableApiKeyOrThrow(ctx, input.id);

        if (entity.user.identifier !== this.generateApiKeyUserIdentifier(entity.lookupId)) {
            this.assertNoRoleInputsForImpersonatedUser(input);
        }

        const apiKey = await this.translatableSaver.update({
            ctx,
            input,
            entityType: ApiKey,
            translationType: ApiKeyTranslation,
            beforeSave: async () => {
                // Deprecated `roleIds` input (since 4.0.0): replaces the user's Roles on the
                // active Channel, as deltas through assign / remove. Role changes otherwise go
                // through the assignRolesToUser / removeRolesFromUser mutations. Remove this
                // branch in v5.0.0.
                if (input.roleIds) {
                    await this.roleAssignmentService.replaceRolesOnChannel(
                        ctx,
                        entity.user.id,
                        input.roleIds,
                        ctx.channelId,
                    );
                }
            },
        });
        await this.customFieldRelationService.updateRelations(ctx, ApiKey, input, apiKey);

        Logger.verbose(`Updated ApiKey (${apiKey.id}) by User (${String(ctx.activeUserId)})`);
        await this.eventBus.publish(new ApiKeyEvent(ctx, apiKey, 'updated', input));

        return assertFound(this.findOne(ctx, input.id, relations));
    }

    /**
     * An ApiKey whose User is an existing User (impersonation, see `create`) takes that
     * User's own assignments. Accepting role inputs for such a key would let a holder of
     * the ApiKey permissions rewrite the assignments of an Administrator.
     */
    private assertNoRoleInputsForImpersonatedUser(input: {
        roleIds?: ID[] | null;
        roleAssignments?: RoleAssignmentInput[] | null;
    }) {
        if (input.roleIds || input.roleAssignments) {
            throw new UserInputError('error.api-key-impersonated-user-cannot-receive-roles');
        }
    }

    /**
     * @description
     * Soft-Deletes an API-Key and removes its session. Is Channel-Aware.
     *
     * When the API-Key's User exists solely to hold its permissions, that User is soft-deleted
     * too and all of its RoleAssignments are removed, publishing a `removed`
     * {@link RoleAssignmentEvent}. The rows go because a deleted User holds nothing.
     *
     * @throws {EntityNotFoundError} If API-Key cannot be found
     */
    async softDelete(ctx: RequestContext, id: ID): Promise<DeletionResponse> {
        // Without this an Administrator holding only DeleteApiKey could delete a higher-privileged key.
        const apiKey = await this.getManageableApiKeyOrThrow(ctx, id);

        const hasAuthMethod = await this.connection.getRepository(ctx, AuthenticationMethod).existsBy({
            user: { id: apiKey.userId },
        });

        // If this is an impersonated user who can login, we dont want to delete them
        if (hasAuthMethod) {
            await this.sessionService.deleteApiKeySession(ctx, apiKey);
        }
        // If this is an underlying user solely for holding permission, delete them
        else {
            await this.roleAssignmentService.removeAllAssignmentsForUser(ctx, apiKey.userId);
            // SoftDelete should also delete the related sessions & cache
            await this.userService.softDelete(ctx, apiKey.userId);
        }

        apiKey.deletedAt = new Date();
        await this.connection
            .getRepository(ctx, ApiKey)
            .update({ id: apiKey.id }, { deletedAt: apiKey.deletedAt });

        Logger.verbose(`Deleted ApiKey (${id}) by User (${String(ctx.activeUserId)})`);
        await this.eventBus.publish(new ApiKeyEvent(ctx, apiKey, 'deleted', id));

        return { result: DeletionResult.DELETED };
    }

    /**
     * @description
     * Replaces the old with a new API-Key.
     *
     * This is a convenience method to invalidate an API-Key without
     * deleting the underlying roles and permissions.
     *
     * @throws {EntityNotFoundError} If API-Key cannot be found, or the active User has no authority
     * over the key's User
     */
    async rotate(ctx: RequestContext, id: ID): Promise<RotateApiKeyResult> {
        // The rotated secret authenticates as the key's User, whose assignments may exceed the
        // caller's. Without this check an Administrator holding only UpdateApiKey could rotate a
        // higher-privileged key and receive a working credential for it. Runs before any write, so
        // a refused rotation leaves the existing secret intact.
        const entity = await this.getManageableApiKeyOrThrow(ctx, id);

        // The API comes from the key, not from the caller who rotates it. Core exposes rotateApiKey on
        // the Admin API only, so taking it from the context would turn every rotated Shop API key into
        // an Admin API key. Keys created before this column existed were created on the Admin API.
        const apiType = entity.apiType ?? 'admin';
        const strategy = this.getApiKeyStrategyByApiType(apiType);
        const secret = await strategy.generateSecret(ctx);
        const apiKey = strategy.constructApiKey(entity.lookupId, secret);
        const hash = await strategy.hashingStrategy.hash(apiKey);

        await this.sessionService.deleteApiKeySession(ctx, entity);
        await this.sessionService.createNewAuthenticatedSession(
            ctx,
            entity.user,
            API_KEY_AUTH_STRATEGY_NAME,
            hash,
            apiType,
        );

        entity.apiType = apiType;
        entity.apiKeyHash = hash;
        await this.connection.getRepository(ctx, ApiKey).save(entity, { reload: false });

        Logger.verbose(`Rotated ApiKey (${entity.id}) by User (${String(ctx.activeUserId)})`);
        await this.eventBus.publish(new ApiKeyEvent(ctx, entity, 'updated', id));

        return { apiKey };
    }

    /**
     * @description
     * Is channel-/ and soft-delete aware, translates the entity as well.
     */
    async findOne(
        ctx: RequestContext,
        id: ID,
        relations?: RelationPaths<ApiKey>,
    ): Promise<Translated<ApiKey> | null> {
        const entity = await this.connection.findOneInChannel(ctx, ApiKey, id, ctx.channelId, {
            relations,
            where: { deletedAt: IsNull() },
        });
        if (!entity) return null;
        // Hide a key the caller may not manage, so its metadata is not disclosed by id lookup to an
        // Administrator who could not grant the key's assignments. The same rule as the mutations,
        // so the read and write policies cannot drift apart (GHSA-37xp-mjp8-6f9x).
        if (!(await this.roleAssignmentService.activeUserCanManageUser(ctx, entity.userId))) {
            return null;
        }
        return this.translator.translate(entity, ctx);
    }

    /**
     * @description
     * Is channel-/ and soft-delete aware, translates the entity as well.
     */
    async findAll(
        ctx: RequestContext,
        options?: ListQueryOptions<ApiKey>,
        relations?: RelationPaths<ApiKey>,
    ): Promise<PaginatedList<Translated<ApiKey>>> {
        const qb = this.listQueryBuilder.build(ApiKey, options, {
            ctx,
            relations,
            channelId: ctx.channelId,
            where: { deletedAt: IsNull() },
        });
        // Restricted to the keys the caller may manage, in the query so that pagination and
        // totalItems stay correct (GHSA-37xp-mjp8-6f9x).
        await this.roleAssignmentService.restrictToManageableUsers(ctx, qb);
        const [keys, totalItems] = await qb.getManyAndCount();
        const items = keys.map(key => this.translator.translate(key, ctx));
        return { items, totalItems };
    }

    /**
     * @description
     * Is channel-/ and soft-delete aware, translates the entity as well.
     */
    async findOneByLookupId(
        ctx: RequestContext,
        lookupId: ApiKey['lookupId'],
        relations?: RelationPaths<ApiKey>,
    ): Promise<ApiKey | null> {
        const entity = await this.connection.getRepository(ctx, ApiKey).findOne({
            relations: findOptionsArrayToObject<ApiKey>([...(relations ?? []), 'channels']),
            where: {
                lookupId,
                deletedAt: IsNull(),
                channels: { id: ctx.channelId },
            },
        });
        if (!entity) return null;
        return this.translator.translate(entity, ctx);
    }

    /**
     * @description
     * Helper, intended for the AuthGuard to quickly update the lastUsedAt timestamp
     */
    async updateLastUsedAtByLookupId(lookupId: ApiKey['lookupId']): Promise<UpdateResult> {
        return this.connection.rawConnection
            .getRepository(ApiKey)
            .update({ lookupId }, { lastUsedAt: new Date() });
    }
}
