import { Injectable } from '@nestjs/common';
import {
    CreateApiKeyInput,
    CreateApiKeyResult,
    DeletionResponse,
    DeletionResult,
    Permission,
    RotateApiKeyResult,
    UpdateApiKeyInput,
} from '@vendure/common/lib/generated-types';
import { ID, PaginatedList } from '@vendure/common/lib/shared-types';
import { unique } from '@vendure/common/lib/unique';
import { In, IsNull, SelectQueryBuilder, UpdateResult } from 'typeorm';

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
import { AuthenticationMethod, Role, User } from '../../entity';
import { ApiKeyTranslation } from '../../entity/api-key/api-key-translation.entity';
import { ApiKey } from '../../entity/api-key/api-key.entity';
import { EventBus } from '../../event-bus';
import { ApiKeyEvent } from '../../event-bus/events/api-key-event';
import { CustomFieldRelationService } from '../helpers/custom-field-relation/custom-field-relation.service';
import { ListQueryBuilder } from '../helpers/list-query-builder/list-query-builder';
import { TranslatableSaver } from '../helpers/translatable-saver/translatable-saver';
import { TranslatorService } from '../helpers/translator/translator.service';

import { ChannelService } from './channel.service';
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
     * Checks that the active user holds every Permission of the specified Roles, using the shared
     * {@link RoleService.activeUserHasPermissionsOfRoles} rule so this and {@link AdministratorService}
     * enforce it in one place. The Roles are either those being granted to an API-Key's User or those
     * its User currently holds. Returns the loaded Roles (with their Channels) for callers that assign
     * them to the API-Key's User.
     *
     * @throws {UserInputError} If the active User has insufficient permissions
     * @returns Role-Entities with relations to Channels
     */
    private async assertActiveUserHasPermissionsOfRoles(ctx: RequestContext, roleIds: ID[]): Promise<Role[]> {
        if (!(await this.roleService.activeUserHasPermissionsOfRoles(ctx, roleIds))) {
            throw new UserInputError('error.active-user-does-not-have-sufficient-permissions');
        }
        if (roleIds.length === 0) {
            return [];
        }
        return this.connection.getRepository(ctx, Role).find({
            where: { id: In(roleIds) },
            relations: { channels: true },
        });
    }

    /**
     * @description
     * Loads an API-Key in the active Channel, with its User's Roles and their Channels, if the active
     * User may manage it: they must hold every Permission of the key's User. A key they may not manage
     * throws the same error as a key which does not exist, since {@link ApiKeyService.findOne} hides it
     * and a different error would disclose that it exists. (GHSA-37xp-mjp8-6f9x)
     *
     * @throws {EntityNotFoundError} If the API-Key does not exist or the active User may not manage it
     */
    private async getManageableApiKeyOrThrow(ctx: RequestContext, id: ID): Promise<ApiKey> {
        const entity = await this.connection.getEntityOrThrow(ctx, ApiKey, id, {
            channelId: ctx.channelId,
            includeSoftDeleted: false,
            relations: { user: { roles: { channels: true } } },
        });
        const canManage = await this.roleService.activeUserHasPermissionsOfRoles(
            ctx,
            entity.user.roles.map(role => role.id),
        );
        if (!canManage) {
            throw new EntityNotFoundError('ApiKey', id);
        }
        return entity;
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
        const roles = await this.assertActiveUserHasPermissionsOfRoles(ctx, input.roleIds);

        const ownerUser = await this.connection.getEntityOrThrow(ctx, User, userIdOwner);
        const apiType = this.getApiTypeForNewApiKey(ctx);
        const strategy = this.getApiKeyStrategyByApiType(apiType);
        const lookupId = await strategy.generateLookupId(ctx);
        const apiKeyUser = userIdApiKeyUser
            ? await this.connection.getEntityOrThrow(ctx, User, userIdApiKeyUser, {
                  // ApiKeyUsers generally require roles and their channels, its important for sessions!
                  relations: { roles: { channels: true } },
              })
            : await this.userService.createApiKeyUser(
                  ctx,
                  roles,
                  this.generateApiKeyUserIdentifier(lookupId),
              );

        if (userIdApiKeyUser) {
            // The session binds to this existing User, whose Roles may exceed the caller's, so the
            // returned secret would be a credential more powerful than the caller. Guard the
            // impersonation path the same way rotate/update/softDelete do. The other branch builds a
            // User from `roles`, already checked above. (GHSA-37xp-mjp8-6f9x)
            await this.assertActiveUserHasPermissionsOfRoles(
                ctx,
                apiKeyUser.roles.map(role => role.id),
            );
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
        // The caller must already hold every Permission the key's user holds before they may modify
        // the key. Without this an Administrator holding only UpdateApiKey could rename a
        // higher-privileged key or strip its roles. The incoming-roleIds check below additionally
        // stops them raising a key's power.
        const entity = await this.getManageableApiKeyOrThrow(ctx, input.id);

        if (input.roleIds) {
            entity.user.roles = await this.assertActiveUserHasPermissionsOfRoles(ctx, input.roleIds);
        }

        const apiKey = await this.translatableSaver.update({
            ctx,
            input,
            entityType: ApiKey,
            translationType: ApiKeyTranslation,
            beforeSave: async () => {
                // Keep in mind that if the user of the ApiKey is being impersonated,
                // this would change the roles of the impersonated user!
                if (input.roleIds) {
                    await this.connection.getRepository(ctx, User).save(entity.user, { reload: false });
                }
            },
        });
        await this.customFieldRelationService.updateRelations(ctx, ApiKey, input, apiKey);

        Logger.verbose(`Updated ApiKey (${apiKey.id}) by User (${String(ctx.activeUserId)})`);
        await this.eventBus.publish(new ApiKeyEvent(ctx, apiKey, 'updated', input));

        return assertFound(this.findOne(ctx, input.id, relations));
    }

    /**
     * @description
     * Soft-Deletes an API-Key and removes its session. Is Channel-Aware.
     *
     * @throws {EntityNotFoundError} If API-Key cannot be found, or the active User does not hold every
     * Permission granted by the key's User
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
     * @throws {EntityNotFoundError} If API-Key cannot be found, or the active User does not hold every
     * Permission granted by the key's User
     */
    async rotate(ctx: RequestContext, id: ID): Promise<RotateApiKeyResult> {
        // The rotated secret authenticates as the key's underlying User, whose Roles may exceed the
        // caller's. Without this check an Administrator holding only UpdateApiKey could rotate a
        // higher-privileged key and receive a working credential for it. Runs before any mutation,
        // so a rejected rotate leaves the existing secret intact. The Roles and their Channels are
        // also needed for the new session.
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
            // The User's Roles are always loaded, since the visibility check is based on them.
            relations: unique([...(relations ?? []), 'user', 'user.roles']),
            where: { deletedAt: IsNull() },
        });
        if (!entity) return null;
        // Hide a key the caller could not manage, so its metadata is not disclosed by id lookup to an
        // Administrator who does not hold the key's permissions. Same rule as the mutations, so the read
        // and write policies cannot drift apart. (GHSA-37xp-mjp8-6f9x)
        const visible = await this.roleService.activeUserHasPermissionsOfRoles(
            ctx,
            entity.user.roles.map(role => role.id),
        );
        if (!visible) return null;
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
        // Restrict to keys the caller may manage, applied to the query so pagination and totalItems
        // stay correct. (GHSA-37xp-mjp8-6f9x)
        await this.restrictToVisibleApiKeys(ctx, qb);
        const [keys, totalItems] = await qb.getManyAndCount();
        const items = keys.map(key => this.translator.translate(key, ctx));
        return { items, totalItems };
    }

    /**
     * Restricts a list query to the API-Keys visible to the active user, by the same
     * {@link RoleService.activeUserHasPermissionsOfRoles} rule that gates the mutations. Applied to the
     * query rather than its result, so totalItems, sorting, filtering and pagination all operate over
     * the visible keys only. Mirrors {@link AdministratorService}'s administrator visibility.
     */
    private async restrictToVisibleApiKeys(ctx: RequestContext, qb: SelectQueryBuilder<ApiKey>) {
        // A SuperAdmin sees every key; getVisibleRoleIds() returns every Role id for them, so the
        // sub-query would exclude nobody. This early return only saves the query.
        if (ctx.userHasPermissions([Permission.SuperAdmin])) {
            return;
        }
        const visibleRoleIds = await this.roleService.getVisibleRoleIds(ctx);
        // A key is excluded as soon as its User holds a single Role the active user cannot read. A
        // sub-query is used rather than a join, so the key rows are not duplicated by the relations.
        qb.andWhere(outerQb => {
            const hiddenApiKeysQuery = outerQb
                .subQuery()
                .select('visibility_api_key.id')
                .from(ApiKey, 'visibility_api_key')
                .innerJoin('visibility_api_key.user', 'visibility_user')
                .innerJoin('visibility_user.roles', 'visibility_role');
            // With no visible Roles, every Role is hidden, so no condition is needed on the Role.
            if (visibleRoleIds.length) {
                hiddenApiKeysQuery.where('visibility_role.id NOT IN (:...visibleRoleIds)', {
                    visibleRoleIds,
                });
            }
            const apiKeyId = `${outerQb.escape(outerQb.alias)}.${outerQb.escape('id')}`;
            return `${apiKeyId} NOT IN ${hiddenApiKeysQuery.getQuery()}`;
        });
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
