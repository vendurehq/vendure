import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { ID, Type } from '@vendure/common/lib/shared-types';
import {
    DataSource,
    EntityManager,
    EntitySchema,
    FindManyOptions,
    FindOneOptions,
    ObjectLiteral,
    ObjectType,
    ReplicationMode,
    Repository,
    SelectQueryBuilder,
} from 'typeorm';

import { RequestContext } from '../api/common/request-context';
import { TransactionIsolationLevel } from '../api/decorators/transaction.decorator';
import { TRANSACTION_MANAGER_KEY } from '../common/constants';
import { EntityNotFoundError } from '../common/error/errors';
import { ChannelAware, SoftDeletable } from '../common/types/common-types';
import { EntityAccessControlStrategy } from '../config/auth/entity-access-control-strategy';
import { ConfigService } from '../config/config.service';
import { isChannelScopedCustomField } from '../config/custom-field/custom-field-types';
import { VendureEntity } from '../entity/base/base.entity';
import {
    getChannelAssignmentEntities,
    LOADED_CHANNEL_ASSIGNMENT_PROPERTY,
} from '../entity/channel-assignment/channel-assignment-registry';
import {
    applyChannelCustomFields,
    persistChannelCustomFields,
} from '../entity/channel-assignment/channel-custom-fields';
import { joinTreeRelationsDynamically } from '../service/helpers/utils/tree-relations-qb-joiner';

import { findOptionsArrayToObject } from './find-options-array-to-object';
import { findOptionsObjectToArray } from './find-options-object-to-array';
import { toTypeOrmFindOptions } from './to-typeorm-find-options';
import { TransactionWrapper } from './transaction-wrapper';
import { GetEntityOrThrowOptions, VendureFindManyOptions, VendureFindOneOptions } from './types';

/**
 * Repository methods intercepted by the access control Proxy.
 * Hoisted to module level to avoid re-creating the Set on every getRepository() call.
 */
const ACCESS_CONTROL_INTERCEPTED_METHODS = new Set([
    'find',
    'findOne',
    'findOneOrFail',
    'findAndCount',
    'count',
]);

/**
 * SelectQueryBuilder terminal methods that execute SQL. When a QueryBuilder
 * is obtained via a Proxy-wrapped repository's `createQueryBuilder()`, these
 * methods are intercepted to apply access control before execution.
 */
const QB_TERMINAL_METHODS = new Set([
    'getMany',
    'getOne',
    'getOneOrFail',
    'getManyAndCount',
    'getCount',
    'getExists',
    'getRawMany',
    'getRawOne',
    'getRawAndEntities',
    'stream',
]);

/**
 * Repository read methods after which the channel-scoped custom fields of the loaded entities are
 * set on their `customFields` (see {@link applyChannelCustomFields}).
 */
const CHANNEL_CUSTOM_FIELDS_REPOSITORY_METHODS = new Set([
    'find',
    'findBy',
    'findOne',
    'findOneBy',
    'findOneOrFail',
    'findOneByOrFail',
    'findAndCount',
    'findAndCountBy',
]);

/**
 * SelectQueryBuilder methods which return entities, after which their channel-scoped custom fields
 * are set.
 */
const CHANNEL_CUSTOM_FIELDS_QB_METHODS = new Set([
    'getMany',
    'getOne',
    'getOneOrFail',
    'getManyAndCount',
    'getRawAndEntities',
]);

/**
 * @description
 * The TransactionalConnection is a wrapper around the TypeORM `Connection` object which works in conjunction
 * with the {@link Transaction} decorator to implement per-request transactions. All services which access the
 * database should use this class rather than the raw TypeORM connection, to ensure that db changes can be
 * easily wrapped in transactions when required.
 *
 * The service layer does not need to know about the scope of a transaction, as this is covered at the
 * API by the use of the `Transaction` decorator.
 *
 * @docsCategory data-access
 */
@Injectable()
export class TransactionalConnection {
    private hasChannelScopedCustomFields: boolean | undefined;
    private channelScopedEntities: Set<unknown> | undefined;

    constructor(
        @InjectDataSource() private dataSource: DataSource,
        private transactionWrapper: TransactionWrapper,
        private configService: ConfigService,
    ) {}

    /**
     * @description
     * The plain TypeORM Connection object. Should be used carefully as any operations
     * performed with this connection will not be performed within any outer
     * transactions.
     */
    get rawConnection(): DataSource {
        return this.dataSource;
    }

    /**
     * @description
     * Returns a TypeORM repository. Note that when no RequestContext is supplied, the repository will not
     * be aware of any existing transaction. Therefore, calling this method without supplying a RequestContext
     * is discouraged without a deliberate reason.
     *
     * @deprecated since 1.7.0: Use {@link TransactionalConnection.rawConnection rawConnection.getRepository()} function instead.
     */
    getRepository<Entity extends ObjectLiteral>(
        target: ObjectType<Entity> | EntitySchema<Entity> | string,
    ): Repository<Entity>;
    /**
     * @description
     * Returns a TypeORM repository which is bound to any existing transactions. It is recommended to _always_ pass
     * the RequestContext argument when possible, otherwise the queries will be executed outside of any
     * ongoing transactions which have been started by the {@link Transaction} decorator.
     *
     * The `options` parameter allows specifying additional configurations, such as the `replicationMode`,
     * which determines whether the repository should interact with the master or replica database.
     *
     * @param ctx - The RequestContext, which ensures the repository is aware of any existing transactions.
     * @param target - The entity type or schema for which the repository is returned.
     * @param options - Additional options for configuring the repository, such as the `replicationMode`.
     *
     * @returns A TypeORM repository for the specified entity type.
     */
    getRepository<Entity extends ObjectLiteral>(
        ctx: RequestContext | undefined,
        target: ObjectType<Entity> | EntitySchema<Entity> | string,
        options?: {
            replicationMode?: ReplicationMode;
        },
    ): Repository<Entity>;
    /**
     * @description
     * Returns a TypeORM repository. Depending on the parameters passed, it will either be transaction-aware
     * or not. If `RequestContext` is provided, the repository is bound to any ongoing transactions. The
     * `options` parameter allows further customization, such as selecting the replication mode (e.g., 'master').
     *
     * @param ctxOrTarget - Either the RequestContext, which binds the repository to ongoing transactions, or the entity type/schema.
     * @param maybeTarget - The entity type or schema for which the repository is returned (if `ctxOrTarget` is a RequestContext).
     * @param options - Additional options for configuring the repository, such as the `replicationMode`.
     *
     * @returns A TypeORM repository for the specified entity type.
     */
    getRepository<Entity extends ObjectLiteral>(
        ctxOrTarget: RequestContext | ObjectType<Entity> | EntitySchema<Entity> | string | undefined,
        maybeTarget?: ObjectType<Entity> | EntitySchema<Entity> | string,
        options?: {
            replicationMode?: ReplicationMode;
        },
    ): Repository<Entity> {
        if (ctxOrTarget instanceof RequestContext) {
            const transactionManager = this.getTransactionManager(ctxOrTarget);
            let repo: Repository<Entity>;
            if (transactionManager) {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                repo = transactionManager.getRepository(maybeTarget!);
            } else if (ctxOrTarget.replicationMode === 'master' || options?.replicationMode === 'master') {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                repo = this.dataSource.createQueryRunner('master').manager.getRepository(maybeTarget!);
            } else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                repo = this.rawConnection.getRepository(maybeTarget!);
            }
            const strategy = this.configService.authOptions.entityAccessControlStrategy;
            if (strategy?.applyAccessControl && maybeTarget && typeof maybeTarget === 'function') {
                repo = this.wrapWithAccessControl(repo, maybeTarget, ctxOrTarget, strategy);
            }
            if (this.readsChannelCustomFields(maybeTarget)) {
                repo = wrapWithChannelCustomFields(repo, ctxOrTarget, this.getChannelScopedEntities());
            }
            return repo;
        } else {
            if (options?.replicationMode === 'master') {
                /* eslint-disable @typescript-eslint/no-non-null-assertion */
                return this.dataSource
                    .createQueryRunner(options.replicationMode)
                    .manager.getRepository(maybeTarget!);
                /* eslint-enable @typescript-eslint/no-non-null-assertion */
            }
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            return this.rawConnection.getRepository(ctxOrTarget ?? maybeTarget!);
        }
    }

    /**
     * @description
     * Allows database operations to be wrapped in a transaction, ensuring that in the event of an error being
     * thrown at any point, the entire transaction will be rolled back and no changes will be saved.
     *
     * In the context of API requests, you should instead use the {@link Transaction} decorator on your resolver or
     * controller method.
     *
     * On the other hand, for code that does not run in the context of a GraphQL/REST request, this method
     * should be used to protect against non-atomic changes to the data which could leave your data in an
     * inconsistent state.
     *
     * Such situations include function processed by the JobQueue or stand-alone scripts which make use
     * of Vendure internal services.
     *
     * If there is already a {@link RequestContext} object available, you should pass it in as the first
     * argument in order to create transactional context as the copy. If not, omit the first argument and an empty
     * RequestContext object will be created, which is then used to propagate the transaction to
     * all inner method calls.
     *
     * @example
     * ```ts
     * private async transferCredit(outerCtx: RequestContext, fromId: ID, toId: ID, amount: number) {
     *   await this.connection.withTransaction(outerCtx, async ctx => {
     *     // Note you must not use `outerCtx` here, instead use `ctx`. Otherwise, this query
     *     // will be executed outside of transaction
     *     await this.giftCardService.updateCustomerCredit(ctx, fromId, -amount);
     *
     *     await this.connection.getRepository(ctx, GiftCard).update(fromId, { transferred: true })
     *
     *     // If some intermediate logic here throws an Error,
     *     // then all DB transactions will be rolled back and neither Customer's
     *     // credit balance will have changed.
     *
     *     await this.giftCardService.updateCustomerCredit(ctx, toId, amount);
     *   })
     * }
     * ```
     *
     * @since 1.3.0
     */
    async withTransaction<T>(work: (ctx: RequestContext) => Promise<T>): Promise<T>;
    async withTransaction<T>(ctx: RequestContext, work: (ctx: RequestContext) => Promise<T>): Promise<T>;
    async withTransaction<T>(
        ctxOrWork: RequestContext | ((ctx: RequestContext) => Promise<T>),
        maybeWork?: (ctx: RequestContext) => Promise<T>,
    ): Promise<T> {
        let ctx: RequestContext;
        let work: (ctx: RequestContext) => Promise<T>;
        if (ctxOrWork instanceof RequestContext) {
            ctx = ctxOrWork;
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            work = maybeWork!;
        } else {
            ctx = RequestContext.empty();
            work = ctxOrWork;
        }
        return this.transactionWrapper.executeInTransaction(ctx, work, 'auto', undefined, this.rawConnection);
    }

    /**
     * @description
     * Manually start a transaction if one is not already in progress. This method should be used in
     * conjunction with the `'manual'` mode of the {@link Transaction} decorator.
     */
    async startTransaction(ctx: RequestContext, isolationLevel?: TransactionIsolationLevel) {
        const transactionManager = this.getTransactionManager(ctx);
        if (transactionManager?.queryRunner?.isTransactionActive === false) {
            await transactionManager.queryRunner.startTransaction(isolationLevel);
        }
    }

    /**
     * @description
     * Manually commits any open transaction. Should be very rarely needed, since the {@link Transaction} decorator
     * and the internal TransactionInterceptor take care of this automatically. Use-cases include situations
     * in which the worker thread needs to access changes made in the current transaction, or when using the
     * Transaction decorator in manual mode.
     */
    async commitOpenTransaction(ctx: RequestContext) {
        const transactionManager = this.getTransactionManager(ctx);
        if (transactionManager?.queryRunner?.isTransactionActive) {
            await transactionManager.queryRunner.commitTransaction();
        }
    }

    /**
     * @description
     * Manually rolls back any open transaction. Should be very rarely needed, since the {@link Transaction} decorator
     * and the internal TransactionInterceptor take care of this automatically. Use-cases include when using the
     * Transaction decorator in manual mode.
     */
    async rollBackTransaction(ctx: RequestContext) {
        const transactionManager = this.getTransactionManager(ctx);
        if (transactionManager?.queryRunner?.isTransactionActive) {
            await transactionManager.queryRunner.rollbackTransaction();
        }
    }

    /**
     * @description
     * Finds an entity of the given type by ID, or throws an `EntityNotFoundError` if none
     * is found.
     */
    async getEntityOrThrow<T extends VendureEntity>(
        ctx: RequestContext,
        entityType: Type<T>,
        id: ID,
        options: GetEntityOrThrowOptions<T> = {},
    ): Promise<T> {
        const { retries, retryDelay } = options;
        if (retries == null || retries <= 0) {
            return this.getEntityOrThrowInternal(ctx, entityType, id, options);
        } else {
            let err: any;
            const retriesInt = Math.ceil(retries);
            const delay = Math.ceil(Math.max(retryDelay || 25, 1));
            for (let attempt = 0; attempt < retriesInt; attempt++) {
                try {
                    const result = await this.getEntityOrThrowInternal(ctx, entityType, id, options);
                    return result;
                } catch (e: any) {
                    err = e;
                    if (attempt < retriesInt - 1) {
                        await new Promise(resolve => setTimeout(resolve, delay));
                    }
                }
            }
            throw err;
        }
    }

    private async getEntityOrThrowInternal<T extends VendureEntity>(
        ctx: RequestContext,
        entityType: Type<T>,
        id: ID,
        options: GetEntityOrThrowOptions = {},
    ): Promise<T> {
        let entity: T | undefined;
        if (options.channelId != null) {
            const { channelId, ...optionsWithoutChannelId } = options;
            entity = await this.findOneInChannel(
                ctx,
                entityType as Type<T & ChannelAware>,
                id,
                options.channelId,
                optionsWithoutChannelId,
            );
        } else {
            const optionsWithId = {
                ...toTypeOrmFindOptions<T, GetEntityOrThrowOptions<T>>(options),
                where: {
                    ...(options.where || {}),
                    id,
                },
            } as FindOneOptions<T>;
            entity = await this.getRepository(ctx, entityType)
                .findOne(optionsWithId)
                .then(result => result ?? undefined);
        }
        if (
            !entity ||
            (entity.hasOwnProperty('deletedAt') &&
                (entity as T & SoftDeletable).deletedAt !== null &&
                options.includeSoftDeleted !== true)
        ) {
            throw new EntityNotFoundError(entityType.name as any, id);
        }
        return entity;
    }

    /**
     * @description
     * Like the TypeOrm `Repository.findOne()` method, but limits the results to
     * the given Channel.
     */
    findOneInChannel<T extends ChannelAware & VendureEntity>(
        ctx: RequestContext,
        entity: Type<T>,
        id: ID,
        channelId: ID,
        options: VendureFindOneOptions<T> = {},
    ) {
        const qb = this.getRepository(ctx, entity).createQueryBuilder('entity');
        const findOptions = toTypeOrmFindOptions<T, VendureFindOneOptions<T>>(options);

        if (findOptions.relations && Object.keys(findOptions.relations).length > 0) {
            const joinedRelations = joinTreeRelationsDynamically(qb, entity, findOptions.relations);
            // Remove any relations which are related to the 'collection' tree, as these are handled separately
            // to avoid duplicate joins.
            findOptions.relations = findOptionsArrayToObject<T>(
                findOptionsObjectToArray(findOptions.relations).filter(
                    relationPath => !joinedRelations.has(relationPath),
                ),
            );
        }
        qb.setFindOptions({
            relationLoadStrategy: 'query', // default to query strategy for maximum performance
            ...findOptions,
        });

        qb.leftJoin('entity.channels', '__channel')
            .andWhere('entity.id = :id', { id })
            .andWhere('__channel.id = :channelId', { channelId });

        return qb.getOne().then(result => {
            return result ?? undefined;
        });
    }

    /**
     * @description
     * Like the TypeOrm `Repository.findByIds()` method, but limits the results to
     * the given Channel.
     */
    findByIdsInChannel<T extends ChannelAware | VendureEntity>(
        ctx: RequestContext,
        entity: Type<T>,
        ids: ID[],
        channelId: ID,
        options: VendureFindManyOptions<T>,
    ) {
        // the syntax described in https://github.com/typeorm/typeorm/issues/1239#issuecomment-366955628
        // breaks if the array is empty
        if (ids.length === 0) {
            return Promise.resolve([]);
        }

        const qb = this.getRepository(ctx, entity).createQueryBuilder('entity');
        const findOptions = toTypeOrmFindOptions<T, VendureFindManyOptions<T>>(options);

        if (findOptions.relations && Object.keys(findOptions.relations).length > 0) {
            const joinedRelations = joinTreeRelationsDynamically(
                qb as SelectQueryBuilder<VendureEntity>,
                entity,
                findOptions.relations,
            );
            // Remove any relations which are related to the 'collection' tree, as these are handled separately
            // to avoid duplicate joins.
            findOptions.relations = findOptionsArrayToObject<T>(
                findOptionsObjectToArray(findOptions.relations).filter(
                    relationPath => !joinedRelations.has(relationPath),
                ),
            );
        }

        qb.setFindOptions({
            relationLoadStrategy: 'query', // default to query strategy for maximum performance
            ...findOptions,
        });

        qb.leftJoin('entity.channels', 'channel')
            .andWhere('entity.id IN (:...ids)', { ids })
            .andWhere('channel.id = :channelId', { channelId });

        return qb.getMany();
    }

    private wrapWithAccessControl<Entity extends ObjectLiteral>(
        repo: Repository<Entity>,
        target: ObjectType<Entity>,
        ctx: RequestContext,
        strategy: EntityAccessControlStrategy,
    ): Repository<Entity> {
        return new Proxy(repo, {
            get(obj, prop, receiver) {
                if (prop === 'createQueryBuilder') {
                    return (...args: any[]) => {
                        const qb = obj.createQueryBuilder(...args);
                        return wrapQueryBuilder(qb, target, ctx, strategy);
                    };
                }
                if (typeof prop === 'string' && ACCESS_CONTROL_INTERCEPTED_METHODS.has(prop)) {
                    return (options: FindOneOptions<Entity> | FindManyOptions<Entity> = {}) => {
                        const alias = obj.metadata.name;
                        const qb = obj.createQueryBuilder(alias);
                        qb.setFindOptions(options as FindManyOptions<Entity>);
                        strategy.applyAccessControl?.(qb as SelectQueryBuilder<any>, target as any, ctx);
                        switch (prop) {
                            case 'find':
                                return qb.getMany();
                            case 'findOne': {
                                if (!(options as FindOneOptions<Entity>).where) {
                                    return Promise.resolve(null);
                                }
                                return qb.getOne();
                            }
                            case 'findOneOrFail': {
                                return qb.getOneOrFail();
                            }
                            case 'findAndCount':
                                return qb.getManyAndCount();
                            case 'count':
                                return qb.getCount();
                            default:
                                return qb.getMany();
                        }
                    };
                }
                return Reflect.get(obj, prop, receiver);
            },
        });
    }

    /**
     * Whether reads of the given entity type should set the channel-scoped custom fields of the
     * loaded entities: only when some entity has channel-scoped custom fields, and not for the
     * channel assignment entities themselves, which hold those values.
     */
    private readsChannelCustomFields(target: unknown): boolean {
        if (this.hasChannelScopedCustomFields === undefined) {
            this.hasChannelScopedCustomFields = Object.values(this.configService.customFields ?? {}).some(
                fields => fields?.some(isChannelScopedCustomField),
            );
        }
        return (
            this.hasChannelScopedCustomFields &&
            !(typeof target === 'function' && getChannelAssignmentEntities().has(target as Type<any>))
        );
    }

    /**
     * The entity types which have channel-scoped custom fields.
     */
    private getChannelScopedEntities(): Set<unknown> {
        if (!this.channelScopedEntities) {
            const names = new Set(
                Object.entries(this.configService.customFields ?? {})
                    .filter(([, fields]) => fields?.some(isChannelScopedCustomField))
                    .map(([name]) => name),
            );
            this.channelScopedEntities = new Set(
                this.dataSource.entityMetadatas.filter(m => names.has(m.name)).map(m => m.target),
            );
        }
        return this.channelScopedEntities;
    }

    private getTransactionManager(ctx: RequestContext): EntityManager | undefined {
        return (ctx as any)[TRANSACTION_MANAGER_KEY];
    }
}

/**
 * Wraps a SelectQueryBuilder so that `applyAccessControl` is called
 * before any terminal method (getMany, getOne, etc.) executes.
 *
 * Uses an `applied` flag to ensure ACL is applied exactly once,
 * even if terminal methods call each other internally (e.g.
 * getOneOrFail → getOne → getRawAndEntities).
 */
function wrapQueryBuilder<Entity extends ObjectLiteral>(
    qb: SelectQueryBuilder<Entity>,
    entityType: ObjectType<Entity>,
    ctx: RequestContext,
    strategy: EntityAccessControlStrategy,
): SelectQueryBuilder<Entity> {
    let applied = false;
    return new Proxy(qb, {
        get(obj, prop, receiver) {
            if (typeof prop === 'string' && QB_TERMINAL_METHODS.has(prop)) {
                return (...args: any[]) => {
                    if (!applied) {
                        strategy.applyAccessControl?.(obj as SelectQueryBuilder<any>, entityType as any, ctx);
                        applied = true;
                    }
                    return (obj as any)[prop](...args);
                };
            }
            return Reflect.get(obj, prop, receiver);
        },
    });
}

/**
 * Wraps a repository so that the entities loaded by its reads, and by the reads of its
 * QueryBuilders, get the values of their channel-scoped custom fields in the Channel of `ctx` on
 * their `customFields` object. See `ChannelAssignmentService.applyChannelCustomFields()`.
 *
 * If the repository's entity has channel-scoped custom fields, its reads join the entity's
 * assignment row in that Channel, so that only entities loaded as relations take a query, and
 * `save()` writes the channel-scoped values changed on the saved entities to that Channel (see
 * `ChannelAssignmentService.persistChannelCustomFields()`).
 */
function wrapWithChannelCustomFields<Entity extends ObjectLiteral>(
    repo: Repository<Entity>,
    ctx: RequestContext,
    channelScopedEntities: Set<unknown>,
): Repository<Entity> {
    const joinsAssignment = channelScopedEntities.has(repo.metadata.target) && ctx.channelId != null;
    return new Proxy(repo, {
        get(obj, prop, receiver) {
            if (prop === 'createQueryBuilder') {
                return (...args: any[]) =>
                    wrapQueryBuilderWithChannelCustomFields(
                        (obj as any).createQueryBuilder(...args),
                        ctx,
                        channelScopedEntities,
                    );
            }
            if (prop === 'save' && joinsAssignment) {
                // Writes the channel-scoped values changed on the saved entities to the ctx Channel
                return async (...args: any[]) => {
                    const result = await (obj as any).save(...args);
                    await persistChannelCustomFields(ctx, result, obj.metadata.target);
                    return result;
                };
            }
            if (typeof prop === 'string' && CHANNEL_CUSTOM_FIELDS_REPOSITORY_METHODS.has(prop)) {
                if (joinsAssignment) {
                    // Run the read as a QueryBuilder query, which joins the assignment row
                    return (options: any = {}) => {
                        const byWhere = prop.endsWith('By') || prop === 'findOneByOrFail';
                        let findOptions = byWhere ? { where: options } : options;
                        if (prop.startsWith('findOne')) {
                            // As TypeORM's findOne()
                            if (!findOptions.where) {
                                return Promise.reject(
                                    new Error(
                                        'You must provide selection conditions in order to find a single row.',
                                    ),
                                );
                            }
                            findOptions = { ...findOptions, take: 1 };
                        }
                        const qb = wrapQueryBuilderWithChannelCustomFields(
                            (obj as any).createQueryBuilder(obj.metadata.name),
                            ctx,
                            channelScopedEntities,
                        );
                        qb.setFindOptions(findOptions);
                        if (prop === 'findOneOrFail' || prop === 'findOneByOrFail') {
                            return qb.getOneOrFail();
                        }
                        if (prop.startsWith('findOne')) {
                            return qb.getOne();
                        }
                        if (prop.startsWith('findAndCount')) {
                            return qb.getManyAndCount();
                        }
                        return qb.getMany();
                    };
                }
                return async (...args: any[]) => {
                    const result = await (obj as any)[prop](...args);
                    await applyChannelCustomFields(ctx, result);
                    return result;
                };
            }
            return Reflect.get(obj, prop, receiver);
        },
    });
}

function wrapQueryBuilderWithChannelCustomFields<Entity extends ObjectLiteral>(
    qb: SelectQueryBuilder<Entity>,
    ctx: RequestContext,
    channelScopedEntities: Set<unknown>,
): SelectQueryBuilder<Entity> {
    return new Proxy(qb, {
        get(obj, prop, receiver) {
            if (typeof prop === 'string' && CHANNEL_CUSTOM_FIELDS_QB_METHODS.has(prop)) {
                return async (...args: any[]) => {
                    joinChannelAssignment(obj, ctx, channelScopedEntities);
                    const result = await (obj as any)[prop](...args);
                    await applyChannelCustomFields(ctx, result);
                    return result;
                };
            }
            return Reflect.get(obj, prop, receiver);
        },
    });
}

/**
 * If the main entity of the query has channel-scoped custom fields, joins its assignment row in the
 * Channel of `ctx`, unless the query already loads it (the ListQueryBuilder's
 * `loadChannelAssignment` option).
 *
 * Queries with a lock or a GROUP BY are left as they are: Postgres rejects `FOR UPDATE` on the
 * nullable side of an outer join, and the joined columns are not in the GROUP BY. The rows of their
 * entities are loaded by a separate query instead (see `applyChannelCustomFields()`).
 */
function joinChannelAssignment(
    qb: SelectQueryBuilder<any>,
    ctx: RequestContext,
    channelScopedEntities: Set<unknown>,
) {
    const mainAlias = qb.expressionMap.mainAlias;
    if (
        !mainAlias?.hasMetadata ||
        ctx.channelId == null ||
        qb.expressionMap.lockMode ||
        // A lock given in the find options of setFindOptions() is only applied when the query runs
        (qb as any).findOptions?.lock ||
        qb.expressionMap.groupBys.length
    ) {
        return;
    }
    const target = mainAlias.metadata.target;
    const property = `${mainAlias.name}.${LOADED_CHANNEL_ASSIGNMENT_PROPERTY}`;
    if (
        !channelScopedEntities.has(target) ||
        qb.expressionMap.joinAttributes.some(join => join.mapToProperty === property)
    ) {
        return;
    }
    const assignment = Array.from(getChannelAssignmentEntities()).find(
        ([, options]) => options.entity() === target,
    );
    if (!assignment) {
        return;
    }
    const [assignmentTarget, options] = assignment;
    const alias = `${mainAlias.name}__channelAssignment`;
    qb.leftJoinAndMapOne(
        property,
        assignmentTarget,
        alias,
        `${alias}.${options.entityProperty}Id = ${mainAlias.name}.id AND ${alias}.channelId = :${alias}ChannelId`,
        { [`${alias}ChannelId`]: ctx.channelId },
    );
}
