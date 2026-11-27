import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { ID, Type } from '@vendure/common/lib/shared-types';
import {
    DataSource,
    EntityManager,
    EntitySchema,
    FindManyOptions,
    FindOneOptions,
    FindOptionsRelations,
    ObjectLiteral,
    ObjectType,
    QueryRunner,
    ReplicationMode,
    Repository,
    SelectQueryBuilder,
} from 'typeorm';

import { RequestContext } from '../api/common/request-context';
import { TransactionIsolationLevel } from '../api/decorators/transaction.decorator';
import {
    TRANSACTION_ISOLATION_LEVEL_KEY,
    TRANSACTION_MANAGER_KEY,
    TRANSACTION_NO_RETRY_KEY,
} from '../common/constants';
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

import { getDatabaseType } from './database-type';
import { findOptionsArrayToObject } from './find-options-array-to-object';
import { findOptionsObjectToArray } from './find-options-object-to-array';
import { isPostgresDatabase } from './timezone-utils';
import { toTypeOrmFindOptions } from './to-typeorm-find-options';
import { TransactionWrapper } from './transaction-wrapper';
import { GetEntityOrThrowOptions, VendureFindManyOptions, VendureFindOneOptions } from './types';

/**
 * The databases on which `lockRow()` takes a lock. SQLite and sql.js support no row locks, and run
 * every write on a single connection.
 */
const ROW_LOCKING_DB_TYPES: string[] = ['postgres', 'aurora-postgres', 'mysql', 'mariadb', 'aurora-mysql'];

/**
 * @description
 * Options for {@link TransactionalConnection}`.lockRow()`.
 *
 * @docsCategory data-access
 * @since 4.0.0
 */
export interface LockRowOptions {
    /**
     * @description
     * Only take the lock where the reads which follow it see what the previous lock holder
     * committed, which needs `READ COMMITTED`. Set this when the lock serializes a
     * read-modify-write: there, a writer which waited for the lock but still read its first
     * snapshot would overwrite the changes of the writer before it every time, which is worse than
     * not serializing at all.
     *
     * The lock is skipped on Aurora MySQL, whose TypeORM driver never applies an isolation level so
     * that it always runs at `REPEATABLE READ`, and in a transaction which runs at
     * `REPEATABLE READ`, whether through `entityOptions.transactionIsolationLevel` or the
     * `@Transaction()` decorator.
     *
     * @default false
     */
    requireReadCommitted?: boolean;
}

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
    ): Repository<Entity> {
        if (ctx) {
            const transactionManager = this.getTransactionManager(ctx);
            let repo: Repository<Entity>;
            if (transactionManager) {
                repo = transactionManager.getRepository(target);
            } else if (ctx.replicationMode === 'master' || options?.replicationMode === 'master') {
                repo = this.dataSource.createQueryRunner('master').manager.getRepository(target);
            } else {
                repo = this.rawConnection.getRepository(target);
            }
            const strategy = this.configService.authOptions.entityAccessControlStrategy;
            if (strategy?.applyAccessControl && typeof target === 'function') {
                repo = this.wrapWithAccessControl(repo, target, ctx, strategy);
            }
            if (this.readsChannelCustomFields(target)) {
                repo = wrapWithChannelCustomFields(repo, ctx, this.getChannelScopedEntities());
            }
            return repo;
        }
        if (options?.replicationMode === 'master') {
            return this.dataSource.createQueryRunner(options.replicationMode).manager.getRepository(target);
        }
        return this.rawConnection.getRepository(target);
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
     * The isolation level Vendure starts transactions at when none is asked for: the configured
     * `entityOptions.transactionIsolationLevel`, then (with TypeORM v1) an `isolationLevel` set in
     * `dbConnectionOptions`, otherwise `READ COMMITTED` on MySQL and MariaDB, otherwise `undefined`,
     * meaning the database default. To run a TypeORM transaction of your own at this level, use
     * {@link TransactionalConnection}`.withRawTransaction()`.
     *
     * @since 4.0.0
     */
    getDefaultIsolationLevel(): TransactionIsolationLevel | undefined {
        return this.transactionWrapper.resolveIsolationLevel(undefined, this.rawConnection);
    }

    /**
     * @description
     * Runs `work` in a TypeORM transaction of its own, on a connection of its own, at the isolation
     * level of {@link TransactionalConnection}`.getDefaultIsolationLevel()`. Unlike
     * `withTransaction()`, it does not join the transaction of a RequestContext and is never
     * retried, so it suits background work such as job queue and scheduler bookkeeping.
     *
     * @example
     * ```ts
     * await this.connection.withRawTransaction(async manager => {
     *     const record = await manager.getRepository(MyRecord).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
     *     // ...
     * });
     * ```
     *
     * @since 4.0.0
     */
    withRawTransaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
        const isolationLevel = this.getDefaultIsolationLevel();
        return isolationLevel
            ? this.rawConnection.transaction(isolationLevel, work)
            : this.rawConnection.transaction(work);
    }

    /**
     * @description
     * Manually start a transaction if one is not already in progress. This method should be used in
     * conjunction with the `'manual'` mode of the {@link Transaction} decorator. Without an
     * `isolationLevel`, it starts at {@link TransactionalConnection}`.getDefaultIsolationLevel()`.
     */
    async startTransaction(ctx: RequestContext, isolationLevel?: TransactionIsolationLevel) {
        const transactionManager = this.getTransactionManager(ctx);
        const queryRunner = transactionManager?.queryRunner;
        if (queryRunner?.isTransactionActive === false) {
            const level = this.transactionWrapper.resolveIsolationLevel(isolationLevel, this.rawConnection);
            await queryRunner.startTransaction(level);
            queryRunner.data[TRANSACTION_ISOLATION_LEVEL_KEY] = level;
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
     * Takes a write lock on a single row, so that concurrent requests which want to modify the
     * same row are serialized rather than overwriting each other. The lock is held until the
     * surrounding transaction commits or rolls back.
     *
     * The lock is a standalone `SELECT ... FOR UPDATE` by primary key (`FOR NO KEY UPDATE` on
     * Postgres, which does not block inserts of rows referencing this one). It deliberately does not
     * load relations: locking a query which left-joins is rejected by Postgres, and making the
     * join inner to satisfy it would silently change which rows the query returns.
     *
     * Two conditions have to hold, and the call is a no-op otherwise:
     *
     * * The database must support row locking. SQLite and sql.js do not, but they are also
     *   single-connection, so the race a lock would prevent cannot occur on them.
     * * The context must already be inside a transaction. A lock taken in autocommit is released
     *   by the next statement and protects nothing, and this is what keeps read-only requests,
     *   which are not wrapped by the {@link Transaction} decorator, from taking locks at all.
     *
     * When several rows are locked in one request, always lock them in the same order across the
     * whole codebase, or two requests can deadlock by taking the same pair in opposite orders.
     * The lock order Vendure uses is:
     *
     * 1. Session
     * 2. User
     * 3. Order, several of them in ascending id order
     * 4. the rows an order operation goes on to lock: the Promotion of a coupon code, then StockLevels
     *    in ascending ProductVariant id order
     *
     * Reads which follow the lock only see what the previous lock holder committed under
     * `READ COMMITTED`. Under `REPEATABLE READ` they keep reading the transaction's first
     * snapshot. See `entityOptions.transactionIsolationLevel` and {@link LockRowOptions}.
     *
     * @since 4.0.0
     */
    async lockRow<T extends VendureEntity>(
        ctx: RequestContext,
        entityType: ObjectType<T>,
        id: ID,
        options?: LockRowOptions,
    ): Promise<void> {
        if (!ROW_LOCKING_DB_TYPES.includes(this.rawConnection.options.type)) {
            return;
        }
        const transactionManager = this.getTransactionManager(ctx);
        const queryRunner = transactionManager?.queryRunner;
        // A manager without an active transaction is a `@Transaction('manual')` context whose
        // transaction has not been started yet, or has already ended. TypeORM refuses a lock there.
        if (!transactionManager || !queryRunner?.isTransactionActive) {
            return;
        }
        if (options?.requireReadCommitted && !this.readsSeeCommitsAfterLock(queryRunner)) {
            return;
        }
        // The manager's own repository rather than `getRepository(ctx)`: an
        // EntityAccessControlStrategy could otherwise add joins, which would lock their rows too
        // (or be rejected by Postgres), or filters, which could leave the row unlocked.
        await transactionManager
            .getRepository(entityType)
            .createQueryBuilder('entity')
            .select('entity.id')
            // On Postgres, FOR NO KEY UPDATE: it serializes writers like FOR UPDATE, but does not
            // conflict with the FOR KEY SHARE lock an insert of a row referencing this one takes,
            // which a plain UPDATE of the row would not block either.
            .setLock(
                isPostgresDatabase(getDatabaseType(this.rawConnection))
                    ? 'for_no_key_update'
                    : 'pessimistic_write',
            )
            .where('entity.id = :id', { id })
            .getOne();
    }

    /**
     * Whether a read made after a row lock sees what the previous holder of the lock committed. See
     * {@link LockRowOptions}.
     */
    private readsSeeCommitsAfterLock(queryRunner: QueryRunner): boolean {
        const dbType = getDatabaseType(this.rawConnection);
        if (dbType === 'aurora-mysql') {
            return false;
        }
        // The level the transaction was started at, which TransactionWrapper and startTransaction()
        // record. It can differ from the default, e.g. with `@Transaction('auto', 'REPEATABLE READ')`.
        const level: TransactionIsolationLevel | undefined =
            TRANSACTION_ISOLATION_LEVEL_KEY in queryRunner.data
                ? queryRunner.data[TRANSACTION_ISOLATION_LEVEL_KEY]
                : this.getDefaultIsolationLevel();
        if (level) {
            return level !== 'REPEATABLE READ';
        }
        // The database default: REPEATABLE READ on InnoDB, READ COMMITTED elsewhere.
        return dbType !== 'mysql' && dbType !== 'mariadb';
    }

    /**
     * @description
     * Marks the current attempt of the transaction as not safe to retry.
     *
     * When the database rejects a transaction with a deadlock or a serialization failure,
     * Vendure rolls it back and runs the whole unit of work again. That is safe for database
     * writes, which the rollback discards, but not for work outside the database. Call this
     * before such work, for example a call to a payment provider, and a failure after it is
     * thrown instead of being retried. Vendure does this before calling the methods of a
     * {@link PaymentMethodHandler}, and a {@link FulfillmentHandler}'s `createFulfillment()` and
     * `onFulfillmentTransition()`. Other code, such as an {@link AuthenticationStrategy}'s
     * `authenticate()`, runs again on a retry unless it calls this.
     *
     * A no-op outside a transaction.
     *
     * @since 4.0.0
     */
    preventTransactionRetry(ctx: RequestContext): void {
        const queryRunner = this.getTransactionManager(ctx)?.queryRunner;
        if (queryRunner) {
            queryRunner.data[TRANSACTION_NO_RETRY_KEY] = true;
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
        this.setChannelQueryFindOptions(qb, entity, options);

        qb.leftJoin('entity.channels', '__channel')
            .andWhere('entity.id = :id', { id })
            .andWhere('__channel.id = :channelId', { channelId });

        return qb.getOne().then(result => {
            return result ?? undefined;
        });
    }

    /**
     * @description
     * Like the TypeOrm `Repository.find()` method, but limits the results to entities assigned to
     * the given Channel. Relations are loaded with separate queries (`relationLoadStrategy:
     * 'query'`), so a relation such as `channels` is loaded in full rather than limited to the
     * Channel, and eager relations of different entities are not multiplied in one result set.
     *
     * @since 4.0.0
     */
    findInChannel<T extends ChannelAware & VendureEntity>(
        ctx: RequestContext,
        entity: Type<T>,
        channelId: ID,
        options: VendureFindManyOptions<T> = {},
    ): Promise<T[]> {
        const qb = this.getRepository(ctx, entity).createQueryBuilder('entity');
        this.setChannelQueryFindOptions(qb, entity, options);
        qb.innerJoin('entity.channels', '__channel', '__channel.id = :__findInChannelId', {
            __findInChannelId: channelId,
        });
        return qb.getMany();
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
        this.setChannelQueryFindOptions(qb, entity, options);

        qb.leftJoin('entity.channels', 'channel')
            .andWhere('entity.id IN (:...ids)', { ids })
            .andWhere('channel.id = :channelId', { channelId });

        return qb.getMany();
    }

    /**
     * Sets the find options of the `*InChannel()` queries. Relations of the 'collection' tree are
     * joined separately, so that they are not joined twice, and the other relations are loaded with
     * separate queries (`relationLoadStrategy: 'query'`) for performance.
     */
    private setChannelQueryFindOptions<T extends ObjectLiteral>(
        qb: SelectQueryBuilder<T>,
        entity: Type<T>,
        options: VendureFindManyOptions<T>,
    ) {
        const findOptions = toTypeOrmFindOptions<T, VendureFindManyOptions<T>>(options);
        if (findOptions.relations && Object.keys(findOptions.relations).length > 0) {
            const joinedRelations = joinTreeRelationsDynamically(
                qb as unknown as SelectQueryBuilder<VendureEntity>,
                entity as unknown as Type<VendureEntity>,
                findOptions.relations as FindOptionsRelations<VendureEntity>,
            );
            findOptions.relations = findOptionsArrayToObject<T>(
                findOptionsObjectToArray(findOptions.relations).filter(
                    relationPath => !joinedRelations.has(relationPath),
                ),
            );
        }
        qb.setFindOptions({
            relationLoadStrategy: 'query',
            ...findOptions,
        });
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
