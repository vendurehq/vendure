import { Injectable } from '@nestjs/common';
import {
    CreateApiKeyInput,
    CreateApiKeyResult,
    DeletionResponse,
    DeletionResult,
    RotateApiKeyResult,
    UpdateApiKeyInput,
} from '@vendure/common/lib/generated-types';
import { ID, PaginatedList } from '@vendure/common/lib/shared-types';
import { In, IsNull, UpdateResult } from 'typeorm';

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
import { AuthenticationMethod, Role, User } from '../../entity';
import { ApiKeyTranslation } from '../../entity/api-key/api-key-translation.entity';
import { ApiKey } from '../../entity/api-key/api-key.entity';
import { EventBus } from '../../event-bus';
import { ApiKeyEvent } from '../../event-bus/events/api-key-event';
import { CustomFieldRelationService } from '../helpers/custom-field-relation/custom-field-relation.service';
import { ListQueryBuilder } from '../helpers/list-query-builder/list-query-builder';
import { TranslatableSaver } from '../helpers/translatable-saver/translatable-saver';
import { TranslatorService } from '../helpers/translator/translator.service';
import { getChannelPermissions } from '../helpers/utils/get-user-channels-permissions';

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
     * @description
     * Checks that the active user is allowed to grant the specified Roles for an API-Key
     *
     * // TODO this is taken & slightly modified from adminservice, could merge to not repeat logic
     *
     * @throws {UserInputError} If the active User has insufficient permissions
     * @returns Role-Entities with relations to Channels
     */
    private async assertActiveUserCanGrantRoles(ctx: RequestContext, roleIds: ID[]): Promise<Role[]> {
        if (roleIds.length === 0) return [];

        const roles = await this.connection.getRepository(ctx, Role).find({
            where: { id: In(roleIds) },
            relations: { channels: true },
        });
        const permissionsRequired = getChannelPermissions(roles);
        for (const channelPermissions of permissionsRequired) {
            const isAllowed = await this.roleService.userHasAllPermissionsOnChannel(
                ctx,
                channelPermissions.id,
                channelPermissions.permissions,
            );

            if (!isAllowed)
                throw new UserInputError('error.active-user-does-not-have-sufficient-permissions');
        }

        return roles;
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
        const roles = await this.assertActiveUserCanGrantRoles(ctx, input.roleIds);

        const ownerUser = await this.connection.getEntityOrThrow(ctx, User, userIdOwner);
        const strategy = this.getApiKeyStrategyByApiType(ctx.apiType);
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
                await this.channelService.assignToCurrentChannel(e, ctx);
            },
        });

        await this.customFieldRelationService.updateRelations(ctx, ApiKey, input, newEntity);

        // Important: The hash becomes the session token, this is what allows us to authorize on a per-request basis
        // Important: The User of the session may be new User to allow configuring separate permissions
        await this.sessionService.createNewAuthenticatedSession(
            ctx,
            apiKeyUser,
            API_KEY_AUTH_STRATEGY_NAME,
            hash,
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
        const entity = await this.connection.getEntityOrThrow(ctx, ApiKey, input.id, {
            channelId: ctx.channelId,
            relations: ['user'],
        });

        if (input.roleIds) {
            entity.user.roles = await this.assertActiveUserCanGrantRoles(ctx, input.roleIds);
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
     * @throws {EntityNotFoundError} If API-Key cannot be found
     */
    async softDelete(ctx: RequestContext, id: ID): Promise<DeletionResponse> {
        const apiKey = await this.connection.getEntityOrThrow(ctx, ApiKey, id, {
            channelId: ctx.channelId,
        });

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
     * @throws {EntityNotFoundError} If API-Key cannot be found
     */
    async rotate(ctx: RequestContext, id: ID): Promise<RotateApiKeyResult> {
        const entity = await this.connection.getEntityOrThrow(ctx, ApiKey, id, {
            channelId: ctx.channelId,
            includeSoftDeleted: false,
            // Need roles and channels for session
            relations: { user: { roles: { channels: true } } },
        });

        const strategy = this.getApiKeyStrategyByApiType(ctx.apiType);
        const secret = await strategy.generateSecret(ctx);
        const apiKey = strategy.constructApiKey(entity.lookupId, secret);
        const hash = await strategy.hashingStrategy.hash(apiKey);

        await this.sessionService.deleteApiKeySession(ctx, entity);
        await this.sessionService.createNewAuthenticatedSession(
            ctx,
            entity.user,
            API_KEY_AUTH_STRATEGY_NAME,
            hash,
        );

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
        return this.listQueryBuilder
            .build(ApiKey, options, {
                ctx,
                relations,
                channelId: ctx.channelId,
                where: { deletedAt: IsNull() },
            })
            .getManyAndCount()
            .then(([notifications, totalItems]) => {
                const items = notifications.map(n => this.translator.translate(n, ctx));
                return { items, totalItems };
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
            relations: [...(relations ?? []), 'channels'],
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
