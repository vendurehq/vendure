import { Injectable } from '@nestjs/common';
import {
    CreateChannelInput,
    CreateChannelResult,
    CurrencyCode,
    DeletionResponse,
    DeletionResult,
    Permission,
    UpdateChannelInput,
    UpdateChannelResult,
} from '@vendure/common/lib/generated-types';
import {
    CUSTOMER_ROLE_CODE,
    DEFAULT_CHANNEL_CODE,
    SUPER_ADMIN_ROLE_CODE,
} from '@vendure/common/lib/shared-constants';
import { ID, PaginatedList, Type } from '@vendure/common/lib/shared-types';
import { unique } from '@vendure/common/lib/unique';
import { EntityManager, FindOptionsWhere, Repository } from 'typeorm';

import { RelationPaths } from '../../api';
import { RequestContext } from '../../api/common/request-context';
import { TRANSACTION_MANAGER_KEY } from '../../common/constants';
import { ErrorResultUnion, isGraphQlErrorResult } from '../../common/error/error-result';
import {
    ChannelNotFoundError,
    EntityNotFoundError,
    ForbiddenError,
    InternalServerError,
    UserInputError,
} from '../../common/error/errors';
import { LanguageNotAvailableError } from '../../common/error/generated-graphql-admin-errors';
import { Instrument } from '../../common/instrument-decorator';
import { ChannelAware, ListQueryOptions } from '../../common/types/common-types';
import { assertFound, idsAreEqual } from '../../common/utils';
import { ConfigService } from '../../config/config.service';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { VendureEntity } from '../../entity/base/base.entity';
import { Channel } from '../../entity/channel/channel.entity';
import { Order } from '../../entity/order/order.entity';
import { ProductVariantPrice } from '../../entity/product-variant/product-variant-price.entity';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';
import { Role } from '../../entity/role/role.entity';
import { Seller } from '../../entity/seller/seller.entity';
import { Session } from '../../entity/session/session.entity';
import { Zone } from '../../entity/zone/zone.entity';
import { EventBus } from '../../event-bus';
import { ChangeChannelEvent } from '../../event-bus/events/change-channel-event';
import { ChannelEvent } from '../../event-bus/events/channel-event';
import { CustomFieldRelationService } from '../helpers/custom-field-relation/custom-field-relation.service';
import { ListQueryBuilder } from '../helpers/list-query-builder/list-query-builder';
import { isChannelAwareMetadata } from '../helpers/utils/is-channel-aware-metadata';
import { patchEntity } from '../helpers/utils/patch-entity';

import { GlobalSettingsService } from './global-settings.service';

const TOKEN_CACHE_SIZE = 10_000;
const MISS_CACHE_SIZE = 1_000;

type CacheEntry<T> = { value: Promise<T>; expires: number };

/**
 * @description
 * Contains methods relating to {@link Channel} entities.
 *
 * @docsCategory services
 */
@Injectable()
@Instrument()
export class ChannelService {
    /**
     * Channels are looked up on every request, so lookups by token, the default Channel and the
     * Channel count are cached per process. Promises are cached so that concurrent misses share
     * one query. Once resolved, unknown tokens move to a smaller cache of their own, so that a
     * flood of them cannot evict the count or the default Channel, and can only evict known tokens
     * while their query is in flight.
     */
    private countCache = new Map<string, CacheEntry<number>>();
    private defaultChannelCache = new Map<string, CacheEntry<Channel | undefined>>();
    private tokenCache = new Map<string, CacheEntry<Channel | undefined>>();
    private missCache = new Map<string, CacheEntry<Channel | undefined>>();
    /**
     * Transactions which have created, updated or deleted a Channel. They skip the cache entirely
     * until they end, because other requests may refill it from the committed data in the meantime.
     */
    private channelWriters = new WeakSet<EntityManager>();

    constructor(
        private connection: TransactionalConnection,
        private configService: ConfigService,
        private globalSettingsService: GlobalSettingsService,
        private customFieldRelationService: CustomFieldRelationService,
        private eventBus: EventBus,
        private listQueryBuilder: ListQueryBuilder,
    ) {
        // The caches are also cleared synchronously in create, update and delete, but that happens
        // before the transaction commits. Events are published after the commit, so clearing again
        // here drops anything another request cached from the old data in the meantime.
        this.eventBus.ofType(ChannelEvent).subscribe(() => this.clearCache());
    }

    /**
     * When the app is bootstrapped, ensure a default Channel exists.
     *
     * @internal
     */
    async initChannels() {
        await this.ensureDefaultChannelExists();
    }

    /**
     * @description
     * Assigns a ChannelAware entity to the default Channel as well as any channel
     * specified in the RequestContext. This method will not save the entity to the database, but
     * assigns the `channels` property of the entity.
     */
    async assignToCurrentChannel<T extends ChannelAware & VendureEntity>(
        entity: T,
        ctx: RequestContext,
    ): Promise<T> {
        const defaultChannel = await this.getDefaultChannel(ctx);
        const channelIds = unique([ctx.channelId, defaultChannel.id]);
        entity.channels = channelIds.map(id => ({ id })) as any;
        await this.eventBus.publish(new ChangeChannelEvent(ctx, entity, [ctx.channelId], 'assigned'));
        return entity;
    }

    /**
     * This method is used to bypass a bug with Typeorm when working with ManyToMany relationships.
     * For some reason, a regular query does not return all the channels that an entity has.
     * This is a most optimized way to get all the channels that an entity has.
     *
     * @param ctx - The RequestContext object.
     * @param entityType - The type of the entity.
     * @param entityId - The ID of the entity.
     * @returns A promise that resolves to an array of objects, each containing a channel ID.
     * @private
     */
    private async getAssignedEntityChannels<T extends ChannelAware & VendureEntity>(
        ctx: RequestContext,
        entityType: Type<T>,
        entityId: T['id'],
    ): Promise<Array<{ channelId: ID }>> {
        const repository = this.connection.getRepository(ctx, entityType);

        const metadata = repository.metadata;
        const channelsRelation = metadata.findRelationWithPropertyPath('channels');

        if (!channelsRelation) {
            throw new InternalServerError(`Could not find the channels relation for entity ${metadata.name}`);
        }

        const junctionTableName = channelsRelation.junctionEntityMetadata?.tableName;
        const junctionColumnName = channelsRelation.junctionEntityMetadata?.columns[0].databaseName;
        const inverseJunctionColumnName =
            channelsRelation.junctionEntityMetadata?.inverseColumns[0].databaseName;

        if (!junctionTableName || !junctionColumnName || !inverseJunctionColumnName) {
            throw new InternalServerError(
                `Could not find necessary join table information for the channels relation of entity ${metadata.name}`,
            );
        }

        return await this.connection
            .getRepository(ctx, entityType)
            .manager.createQueryBuilder()
            .select(`channel.${inverseJunctionColumnName}`, 'channelId')
            .from(junctionTableName, 'channel')
            .where(`channel.${junctionColumnName} = :entityId`, { entityId })
            .execute();
    }

    /**
     * @description
     * Assigns the entity to the given Channels and saves all changes to the database.
     */
    async assignToChannels<T extends ChannelAware & VendureEntity>(
        ctx: RequestContext,
        entityType: Type<T>,
        entityId: ID,
        channelIds: ID[],
    ): Promise<T> {
        const relations = [];
        // This is a work-around for https://github.com/vendurehq/vendure/issues/1391
        // A better API would be to allow the consumer of this method to supply an entity instance
        // so that this join could be done prior to invoking this method.
        // TODO: overload the assignToChannels method to allow it to take an entity instance
        if (entityType === (Order as any)) {
            relations.push('lines', 'shippingLines', 'surcharges');
        }
        const entity = await this.connection.getEntityOrThrow(ctx, entityType, entityId, {
            loadEagerRelations: false,
            relationLoadStrategy: 'query',
            where: {
                id: entityId,
            } as FindOptionsWhere<T>,
            relations,
        });
        const assignedChannels = await this.getAssignedEntityChannels(ctx, entityType, entityId);

        const newChannelIds = channelIds.filter(
            id => !assignedChannels.some(ec => idsAreEqual(ec.channelId, id)),
        );

        if (!newChannelIds.length) {
            return entity;
        }

        await this.connection
            .getRepository(ctx, entityType)
            .createQueryBuilder()
            .relation('channels')
            .of(entity.id)
            .add(newChannelIds);

        await this.eventBus.publish(
            new ChangeChannelEvent(ctx, entity, newChannelIds, 'assigned', entityType),
        );
        return entity;
    }

    /**
     * @description
     * Removes the entity from the given Channels and saves.
     */
    async removeFromChannels<T extends ChannelAware & VendureEntity>(
        ctx: RequestContext,
        entityType: Type<T>,
        entityId: ID,
        channelIds: ID[],
    ): Promise<T | undefined> {
        const entity = await this.connection.getRepository(ctx, entityType).findOne({
            loadEagerRelations: false,
            relationLoadStrategy: 'query',
            where: {
                id: entityId,
            } as FindOptionsWhere<T>,
        });
        if (!entity) {
            return;
        }
        const assignedChannels = await this.getAssignedEntityChannels(ctx, entityType, entityId);

        const existingChannelIds = channelIds.filter(id =>
            assignedChannels.some(ec => idsAreEqual(ec.channelId, id)),
        );

        if (!existingChannelIds.length) {
            return;
        }
        await this.connection
            .getRepository(ctx, entityType)
            .createQueryBuilder()
            .relation('channels')
            .of(entity.id)
            .remove(existingChannelIds);
        await this.eventBus.publish(
            new ChangeChannelEvent(ctx, entity, existingChannelIds, 'removed', entityType),
        );
        return entity;
    }

    /**
     * @description
     * Given a channel token, returns the corresponding Channel if it exists, else will throw
     * a {@link ChannelNotFoundError}.
     */
    async getChannelFromToken(token: string): Promise<Channel>;
    async getChannelFromToken(ctx: RequestContext, token: string): Promise<Channel>;
    async getChannelFromToken(ctxOrToken: RequestContext | string, token?: string): Promise<Channel> {
        const [ctx, channelToken] =
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            ctxOrToken instanceof RequestContext ? [ctxOrToken, token!] : [undefined, ctxOrToken];

        const channelCount = await this.cached(ctx, this.countCache, 'count', repository =>
            repository.count(),
        );
        if (channelCount === 1 || channelToken === '') {
            // there is only the default channel, so return it
            return this.getDefaultChannel(ctx);
        }
        // Misses are cached too, so unknown tokens do not query the database on every request
        const channel = await this.cached(
            ctx,
            this.tokenCache,
            channelToken,
            repository => this.findChannel(repository, { token: channelToken }),
            { maxSize: TOKEN_CACHE_SIZE, missCache: this.missCache },
        );
        if (!channel) {
            throw new ChannelNotFoundError(channelToken);
        }
        return channel;
    }

    /**
     * @description
     * Returns the default Channel.
     */
    async getDefaultChannel(ctx?: RequestContext): Promise<Channel> {
        const defaultChannel = await this.cached(ctx, this.defaultChannelCache, 'default', repository =>
            this.findChannel(repository, { code: DEFAULT_CHANNEL_CODE }),
        );

        if (!defaultChannel) {
            throw new InternalServerError('error.default-channel-not-found');
        }
        return defaultChannel;
    }

    findAll(
        ctx: RequestContext,
        options?: ListQueryOptions<Channel>,
        relations?: RelationPaths<Channel>,
    ): Promise<PaginatedList<Channel>> {
        return this.listQueryBuilder
            .build(Channel, options, {
                relations: relations ?? ['defaultShippingZone', 'defaultTaxZone'],
                ctx,
            })
            .getManyAndCount()
            .then(([items, totalItems]) => ({
                items,
                totalItems,
            }));
    }

    findOne(ctx: RequestContext, id: ID): Promise<Channel | undefined> {
        return this.connection
            .getRepository(ctx, Channel)
            .findOne({ where: { id }, relations: ['defaultShippingZone', 'defaultTaxZone'] })
            .then(result => result ?? undefined);
    }

    async create(
        ctx: RequestContext,
        input: CreateChannelInput,
    ): Promise<ErrorResultUnion<CreateChannelResult, Channel>> {
        const defaultCurrencyCode = input.defaultCurrencyCode || input.currencyCode;
        if (!defaultCurrencyCode) {
            throw new UserInputError('Either a defaultCurrencyCode or currencyCode must be provided');
        }
        const channel = new Channel({
            ...input,
            defaultCurrencyCode,
            availableCurrencyCodes:
                input.availableCurrencyCodes ?? (defaultCurrencyCode ? [defaultCurrencyCode] : []),
            availableLanguageCodes: input.availableLanguageCodes ?? [input.defaultLanguageCode],
        });
        const defaultLanguageValidationResult = await this.validateDefaultLanguageCode(ctx, input);
        if (isGraphQlErrorResult(defaultLanguageValidationResult)) {
            return defaultLanguageValidationResult;
        }
        if (input.defaultTaxZoneId) {
            channel.defaultTaxZone = await this.connection.getEntityOrThrow(
                ctx,
                Zone,
                input.defaultTaxZoneId,
            );
        }
        if (input.defaultShippingZoneId) {
            channel.defaultShippingZone = await this.connection.getEntityOrThrow(
                ctx,
                Zone,
                input.defaultShippingZoneId,
            );
        }
        const newChannel = await this.connection.getRepository(ctx, Channel).save(channel);
        if (input.sellerId) {
            const seller = await this.connection.getEntityOrThrow(ctx, Seller, input.sellerId);
            newChannel.seller = seller;
            await this.connection.getRepository(ctx, Channel).save(newChannel);
        }
        await this.customFieldRelationService.updateRelations(ctx, Channel, input, newChannel);
        this.clearCache(ctx);
        await this.assignDefaultRolesToChannel(ctx, newChannel.id);
        await this.eventBus.publish(new ChannelEvent(ctx, newChannel, 'created', input));
        return newChannel;
    }

    /**
     * @description
     * Updates a Channel. Throws a ForbiddenError if the active user does not hold the
     * `UpdateChannel` permission on the target Channel. A SuperAdmin is exempt. A RequestContext
     * with no session skips the check.
     */
    async update(
        ctx: RequestContext,
        input: UpdateChannelInput,
    ): Promise<ErrorResultUnion<UpdateChannelResult, Channel>> {
        this.assertHasPermissionOnChannel(ctx, input.id, Permission.UpdateChannel);
        const channel = await this.findOne(ctx, input.id);
        if (!channel) {
            throw new EntityNotFoundError('Channel', input.id);
        }
        const originalDefaultCurrencyCode = channel.defaultCurrencyCode;
        const defaultLanguageValidationResult = await this.validateDefaultLanguageCode(ctx, input);
        if (isGraphQlErrorResult(defaultLanguageValidationResult)) {
            return defaultLanguageValidationResult;
        }
        const updatedChannel = patchEntity(channel, input);
        if (input.defaultTaxZoneId) {
            updatedChannel.defaultTaxZone = await this.connection.getEntityOrThrow(
                ctx,
                Zone,
                input.defaultTaxZoneId,
            );
        }
        if (input.defaultShippingZoneId) {
            updatedChannel.defaultShippingZone = await this.connection.getEntityOrThrow(
                ctx,
                Zone,
                input.defaultShippingZoneId,
            );
        }
        if (input.sellerId) {
            const seller = await this.connection.getEntityOrThrow(ctx, Seller, input.sellerId);
            updatedChannel.seller = seller;
        }
        if (input.currencyCode) {
            updatedChannel.defaultCurrencyCode = input.currencyCode;
        }
        if (input.currencyCode || input.defaultCurrencyCode) {
            const newCurrencyCode = input.defaultCurrencyCode || input.currencyCode;
            updatedChannel.availableCurrencyCodes = unique([
                ...updatedChannel.availableCurrencyCodes,
                updatedChannel.defaultCurrencyCode,
            ]);
            if (originalDefaultCurrencyCode !== newCurrencyCode) {
                // When updating the default currency code for a Channel, we also need to update
                // and ProductVariantPrices in that channel which use the old currency code.
                const [selectQbQuery, selectQbParams] = this.connection
                    .getRepository(ctx, ProductVariant)
                    .createQueryBuilder('variant')
                    .select('variant.id', 'id')
                    .innerJoin(ProductVariantPrice, 'pvp', 'pvp.variantId = variant.id')
                    .andWhere('pvp.channelId = :channelId')
                    .andWhere('pvp.currencyCode = :newCurrencyCode')
                    .groupBy('variant.id')
                    .getQueryAndParameters();

                const qb = this.connection
                    .getRepository(ctx, ProductVariantPrice)
                    .createQueryBuilder('pvp')
                    .update()
                    .where('channelId = :channelId')
                    .andWhere('currencyCode = :oldCurrencyCode')
                    .set({ currencyCode: newCurrencyCode })
                    .setParameters({
                        channelId: channel.id,
                        oldCurrencyCode: originalDefaultCurrencyCode,
                        newCurrencyCode,
                    });

                if (this.connection.rawConnection.options.type === 'mysql') {
                    // MySQL does not support sub-queries joining the table that is being updated,
                    // it will cause a "You can't specify target table 'product_variant_price' for update in FROM clause" error.
                    // This is a work-around from https://stackoverflow.com/a/9843719/772859
                    qb.andWhere(
                        `variantId NOT IN (SELECT id FROM (${selectQbQuery}) as temp)`,
                        selectQbParams,
                    );
                } else {
                    qb.andWhere(`variantId NOT IN (${selectQbQuery})`, selectQbParams);
                }
                await qb.execute();
            }
        }
        if (
            input.availableCurrencyCodes &&
            !updatedChannel.availableCurrencyCodes.includes(updatedChannel.defaultCurrencyCode)
        ) {
            throw new UserInputError(`error.available-currency-codes-must-include-default`, {
                defaultCurrencyCode: updatedChannel.defaultCurrencyCode,
            });
        }
        await this.connection.getRepository(ctx, Channel).save(updatedChannel, { reload: false });
        await this.customFieldRelationService.updateRelations(ctx, Channel, input, updatedChannel);
        this.clearCache(ctx);
        await this.eventBus.publish(new ChannelEvent(ctx, channel, 'updated', input));
        return assertFound(this.findOne(ctx, channel.id));
    }

    /**
     * @description
     * Deletes a Channel. Throws a ForbiddenError if the active user does not hold the
     * `DeleteChannel` permission on the target Channel. A SuperAdmin is exempt. A RequestContext
     * with no session skips the check.
     */
    async delete(ctx: RequestContext, id: ID): Promise<DeletionResponse> {
        this.assertHasPermissionOnChannel(ctx, id, Permission.DeleteChannel);
        const channel = await this.connection.getEntityOrThrow(ctx, Channel, id);
        if (channel.code === DEFAULT_CHANNEL_CODE)
            return {
                result: DeletionResult.NOT_DELETED,
                message: ctx.translate('error.cannot-delete-default-channel'),
            };

        const deletedChannel = new Channel(channel);
        await this.connection.getRepository(ctx, Session).delete({ activeChannelId: id });
        await this.connection.getRepository(ctx, Channel).delete(id);
        await this.connection.getRepository(ctx, ProductVariantPrice).delete({
            channelId: id,
        });
        this.clearCache(ctx);
        await this.eventBus.publish(new ChannelEvent(ctx, deletedChannel, 'deleted', id));

        return {
            result: DeletionResult.DELETED,
        };
    }

    /**
     * A Channel may only be modified by a user who holds the required permission on that particular
     * Channel, see GHSA-22x4-937q-5fr5.
     *
     * A SuperAdmin is exempt, because the SuperAdmin permission is global. We check it against the
     * active Channel rather than the target Channel, since a Channel created programmatically via
     * ChannelService.create() does not necessarily have the SuperAdmin Role assigned to it.
     *
     * A RequestContext with no session is skipped, because it belongs to an internal server-side
     * call such as Populator.setChannelDefaults(), which calls update() with RequestContext.empty().
     * With the default AuthGuard an unauthenticated API request cannot reach this point. Note that
     * the skip fails open: a custom EntityAccessControlStrategy which admits sessionless requests
     * would bypass this check.
     */
    private assertHasPermissionOnChannel(ctx: RequestContext, channelId: ID, permission: Permission) {
        if (!ctx.session?.user) {
            return;
        }
        if (ctx.userHasPermissions([Permission.SuperAdmin])) {
            return;
        }
        if (!ctx.userHasPermissions([permission], channelId)) {
            throw new ForbiddenError();
        }
    }

    /**
     * @description
     * Type guard method which returns true if the given entity is an
     * instance of a class which implements the {@link ChannelAware} interface.
     */
    public isChannelAware(entity: VendureEntity): entity is VendureEntity & ChannelAware {
        const entityType = Object.getPrototypeOf(entity).constructor;
        return isChannelAwareMetadata(this.connection.rawConnection.getMetadata(entityType));
    }

    private findChannel(
        repository: Repository<Channel>,
        where: FindOptionsWhere<Channel>,
    ): Promise<Channel | undefined> {
        return repository
            .findOne({ where, relations: { defaultShippingZone: true, defaultTaxZone: true } })
            .then(result => result ?? undefined);
    }

    /**
     * Cached entries are shared by every request in the process, so they are loaded outside of
     * any transaction. A caller inside a transaction still uses a cached Channel, but on a miss it
     * loads through its own transaction and does not store the result, so it does not need a second
     * pool connection while holding one. Resolved misses are ignored inside a transaction. A
     * transaction which has written a Channel skips the cache entirely, so it always sees its own
     * writes and never shares them with other requests.
     *
     * Loads go to the repository directly rather than through `TransactionalConnection.getRepository(ctx)`,
     * because resolving a Channel is not subject to the {@link EntityAccessControlStrategy}, and
     * the result must not depend on whether the cache was warm. They also read from the master,
     * so that replica lag right after a write is not cached for the whole TTL.
     */
    private cached<T>(
        ctx: RequestContext | undefined,
        cache: Map<string, CacheEntry<T>>,
        key: string,
        load: (repository: Repository<Channel>) => Promise<T>,
        options: { maxSize?: number; missCache?: Map<string, CacheEntry<T>> } = {},
    ): Promise<T> {
        const { maxSize = Infinity, missCache } = options;
        const now = Date.now();
        const transactionManager: EntityManager | undefined = ctx && (ctx as any)[TRANSACTION_MANAGER_KEY];
        if (transactionManager) {
            const cachedHit = this.channelWriters.has(transactionManager) ? undefined : cache.get(key);
            return cachedHit && now < cachedHit.expires
                ? cachedHit.value
                : load(transactionManager.getRepository(Channel));
        }
        const hit = cache.get(key) ?? missCache?.get(key);
        if (hit && now < hit.expires) {
            return hit.value;
        }
        cache.delete(key);
        missCache?.delete(key);
        const entry = {
            value: this.loadFromMaster(load),
            expires: now + this.configService.entityOptions.channelCacheTtl,
        };
        this.setBounded(cache, key, entry, maxSize);
        entry.value.then(
            result => {
                if (missCache && result == null && cache.get(key) === entry) {
                    cache.delete(key);
                    this.setBounded(missCache, key, entry, MISS_CACHE_SIZE);
                }
            },
            () => {
                if (cache.get(key) === entry) {
                    cache.delete(key);
                }
            },
        );
        return entry.value;
    }

    private async loadFromMaster<T>(load: (repository: Repository<Channel>) => Promise<T>): Promise<T> {
        const queryRunner = this.connection.rawConnection.createQueryRunner('master');
        try {
            return await load(queryRunner.manager.getRepository(Channel));
        } finally {
            await queryRunner.release();
        }
    }

    private setBounded<V>(cache: Map<string, V>, key: string, value: V, maxSize: number) {
        if (cache.size >= maxSize) {
            // Evicts the oldest insertion rather than the least recently used entry
            cache.delete(cache.keys().next().value as string);
        }
        cache.set(key, value);
    }

    private clearCache(ctx?: RequestContext) {
        const transactionManager: EntityManager | undefined = ctx && (ctx as any)[TRANSACTION_MANAGER_KEY];
        if (transactionManager) {
            this.channelWriters.add(transactionManager);
        }
        this.countCache.clear();
        this.defaultChannelCache.clear();
        this.tokenCache.clear();
        this.missCache.clear();
    }

    /**
     * There must always be a default Channel. If none yet exists, this method creates one.
     * Also ensures the default Channel token matches the defaultChannelToken config setting.
     */
    private async ensureDefaultChannelExists() {
        const { defaultChannelToken } = this.configService;
        let defaultChannel = await this.connection.rawConnection.getRepository(Channel).findOne({
            where: {
                code: DEFAULT_CHANNEL_CODE,
            },
            relations: ['seller'],
        });

        if (!defaultChannel) {
            defaultChannel = new Channel({
                code: DEFAULT_CHANNEL_CODE,
                defaultLanguageCode: this.configService.defaultLanguageCode,
                availableLanguageCodes: [this.configService.defaultLanguageCode],
                pricesIncludeTax: false,
                defaultCurrencyCode: CurrencyCode.USD,
                availableCurrencyCodes: [CurrencyCode.USD],
                token: defaultChannelToken,
            });
        } else if (defaultChannelToken && defaultChannel.token !== defaultChannelToken) {
            defaultChannel.token = defaultChannelToken;
            await this.connection.rawConnection
                .getRepository(Channel)
                .save(defaultChannel, { reload: false });
        }
        if (!defaultChannel.seller) {
            const seller = await this.connection.rawConnection.getRepository(Seller).find();
            if (seller.length === 0) {
                throw new InternalServerError('No Sellers were found. Could not initialize default Channel.');
            }
            defaultChannel.seller = seller[0];
            await this.connection.rawConnection
                .getRepository(Channel)
                .save(defaultChannel, { reload: false });
        }
    }

    private async validateDefaultLanguageCode(
        ctx: RequestContext,
        input: CreateChannelInput | UpdateChannelInput,
    ): Promise<LanguageNotAvailableError | undefined> {
        if (input.defaultLanguageCode) {
            const availableLanguageCodes = await this.globalSettingsService
                .getSettings(ctx)
                .then(s => s.availableLanguages);
            if (!availableLanguageCodes.includes(input.defaultLanguageCode)) {
                return new LanguageNotAvailableError({ languageCode: input.defaultLanguageCode });
            }
        }
    }

    /**
     * Assigns the SuperAdmin and Customer roles to the given channel. Called
     * during channel creation to ensure that the SuperAdmin always has access
     * to all channels, and that customers can authenticate against them.
     */
    private async assignDefaultRolesToChannel(ctx: RequestContext, channelId: ID): Promise<void> {
        const superAdminRole = await this.connection.getRepository(ctx, Role).findOne({
            where: { code: SUPER_ADMIN_ROLE_CODE },
        });
        if (!superAdminRole) {
            throw new InternalServerError('error.super-admin-role-not-found');
        }
        const customerRole = await this.connection.getRepository(ctx, Role).findOne({
            where: { code: CUSTOMER_ROLE_CODE },
        });
        if (!customerRole) {
            throw new InternalServerError('error.customer-role-not-found');
        }
        await this.assignToChannels(ctx, Role, superAdminRole.id, [channelId]);
        await this.assignToChannels(ctx, Role, customerRole.id, [channelId]);
    }
}
