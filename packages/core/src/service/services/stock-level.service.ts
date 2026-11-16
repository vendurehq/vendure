import { Injectable } from '@nestjs/common';
import { GlobalFlag } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import { unique } from '@vendure/common/lib/unique';
import DataLoader from 'dataloader';
import {
    In,
    LessThan,
    LockNotSupportedOnGivenDriverError,
    PessimisticLockTransactionRequiredError,
} from 'typeorm';

import { RequestContext } from '../../api/common/request-context';
import { RequestContextCacheService } from '../../cache/request-context-cache.service';
import { Instrument } from '../../common/instrument-decorator';
import { AvailableStock } from '../../config/catalog/stock-location-strategy';
import { ConfigService } from '../../config/config.service';
import { Logger } from '../../config/logger/vendure-logger';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';
import { StockLevel } from '../../entity/stock-level/stock-level.entity';
import { compareIdsForLockOrder } from '../helpers/utils/stock-lock-order';

import { GlobalSettingsService } from './global-settings.service';
import { StockLocationService } from './stock-location.service';

const loggerCtx = 'StockLevelService';

/**
 * @description
 * Options which control how the stock levels of a {@link ProductVariant} are read.
 *
 * @docsCategory services
 * @since 3.7.4
 */
export interface StockLevelReadOptions {
    /**
     * @description
     * When `true`, a write lock is taken on the underlying {@link StockLevel} rows and held until
     * the surrounding transaction commits. Use it when the returned figures decide whether stock
     * may be allocated, and the allocation happens in the same transaction. Databases without row
     * locks (SQLite and SQL.js) fall back to an unlocked read.
     *
     * The lock covers every StockLevel row of the ProductVariant, whatever its
     * {@link StockLocation} or Channel, because that is the set the figures are derived from.
     * Two checkouts of the same variant therefore wait for each other even when they draw on
     * different stock locations, which {@link MultiChannelStockLocationStrategy} otherwise
     * treats as independent.
     *
     * @default false
     */
    lockStockLevels?: boolean;
}

/**
 * @description
 * Options which control which {@link StockLevel} rows
 * {@link StockLevelService.lockStockLevelsForVariants} locks.
 *
 * @docsCategory services
 * @since 3.7.4
 */
export interface StockLevelLockOptions {
    /**
     * @description
     * When `true`, ProductVariants which do not track inventory are locked as well.
     *
     * Leave it `false` when the lock protects a saleable stock check, as the order paths do:
     * an untracked variant has no stock to check, so locking it would only make concurrent
     * checkouts of that variant wait for each other.
     *
     * Set it to `true` when the transaction derives what it writes from the current
     * `stockOnHand`, as an absolute stock adjustment does. That read-then-write needs the lock
     * whether or not the variant tracks inventory, because an admin can set the `stockOnHand` of
     * an untracked variant just the same.
     *
     * @default false
     */
    includeUntrackedVariants?: boolean;
}

/**
 * @description
 * The StockLevelService is responsible for managing the stock levels of ProductVariants.
 * Whenever you need to adjust the `stockOnHand` or `stockAllocated` for a ProductVariant,
 * you should use this service.
 *
 * @docsCategory services
 * @since 2.0.0
 */
@Injectable()
@Instrument()
export class StockLevelService {
    private hasWarnedAboutMissingRowLockSupport = false;
    private hasWarnedAboutMissingTransaction = false;

    constructor(
        private connection: TransactionalConnection,
        private stockLocationService: StockLocationService,
        private configService: ConfigService,
        private requestCache: RequestContextCacheService,
        private globalSettingsService: GlobalSettingsService,
    ) {}

    /**
     * @description
     * Returns the StockLevel for the given {@link ProductVariant} and {@link StockLocation}.
     */
    async getStockLevel(ctx: RequestContext, productVariantId: ID, stockLocationId: ID): Promise<StockLevel> {
        const stockLevel = await this.connection.getRepository(ctx, StockLevel).findOne({
            where: {
                productVariantId,
                stockLocationId,
            },
        });
        if (stockLevel) {
            return stockLevel;
        }
        return this.connection.getRepository(ctx, StockLevel).save(
            new StockLevel({
                productVariantId,
                stockLocationId,
                stockOnHand: 0,
                stockAllocated: 0,
            }),
        );
    }

    async getStockLevelsForVariant(ctx: RequestContext, productVariantId: ID): Promise<StockLevel[]> {
        return this.getChannelStockLevelsLoader(ctx).load(productVariantId);
    }

    /**
     * @description
     * Returns the available stock (on hand and allocated) for the given {@link ProductVariant}. This is determined
     * by the configured {@link StockLocationStrategy}.
     *
     * Pass `{ lockStockLevels: true }` when the caller is about to allocate stock based on the
     * returned figures. This takes a write lock on the underlying StockLevel rows which is held
     * until the surrounding transaction commits, so that the check and the allocation cannot be
     * interleaved with another checkout for the same ProductVariant.
     *
     * @since 3.7.4 - Added the `options` parameter
     */
    async getAvailableStock(
        ctx: RequestContext,
        productVariantId: ID,
        options?: StockLevelReadOptions,
    ): Promise<AvailableStock> {
        const { stockLocationStrategy } = this.configService.catalogOptions;
        // The locked read bypasses the batching loader: the lock must be taken on this
        // transaction's own query, and its rows must not be shared with other callers.
        const stockLevels = options?.lockStockLevels
            ? await this.getLockedStockLevelsForVariant(ctx, productVariantId)
            : await this.getStockLevelLoader(ctx).load(productVariantId);
        return stockLocationStrategy.getAvailableStock(ctx, productVariantId, stockLevels);
    }

    /**
     * Resolving a list of ProductVariants costs one query per variant otherwise, and the Admin
     * API doubles that because `stockOnHand` and `stockAllocated` are separate field resolvers.
     * `cache: false` batches without memoizing, so a write earlier in the request is not masked.
     */
    private getStockLevelLoader(ctx: RequestContext): DataLoader<ID, StockLevel[]> {
        return this.requestCache.get(
            ctx,
            'StockLevelService.stockLevelsByVariantId',
            () =>
                new DataLoader<ID, StockLevel[]>(ids => this.batchLoadStockLevels(ctx, ids as ID[]), {
                    cache: false,
                }),
        );
    }

    private async batchLoadStockLevels(ctx: RequestContext, ids: ID[]): Promise<StockLevel[][]> {
        const stockLevels = await this.connection.getRepository(ctx, StockLevel).find({
            where: {
                productVariantId: In(this.uniqueIds(ids)),
            },
        });
        return this.groupByVariantId(ids, stockLevels);
    }

    /**
     * Held against the RequestContext which also supplies the channel filter below, so a single
     * loader per ctx cannot mix channels. `cache: false` batches without memoizing, so a write
     * earlier in the request is not masked, for the same reason as `getStockLevelLoader`.
     */
    private getChannelStockLevelsLoader(ctx: RequestContext): DataLoader<ID, StockLevel[]> {
        return this.requestCache.get(
            ctx,
            'StockLevelService.channelStockLevelsByVariantId',
            () =>
                new DataLoader<ID, StockLevel[]>(ids => this.batchLoadChannelStockLevels(ctx, ids as ID[]), {
                    cache: false,
                }),
        );
    }

    private async batchLoadChannelStockLevels(ctx: RequestContext, ids: ID[]): Promise<StockLevel[][]> {
        const stockLevels = await this.connection
            .getRepository(ctx, StockLevel)
            .createQueryBuilder('stockLevel')
            .leftJoinAndSelect('stockLevel.stockLocation', 'stockLocation')
            .leftJoin('stockLocation.channels', 'channel')
            .where('stockLevel.productVariantId IN (:...productVariantIds)', {
                productVariantIds: this.uniqueIds(ids),
            })
            .andWhere('channel.id = :channelId', { channelId: ctx.channelId })
            // An IN (...) query gives no row order guarantee, so sort to keep the order of
            // `stockLevels` stable for API clients.
            .orderBy('stockLevel.stockLocationId', 'ASC')
            .getMany();
        return this.groupByVariantId(ids, stockLevels);
    }

    private uniqueIds(ids: ID[]): ID[] {
        return [...new Map(ids.map(id => [String(id), id])).values()];
    }

    /**
     * Returns one entry per requested id, in the order requested, as a DataLoader batch function
     * must. A variant with no rows gets an empty array.
     */
    private groupByVariantId(ids: ID[], stockLevels: StockLevel[]): StockLevel[][] {
        const byVariantId = new Map<string, StockLevel[]>();
        for (const stockLevel of stockLevels) {
            const key = String(stockLevel.productVariantId);
            const existing = byVariantId.get(key);
            if (existing) {
                existing.push(stockLevel);
            } else {
                byVariantId.set(key, [stockLevel]);
            }
        }
        return ids.map(id => byVariantId.get(String(id)) ?? []);
    }

    /**
     * @description
     * Updates the `stockOnHand` for the given {@link ProductVariant} and {@link StockLocation}.
     * When creating a new StockLevel the initial value is the adjustment delta itself, which may be
     * negative (e.g. a backorder against a variant with a negative `outOfStockThreshold`), so the
     * row stays consistent with the `StockAdjustment` ledger.
     */
    async updateStockOnHandForLocation(
        ctx: RequestContext,
        productVariantId: ID,
        stockLocationId: ID,
        change: number,
    ) {
        const stockLevel = await this.connection.getRepository(ctx, StockLevel).findOne({
            where: {
                productVariantId,
                stockLocationId,
            },
        });
        if (stockLevel) {
            await this.incrementStockLevel(ctx, stockLevel.id, 'stockOnHand', change);
        } else {
            await this.connection.getRepository(ctx, StockLevel).save(
                new StockLevel({
                    productVariantId,
                    stockLocationId,
                    stockOnHand: change,
                    stockAllocated: 0,
                }),
            );
        }
    }

    /**
     * @description
     * Updates the `stockAllocated` for the given {@link ProductVariant} and {@link StockLocation}.
     * `stockAllocated` is clamped at 0 so a release can never produce a negative value. A clamp
     * which fires is logged, since it means more was released than was ever allocated.
     */
    async updateStockAllocatedForLocation(
        ctx: RequestContext,
        productVariantId: ID,
        stockLocationId: ID,
        change: number,
    ) {
        const stockLevel = await this.connection.getRepository(ctx, StockLevel).findOne({
            where: {
                productVariantId,
                stockLocationId,
            },
        });
        if (stockLevel) {
            await this.incrementStockLevel(ctx, stockLevel.id, 'stockAllocated', change);
            if (change < 0) {
                await this.clampStockAllocatedAtZero(
                    ctx,
                    stockLevel.id,
                    productVariantId,
                    stockLocationId,
                    change,
                );
            }
        }
    }

    /**
     * A second atomic statement rather than a clamp computed in JavaScript, for the same reason as
     * `incrementStockLevel`: only the database knows the value the decrement actually produced.
     */
    private async clampStockAllocatedAtZero(
        ctx: RequestContext,
        stockLevelId: ID,
        productVariantId: ID,
        stockLocationId: ID,
        change: number,
    ) {
        const result = await this.connection
            .getRepository(ctx, StockLevel)
            .update({ id: stockLevelId, stockAllocated: LessThan(0) }, { stockAllocated: 0 });
        if (result.affected) {
            Logger.warn(
                `stockAllocated for ProductVariant ${String(productVariantId)} at StockLocation ` +
                    `${String(stockLocationId)} went negative after a change of ${change}; clamped to 0`,
                loggerCtx,
            );
        }
    }

    /**
     * Applies the change with a single atomic SQL statement (`SET column = column + change`),
     * via TypeORM's `Repository.increment()`. The invariant: the stored value must never be
     * computed from a value read earlier in JavaScript, because two overlapping requests would
     * then both start from the same figure and one of the two changes would be lost. A negative
     * change decrements.
     */
    private async incrementStockLevel(
        ctx: RequestContext,
        stockLevelId: ID,
        property: 'stockOnHand' | 'stockAllocated',
        change: number,
    ) {
        await this.connection
            .getRepository(ctx, StockLevel)
            .increment({ id: stockLevelId }, property, change);
    }

    /**
     * @description
     * Takes the write lock of {@link StockLevelService.getLockedStockLevelsForVariant} for each of
     * the given ProductVariants, in a fixed order: duplicates are dropped, the variants are visited
     * in ascending id order and each variant's rows in id order. A transaction which changes the
     * stock of more than one variant should call this once, before its first stock read or write.
     * Two such transactions then take their locks in the same order, so they cannot deadlock, and
     * later stock writes in the transaction meet rows it already holds.
     *
     * Variants which do not track inventory are skipped by default: nothing is checked or counted
     * for them, so locking them would only serialize their checkouts. Pass
     * `{ includeUntrackedVariants: true }` when the transaction derives what it writes from the
     * current `stockOnHand` rather than from a saleable stock check.
     *
     * Degrades like `getLockedStockLevelsForVariant` without a transaction or row lock support.
     *
     * @since 3.7.4
     */
    async lockStockLevelsForVariants(
        ctx: RequestContext,
        productVariantIds: ID[],
        options?: StockLevelLockOptions,
    ): Promise<void> {
        const ids = unique(productVariantIds);
        if (!ids.length) {
            return;
        }
        const idsToLock = options?.includeUntrackedVariants ? ids : await this.filterToTrackedIds(ctx, ids);
        for (const productVariantId of [...idsToLock].sort(compareIdsForLockOrder)) {
            await this.getLockedStockLevelsForVariant(ctx, productVariantId);
        }
    }

    private async filterToTrackedIds(ctx: RequestContext, ids: ID[]): Promise<ID[]> {
        const { trackInventory } = await this.globalSettingsService.getSettings(ctx);
        const variants = await this.connection.getRepository(ctx, ProductVariant).find({
            where: { id: In(ids) },
            select: { id: true, trackInventory: true },
            loadEagerRelations: false,
        });
        return variants
            .filter(
                v =>
                    v.trackInventory === GlobalFlag.TRUE ||
                    (v.trackInventory === GlobalFlag.INHERIT && trackInventory),
            )
            .map(v => v.id);
    }

    /**
     * @description
     * Returns every {@link StockLevel} of the given {@link ProductVariant}, whatever its
     * {@link StockLocation} or Channel, with a write lock (`SELECT ... FOR UPDATE`) held until
     * the surrounding transaction commits. Use it when the returned figures decide how much
     * stock to allocate and the allocation happens in the same transaction: a second
     * transaction for the same variant waits here until the first commits, then reads the
     * updated `stockAllocated`.
     *
     * The rows are read by the locking statement itself. On MySQL and MariaDB a plain SELECT
     * under REPEATABLE READ keeps returning the transaction's opening snapshot, while a locking
     * read sees the latest committed row.
     *
     * Rows are locked in id order. When locking several variants in one transaction, visit them
     * in a fixed order too, so two transactions cannot take the same locks in opposite order.
     *
     * Without an open transaction, or on a driver without row locks (SQLite, SQL.js), this falls
     * back to an unlocked read and logs a warning once per process.
     *
     * @since 3.7.4
     */
    async getLockedStockLevelsForVariant(ctx: RequestContext, productVariantId: ID): Promise<StockLevel[]> {
        try {
            return await this.connection
                .getRepository(ctx, StockLevel)
                .createQueryBuilder('stockLevel')
                .setLock('pessimistic_write')
                .where('stockLevel.productVariantId = :productVariantId', { productVariantId })
                .orderBy('stockLevel.id', 'ASC')
                .getMany();
        } catch (e: any) {
            // Only the two lock-support errors below are recoverable. Everything else must
            // propagate, in particular MariaDB 11.6+ ER_CHECKREAD ("Record has changed since last
            // read"), which `innodb_snapshot_isolation` raises when this locking read meets a row
            // that changed after the transaction's snapshot. MariaDB has already aborted the
            // transaction at that point, so failing here is the only outcome which is safe for the
            // stock figures: swallowing it and falling back to an unlocked read would hand the
            // caller a stale figure and allow the over-allocation this lock exists to prevent. It is
            // not safe for payments: if a payment was already captured in this transaction, the
            // abort rolls back the order while the charge stands.
            if (
                !(e instanceof LockNotSupportedOnGivenDriverError) &&
                !(e instanceof PessimisticLockTransactionRequiredError)
            ) {
                throw e;
            }
            if (e instanceof PessimisticLockTransactionRequiredError) {
                // The driver supports row locks but no transaction is open, so the lock cannot be
                // taken. The caller may act on the unlocked figure, so say so rather than degrading
                // in silence, but only once: a caller which does this does it on every request.
                if (!this.hasWarnedAboutMissingTransaction) {
                    this.hasWarnedAboutMissingTransaction = true;
                    Logger.warn(
                        'Could not lock the StockLevel rows for ProductVariant ' +
                            `${String(productVariantId)} because no transaction is in progress. ` +
                            'Wrap the call with the @Transaction() resolver decorator, or start a ' +
                            'transaction via TransactionalConnection.withTransaction(). Further ' +
                            'occurrences are not logged.',
                        loggerCtx,
                    );
                }
            } else if (!this.hasWarnedAboutMissingRowLockSupport) {
                // A driver without row locks is a property of the deployment, so this branch is
                // taken for the whole life of the server. Warn once rather than on every checkout.
                this.hasWarnedAboutMissingRowLockSupport = true;
                Logger.warn(
                    'The configured database driver does not support row locking, so the saleable ' +
                        'stock check cannot be held across the allocation which follows it. ' +
                        'Concurrent checkouts of the same ProductVariant can still allocate more ' +
                        'units than are in stock. This is expected on SQLite and SQL.js. Use ' +
                        'PostgreSQL, MySQL or MariaDB in production.',
                    loggerCtx,
                );
            }
            // SQLite and SQL.js have no row locks. Fall back to an unlocked read: on SQLite writes
            // are serialized by the engine itself, and without a transaction there is nothing for
            // the lock to be held for.
            return this.connection.getRepository(ctx, StockLevel).find({
                where: {
                    productVariantId,
                },
            });
        }
    }
}
