import { Injectable } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';
import { DEFAULT_STOCK_LOCATION_PARTITION_KEY } from '../../common/constants';
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
    ) {}

    /**
     * @description
     * Returns the StockLevel for the given {@link ProductVariant} and {@link StockLocation}.
     *
     * When `partitionKey` is omitted or `undefined`, the default partition
     * ({@link DEFAULT_STOCK_LOCATION_PARTITION_KEY}) is used — this preserves the standard
     * single-StockLevel-per-variant-location behavior.
     * When an explicit `partitionKey` is provided, the lookup targets that specific partition,
     * enabling use cases such as batch/lot tracking.
     */
    async getStockLevel(
        ctx: RequestContext,
        productVariantId: ID,
        stockLocationId: ID,
        partitionKey?: string,
    ): Promise<StockLevel> {
        const pk = partitionKey ?? DEFAULT_STOCK_LOCATION_PARTITION_KEY;
        const stockLevel = await this.connection.getRepository(ctx, StockLevel).findOne({
            where: {
                productVariantId,
                stockLocationId,
                partitionKey: pk,
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
                partitionKey: pk,
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
     *
     * When `partitionKey` is omitted, the default partition ({@link DEFAULT_STOCK_LOCATION_PARTITION_KEY}) is targeted.
     * If no StockLevel exists for the resolved partition, a new one is created with
     * `stockOnHand` set to `change` and `stockAllocated` set to `0`.
     *
     * @see {@link updateStockAllocatedForLocation} which has different creation semantics —
     * it will **not** create a new StockLevel if the partition does not exist, treating
     * allocation to a non-existent partition as a no-op (logic error).
     */
    async updateStockOnHandForLocation(
        ctx: RequestContext,
        productVariantId: ID,
        stockLocationId: ID,
        change: number,
        partitionKey?: string,
    ) {
        const pk = partitionKey ?? DEFAULT_STOCK_LOCATION_PARTITION_KEY;
        const stockLevel = await this.connection.getRepository(ctx, StockLevel).findOne({
            where: {
                productVariantId,
                stockLocationId,
                partitionKey: pk,
            },
        });
        if (!stockLevel) {
            await this.connection.getRepository(ctx, StockLevel).save(
                new StockLevel({
                    productVariantId,
                    stockLocationId,
                    stockOnHand: change,
                    stockAllocated: 0,
                    partitionKey: pk,
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
     *
     * When `partitionKey` is omitted, the default partition ({@link DEFAULT_STOCK_LOCATION_PARTITION_KEY}) is targeted.
     * Unlike {@link updateStockOnHandForLocation}, this method will **not** create a new
     * StockLevel if no matching partition exists — it will be a no-op. This is intentional:
     * allocating stock to a non-existent partition indicates a logic error in the calling code,
     * whereas receiving stock (updating stockOnHand) may legitimately create new partitions.
     */
    async updateStockAllocatedForLocation(
        ctx: RequestContext,
        productVariantId: ID,
        stockLocationId: ID,
        change: number,
        partitionKey?: string,
    ) {
        const pk = partitionKey ?? DEFAULT_STOCK_LOCATION_PARTITION_KEY;
        const stockLevel = await this.connection.getRepository(ctx, StockLevel).findOne({
            where: {
                productVariantId,
                stockLocationId,
                partitionKey: pk,
            },
        });
        if (stockLevel) {
            await this.connection
                .getRepository(ctx, StockLevel)
                .update(stockLevel.id, { stockAllocated: stockLevel.stockAllocated + change });
        }
    }
}
