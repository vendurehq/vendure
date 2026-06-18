import type { GlobalSettingsService } from '../../service/index';
import { GlobalFlag } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import ms from 'ms';
import { filter } from 'rxjs/operators';

import { RequestContext } from '../../api/common/request-context';
import { Cache, CacheService, RequestContextCacheService } from '../../cache/index';
import { Injector } from '../../common/injector';
import { ProductVariant } from '../../entity/index';
import { OrderLine } from '../../entity/order-line/order-line.entity';
import { StockLevel } from '../../entity/stock-level/stock-level.entity';
import { StockLocation } from '../../entity/stock-location/stock-location.entity';
import { EventBus, StockLocationEvent } from '../../event-bus/index';

import { BaseStockLocationStrategy } from './default-stock-location-strategy';
import { AvailableStock, LocationWithQuantity, StockLocationStrategy } from './stock-location-strategy';

/**
 * @description
 * The MultiChannelStockLocationStrategy is an implementation of the {@link StockLocationStrategy}.
 * which is suitable for both single- and multichannel setups. It takes into account the active
 * channel when determining stock levels, and also ensures that allocations are made only against
 * stock locations which are associated with the active channel.
 *
 * This strategy became the default in Vendure 3.1.0. If you want to use the previous strategy which
 * does not take channels into account, update your VendureConfig to use to {@link DefaultStockLocationStrategy}.
 *
 * @docsCategory products & stock
 * @since 3.1.0
 */
export class MultiChannelStockLocationStrategy extends BaseStockLocationStrategy {
    /** @internal */
    protected cacheService: CacheService;
    /** @internal */
    protected channelIdCache: Cache;
    /** @internal */
    protected eventBus: EventBus;
    /** @internal */
    protected globalSettingsService: GlobalSettingsService;
    /** @internal */
    protected requestContextCache: RequestContextCacheService;

    /** @internal */
    async init(injector: Injector) {
        super.init(injector);
        this.eventBus = injector.get(EventBus);
        this.cacheService = injector.get(CacheService);
        this.requestContextCache = injector.get(RequestContextCacheService);
        // Dynamically import the GlobalSettingsService to avoid circular dependency
        const GlobalSettingsService = (await import('../../service/services/global-settings.service.js'))
            .GlobalSettingsService;
        this.globalSettingsService = injector.get(GlobalSettingsService);
        this.channelIdCache = this.cacheService.createCache({
            options: {
                ttl: ms('7 days'),
                tags: ['StockLocation'],
            },
            getKey: id => this.getCacheKey(id),
        });

        // When a StockLocation is updated, we need to invalidate the cache
        this.eventBus
            .ofType(StockLocationEvent)
            .pipe(filter(event => event.type !== 'created'))
            .subscribe(({ entity }) => this.channelIdCache.delete(this.getCacheKey(entity.id)));
    }

    /**
     * @description
     * Returns the available stock for the given ProductVariant, taking into account the active Channel.
     */
    async getAvailableStock(
        ctx: RequestContext,
        productVariantId: ID,
        stockLevels: StockLevel[],
    ): Promise<AvailableStock> {
        let stockOnHand = 0;
        let stockAllocated = 0;
        for (const stockLevel of stockLevels) {
            const applies = await this.stockLevelAppliesToActiveChannel(ctx, stockLevel);
            if (applies) {
                stockOnHand += stockLevel.stockOnHand;
                stockAllocated += stockLevel.stockAllocated;
            }
        }
        return { stockOnHand, stockAllocated };
    }

    /**
     * @description
     * This method takes into account whether the stock location is applicable to the active channel.
     * It furthermore respects the `trackInventory` and `outOfStockThreshold` settings of the ProductVariant,
     * in order to allocate stock only from locations which are relevant to the active channel and which
     * have sufficient stock available.
     */
    async forAllocation(
        ctx: RequestContext,
        stockLocations: StockLocation[],
        orderLine: OrderLine,
        quantity: number,
    ): Promise<LocationWithQuantity[]> {
        const stockLevels = await this.getStockLevelsForVariant(ctx, orderLine.productVariantId);
        const variant = await this.connection.getEntityOrThrow(
            ctx,
            ProductVariant,
            orderLine.productVariantId,
            { loadEagerRelations: false },
        );
        let totalAllocated = 0;
        const locations: LocationWithQuantity[] = [];
        const { inventoryNotTracked, effectiveOutOfStockThreshold } = await this.getVariantStockSettings(
            ctx,
            variant,
        );
        for (const stockLocation of stockLocations) {
            const stockLevel = stockLevels.find(sl => sl.stockLocationId === stockLocation.id);
            if (stockLevel && (await this.stockLevelAppliesToActiveChannel(ctx, stockLevel))) {
                const quantityAvailable = inventoryNotTracked
                    ? Number.MAX_SAFE_INTEGER
                    : stockLevel.stockOnHand - stockLevel.stockAllocated - effectiveOutOfStockThreshold;
                if (quantityAvailable > 0) {
                    const quantityToAllocate = Math.min(quantity, quantityAvailable);
                    locations.push({
                        location: stockLocation,
                        quantity: quantityToAllocate,
                    });
                    totalAllocated += quantityToAllocate;
                }
            }
            if (totalAllocated >= quantity) {
                break;
            }
        }
        return locations;
    }

    /**
     * @description
     * Determines whether the given StockLevel applies to the active Channel. Uses a cache to avoid
     * repeated DB queries.
     */
    private async stockLevelAppliesToActiveChannel(
        ctx: RequestContext,
        stockLevel: StockLevel,
    ): Promise<boolean> {
        const channelIds = await this.channelIdCache.get(stockLevel.stockLocationId, async () => {
            const stockLocation = await this.connection.getEntityOrThrow(
                ctx,
                StockLocation,
                stockLevel.stockLocationId,
                {
                    relations: {
                        channels: true,
                    },
                },
            );
            return stockLocation.channels.map(c => c.id);
        });
        return channelIds.includes(ctx.channelId);
    }

    private getCacheKey(stockLocationId: ID) {
        return `MultiChannelStockLocationStrategy:StockLocationChannelIds:${stockLocationId}`;
    }

    private getStockLevelsForVariant(ctx: RequestContext, productVariantId: ID): Promise<StockLevel[]> {
        return this.requestContextCache.get(
            ctx,
            `MultiChannelStockLocationStrategy.stockLevels.${productVariantId}`,
            () =>
                this.connection.getRepository(ctx, StockLevel).find({
                    where: {
                        productVariantId,
                    },
                    loadEagerRelations: false,
                }),
        );
    }

    private async getVariantStockSettings(ctx: RequestContext, variant: ProductVariant) {
        const { outOfStockThreshold, trackInventory } = await this.globalSettingsService.getSettings(ctx);

        const inventoryNotTracked =
            variant.trackInventory === GlobalFlag.FALSE ||
            (variant.trackInventory === GlobalFlag.INHERIT && trackInventory === false);
        const effectiveOutOfStockThreshold = variant.useGlobalOutOfStockThreshold
            ? outOfStockThreshold
            : variant.outOfStockThreshold;

        return {
            inventoryNotTracked,
            effectiveOutOfStockThreshold,
        };
    }
}
