import { Injectable } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import { LockNotSupportedOnGivenDriverError } from 'typeorm';

import { RequestContext } from '../../api/common/request-context';
import { Instrument } from '../../common/instrument-decorator';
import { AvailableStock } from '../../config/catalog/stock-location-strategy';
import { ConfigService } from '../../config/config.service';
import { Logger } from '../../config/logger/vendure-logger';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';
import { StockLevel } from '../../entity/stock-level/stock-level.entity';

import { StockLocationService } from './stock-location.service';

const loggerCtx = 'StockLevelService';

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
    constructor(
        private connection: TransactionalConnection,
        private stockLocationService: StockLocationService,
        private configService: ConfigService,
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
        return this.connection
            .getRepository(ctx, StockLevel)
            .createQueryBuilder('stockLevel')
            .leftJoinAndSelect('stockLevel.stockLocation', 'stockLocation')
            .leftJoin('stockLocation.channels', 'channel')
            .where('stockLevel.productVariantId = :productVariantId', { productVariantId })
            .andWhere('channel.id = :channelId', { channelId: ctx.channelId })
            .getMany();
    }

    /**
     * @description
     * Returns the available stock (on hand and allocated) for the given {@link ProductVariant}. This is determined
     * by the configured {@link StockLocationStrategy}.
     */
    async getAvailableStock(ctx: RequestContext, productVariantId: ID): Promise<AvailableStock> {
        const { stockLocationStrategy } = this.configService.catalogOptions;
        const stockLevels = await this.connection.getRepository(ctx, StockLevel).find({
            where: {
                productVariantId,
            },
        });
        return stockLocationStrategy.getAvailableStock(ctx, productVariantId, stockLevels);
    }

    /**
     * @description
     * Updates the `stockOnHand` for the given {@link ProductVariant} and {@link StockLocation}.
     * The write is atomic: the row is locked before reading to prevent lost updates under concurrency.
     * When creating a new StockLevel the initial value is the adjustment delta itself — which may be
     * negative (e.g. a backorder against a variant with a negative `outOfStockThreshold`) — so the
     * row stays consistent with the `StockAdjustment` ledger rather than silently diverging from it.
     */
    async updateStockOnHandForLocation(
        ctx: RequestContext,
        productVariantId: ID,
        stockLocationId: ID,
        change: number,
    ) {
        await this.connection.withTransaction(ctx, async txCtx => {
            const repo = this.connection.getRepository(txCtx, StockLevel);
            let stockLevel: StockLevel | null;
            try {
                stockLevel = await repo
                    .createQueryBuilder('stockLevel')
                    .setLock('pessimistic_write')
                    .where('stockLevel.productVariantId = :productVariantId', { productVariantId })
                    .andWhere('stockLevel.stockLocationId = :stockLocationId', { stockLocationId })
                    .getOne();
            } catch (e) {
                if (!(e instanceof LockNotSupportedOnGivenDriverError)) {
                    throw e;
                }
                // SQLite does not support pessimistic locking. SQLite is single-writer in practice,
                // so a concurrent write surfaces as SQLITE_BUSY (an error) rather than a silent
                // lost update. This is not the same row-lock guarantee as Postgres/MySQL; SQLite
                // is not recommended for concurrent production use.
                //
                // Note: if no StockLevel row exists yet (new variant), both the lock path and this
                // fallback cannot protect against a concurrent insert race. Two threads could both
                // enter the !stockLevel branch and collide on the unique (productVariantId,
                // stockLocationId) index. Variants normally receive a StockLevel row at creation,
                // making this an edge case; a unique-constraint violation safely rolls back the
                // transaction rather than producing an oversell.
                stockLevel = await repo.findOne({ where: { productVariantId, stockLocationId } });
            }
            if (!stockLevel) {
                await repo.save(
                    new StockLevel({
                        productVariantId,
                        stockLocationId,
                        stockOnHand: change,
                        stockAllocated: 0,
                    }),
                );
            } else {
                await repo.update(stockLevel.id, { stockOnHand: stockLevel.stockOnHand + change });
            }
        });
    }

    /**
     * @description
     * Updates the `stockAllocated` for the given {@link ProductVariant} and {@link StockLocation}.
     * The write is atomic: the row is locked before reading to prevent lost updates under concurrency.
     * `stockAllocated` is clamped at 0 so a release can never produce a negative value; a clamp that
     * actually fires is logged, since it means more was released than was ever allocated (an
     * accounting bug that must not be hidden behind a silent clamp).
     */
    async updateStockAllocatedForLocation(
        ctx: RequestContext,
        productVariantId: ID,
        stockLocationId: ID,
        change: number,
    ) {
        await this.connection.withTransaction(ctx, async txCtx => {
            const repo = this.connection.getRepository(txCtx, StockLevel);
            let stockLevel: StockLevel | null;
            try {
                stockLevel = await repo
                    .createQueryBuilder('stockLevel')
                    .setLock('pessimistic_write')
                    .where('stockLevel.productVariantId = :productVariantId', { productVariantId })
                    .andWhere('stockLevel.stockLocationId = :stockLocationId', { stockLocationId })
                    .getOne();
            } catch (e) {
                if (!(e instanceof LockNotSupportedOnGivenDriverError)) {
                    throw e;
                }
                // SQLite does not support pessimistic locking. SQLite is single-writer in practice,
                // so a concurrent write surfaces as SQLITE_BUSY rather than a silent lost update.
                // This is not the same row-lock guarantee as Postgres/MySQL; SQLite is not
                // recommended for concurrent production use.
                stockLevel = await repo.findOne({ where: { productVariantId, stockLocationId } });
            }
            if (stockLevel) {
                const nextStockAllocated = stockLevel.stockAllocated + change;
                if (nextStockAllocated < 0) {
                    Logger.warn(
                        `stockAllocated for ProductVariant ${productVariantId} at StockLocation ` +
                            `${stockLocationId} would go negative (${stockLevel.stockAllocated} + ` +
                            `${change}); clamping to 0`,
                        loggerCtx,
                    );
                }
                await repo.update(stockLevel.id, {
                    stockAllocated: Math.max(0, nextStockAllocated),
                });
            }
        });
    }
}
