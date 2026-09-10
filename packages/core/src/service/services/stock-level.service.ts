import { Injectable } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import DataLoader from 'dataloader';
import { In } from 'typeorm';

import { RequestContext } from '../../api/common/request-context';
import { RequestContextCacheService } from '../../cache/request-context-cache.service';
import { Instrument } from '../../common/instrument-decorator';
import { AvailableStock } from '../../config/catalog/stock-location-strategy';
import { ConfigService } from '../../config/config.service';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';
import { StockLevel } from '../../entity/stock-level/stock-level.entity';

import { StockLocationService } from './stock-location.service';

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
        private requestCache: RequestContextCacheService,
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
     */
    async getAvailableStock(ctx: RequestContext, productVariantId: ID): Promise<AvailableStock> {
        const { stockLocationStrategy } = this.configService.catalogOptions;
        const stockLevels = await this.getStockLevelLoader(ctx).load(productVariantId);
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
            // Reproduces the order the unbatched `productVariantId = :id` query got for free from
            // the unique (productVariantId, stockLocationId) index, which an IN (...) scan may not.
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
        if (!stockLevel) {
            await this.connection.getRepository(ctx, StockLevel).save(
                new StockLevel({
                    productVariantId,
                    stockLocationId,
                    stockOnHand: change,
                    stockAllocated: 0,
                }),
            );
        }
        if (stockLevel) {
            await this.connection
                .getRepository(ctx, StockLevel)
                .update(stockLevel.id, { stockOnHand: stockLevel.stockOnHand + change });
        }
    }

    /**
     * @description
     * Updates the `stockAllocated` for the given {@link ProductVariant} and {@link StockLocation}.
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
            await this.connection
                .getRepository(ctx, StockLevel)
                .update(stockLevel.id, { stockAllocated: stockLevel.stockAllocated + change });
        }
    }
}
