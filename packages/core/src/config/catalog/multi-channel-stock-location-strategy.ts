import { ID } from '@vendure/common/lib/shared-types';
import ms from 'ms';
import { filter } from 'rxjs/operators';

import { RequestContext } from '../../api/common/request-context';
import { Cache, CacheService, RequestContextCacheService } from '../../cache/index';
import { Injector } from '../../common/injector';
import { OrderLine } from '../../entity/order-line/order-line.entity';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';
import { StockLevel } from '../../entity/stock-level/stock-level.entity';
import { StockLocation } from '../../entity/stock-location/stock-location.entity';
import { ChangeChannelEvent, EventBus, StockLocationEvent } from '../../event-bus/index';
import { Logger } from '../logger/vendure-logger';

import { BaseStockLocationStrategy } from './default-stock-location-strategy';
import { AvailableStock, LocationWithQuantity, StockLocationStrategy } from './stock-location-strategy';

const loggerCtx = 'MultiChannelStockLocationStrategy';

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
    protected requestContextCache: RequestContextCacheService;

    /** @internal */
    async init(injector: Injector) {
        await super.init(injector);
        this.eventBus = injector.get(EventBus);
        this.cacheService = injector.get(CacheService);
        this.requestContextCache = injector.get(RequestContextCacheService);
        this.channelIdCache = this.cacheService.createCache({
            options: {
                ttl: ms('7 days'),
                tags: ['StockLocation'],
            },
            getKey: id => this.getCacheKey(id),
        });

        // When a StockLocation is updated, we need to invalidate the cache.
        // Note: `Cache.delete()` applies the configured `getKey` function itself,
        // so it must be passed the raw id, not the result of `getCacheKey()`.
        this.eventBus
            .ofType(StockLocationEvent)
            .pipe(filter(event => event.type !== 'created'))
            .subscribe(({ entity }) => this.invalidateChannelIdCache(entity.id));

        // Assigning a StockLocation to a Channel (or removing it) does not emit a
        // StockLocationEvent, so we also need to invalidate the cache on ChangeChannelEvents
        // which relate to StockLocations.
        this.eventBus
            .ofType(ChangeChannelEvent)
            .pipe(filter(event => event.entityType === StockLocation))
            .subscribe(({ entity }) => this.invalidateChannelIdCache(entity.id));
    }

    /**
     * @description
     * Returns the available stock for the given ProductVariant, taking into account the active Channel.
     */
    async getAvailableStock(
        ctx: RequestContext,
        productVariantId: ID,
        stockLevels: StockLevel[],
        productVariant?: Pick<ProductVariant, 'id' | 'trackInventory'>,
    ): Promise<AvailableStock> {
        const variant = productVariant ?? (await this.getVariant(ctx, productVariantId));
        const applicable: StockLevel[] = [];
        for (const stockLevel of stockLevels) {
            if (await this.stockLevelAppliesToActiveChannel(ctx, stockLevel)) {
                applicable.push(stockLevel);
            }
        }
        return this.sumStockLevels(ctx, variant, applicable);
    }

    /**
     * @description
     * Allocates from the active Channel's StockLocations, in their order: first from tracked
     * StockLevels, each giving at most `stockOnHand - stockAllocated - outOfStockThreshold`, then
     * whatever is still needed from the first untracked StockLevel. Tracked StockLevels are read
     * under a write lock, so concurrent allocations of the same variant cannot both take the same
     * units.
     *
     * @since 4.0.0 - Tracking is resolved per StockLevel; tracked stock is used before untracked
     */
    async forAllocation(
        ctx: RequestContext,
        stockLocations: StockLocation[],
        orderLine: OrderLine,
        quantity: number,
    ): Promise<LocationWithQuantity[]> {
        const variant = await this.getVariant(ctx, orderLine.productVariantId);
        const { effectiveOutOfStockThreshold } = await this.getVariantStockSettings(ctx, variant);
        const levels = await this.getStockLevelsForAllocation(ctx, variant);
        const inScope: Array<{ level: StockLevel; location: StockLocation; tracked: boolean }> = [];
        for (const entry of this.orderLevelsByLocation(levels, stockLocations)) {
            if (await this.stockLevelAppliesToActiveChannel(ctx, entry.level)) {
                inScope.push(entry);
            }
        }
        const locations: LocationWithQuantity[] = [];
        let remaining = quantity;
        for (const { level, location } of inScope.filter(e => e.tracked)) {
            if (remaining <= 0) {
                break;
            }
            const quantityAvailable = level.stockOnHand - level.stockAllocated - effectiveOutOfStockThreshold;
            const take = Math.min(remaining, quantityAvailable);
            if (take > 0) {
                locations.push({ location, quantity: take, tracked: true });
                remaining -= take;
            }
        }
        const untracked = inScope.find(e => !e.tracked);
        if (remaining > 0 && untracked) {
            locations.push({ location: untracked.location, quantity: remaining, tracked: false });
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
        const channelIds = await this.getChannelIdsForStockLocation(ctx, stockLevel.stockLocationId);
        return channelIds.includes(ctx.channelId);
    }

    private getChannelIdsForStockLocation(ctx: RequestContext, stockLocationId: ID): Promise<ID[]> {
        return this.requestContextCache.get(ctx, this.getCacheKey(stockLocationId), () =>
            this.channelIdCache.get(stockLocationId, async () => {
                const stockLocation = await this.connection.getEntityOrThrow(
                    ctx,
                    StockLocation,
                    stockLocationId,
                    {
                        relations: {
                            channels: true,
                        },
                    },
                );
                return stockLocation.channels.map(c => c.id);
            }),
        );
    }

    // Shared by both caches. They are separate stores, so the key does not collide in either.
    private getCacheKey(stockLocationId: ID) {
        return `MultiChannelStockLocationStrategy:StockLocationChannelIds:${stockLocationId}`;
    }

    /**
     * Invalidation runs in an event subscriber, so there is nothing to await the returned
     * promise. A rejection here would otherwise be silent, leaving the stale channel id list
     * to live out its full TTL.
     */
    private invalidateChannelIdCache(stockLocationId: ID) {
        void this.channelIdCache
            .delete(stockLocationId)
            .catch(err =>
                Logger.error(
                    `Failed to invalidate StockLocation channel id cache for id ${stockLocationId}: ${
                        err instanceof Error ? err.message : String(err)
                    }`,
                    loggerCtx,
                ),
            );
    }
}
