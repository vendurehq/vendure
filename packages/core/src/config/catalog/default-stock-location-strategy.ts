import { GlobalFlag } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import type { GlobalSettingsService, StockLevelService } from '../../service/index';

import { RequestContext } from '../../api/common/request-context';
import { InternalServerError } from '../../common/error/errors';
import { Injector } from '../../common/injector';
import { idsAreEqual } from '../../common/utils';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { OrderLine } from '../../entity/order-line/order-line.entity';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';
import { StockLevel } from '../../entity/stock-level/stock-level.entity';
import { StockLocation } from '../../entity/stock-location/stock-location.entity';
import { Allocation } from '../../entity/stock-movement/allocation.entity';

import { AvailableStock, LocationWithQuantity, StockLocationStrategy } from './stock-location-strategy';

export abstract class BaseStockLocationStrategy implements StockLocationStrategy {
    protected connection: TransactionalConnection;
    /** @internal */
    protected injector: Injector;
    /** @internal */
    protected globalSettingsService: GlobalSettingsService;
    /** @internal */
    protected stockLevelService: StockLevelService;

    init(injector: Injector): void | Promise<void> {
        this.injector = injector;
        this.connection = injector.get(TransactionalConnection);
    }

    abstract getAvailableStock(
        ctx: RequestContext,
        productVariantId: ID,
        stockLevels: StockLevel[],
    ): AvailableStock | Promise<AvailableStock>;

    abstract forAllocation(
        ctx: RequestContext,
        stockLocations: StockLocation[],
        orderLine: OrderLine,
        quantity: number,
    ): LocationWithQuantity[] | Promise<LocationWithQuantity[]>;

    async forCancellation(
        ctx: RequestContext,
        stockLocations: StockLocation[],
        orderLine: OrderLine,
        quantity: number,
    ): Promise<LocationWithQuantity[]> {
        return this.getLocationsBasedOnAllocations(ctx, stockLocations, orderLine, quantity);
    }

    async forRelease(
        ctx: RequestContext,
        stockLocations: StockLocation[],
        orderLine: OrderLine,
        quantity: number,
    ): Promise<LocationWithQuantity[]> {
        return this.getLocationsBasedOnAllocations(ctx, stockLocations, orderLine, quantity);
    }

    async forSale(
        ctx: RequestContext,
        stockLocations: StockLocation[],
        orderLine: OrderLine,
        quantity: number,
    ): Promise<LocationWithQuantity[]> {
        return this.getLocationsBasedOnAllocations(ctx, stockLocations, orderLine, quantity);
    }

    /**
     * GlobalSettingsService and StockLevelService are resolved on first use rather than in
     * `init()`. Both have to be imported dynamically to break a circular dependency, and that is
     * asynchronous, while `init()` has to stay synchronous: it is a documented extension point,
     * so a subclass may override it with a synchronous method, and may call `super.init()`
     * without awaiting it. Resolving here means neither leaves a service unset.
     */
    protected async getGlobalSettingsService(): Promise<GlobalSettingsService> {
        if (!this.globalSettingsService) {
            const GlobalSettingsService = (await import('../../service/services/global-settings.service.js'))
                .GlobalSettingsService;
            this.globalSettingsService = this.getInjector().get(GlobalSettingsService);
        }
        return this.globalSettingsService;
    }

    /**
     * See {@link BaseStockLocationStrategy.getGlobalSettingsService} for why this is resolved
     * lazily.
     */
    protected async getStockLevelService(): Promise<StockLevelService> {
        if (!this.stockLevelService) {
            const StockLevelService = (await import('../../service/services/stock-level.service.js'))
                .StockLevelService;
            this.stockLevelService = this.getInjector().get(StockLevelService);
        }
        return this.stockLevelService;
    }

    /**
     * A subclass which overrides `init()` must call `super.init(injector)`, as it already had to
     * for `this.connection`. Saying so beats the TypeError that reaching into an unset Injector
     * would otherwise raise.
     */
    private getInjector(): Injector {
        if (!this.injector) {
            throw new InternalServerError(
                `${this.constructor.name} has no Injector: a StockLocationStrategy which overrides ` +
                    'init() must call super.init(injector).',
            );
        }
        return this.injector;
    }

    /**
     * Resolves the two ProductVariant settings which decide how much of it may be allocated:
     * whether its inventory is tracked at all, and the threshold below which its stock may not
     * fall. Both can defer to the global settings, so both are resolved here rather than read
     * from the ProductVariant directly.
     */
    protected async getVariantStockSettings(
        ctx: RequestContext,
        variant: ProductVariant,
    ): Promise<{ inventoryNotTracked: boolean; effectiveOutOfStockThreshold: number }> {
        const globalSettingsService = await this.getGlobalSettingsService();
        const { outOfStockThreshold, trackInventory } = await globalSettingsService.getSettings(ctx);

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

    private async getLocationsBasedOnAllocations(
        ctx: RequestContext,
        stockLocations: StockLocation[],
        orderLine: OrderLine,
        quantity: number,
    ) {
        const allocations = await this.connection.getRepository(ctx, Allocation).find({
            where: {
                orderLine: { id: orderLine.id },
            },
        });
        let unallocated = quantity;
        const quantityByLocationId = new Map<ID, number>();
        for (const allocation of allocations) {
            if (unallocated <= 0) {
                break;
            }
            const qtyAtLocation = quantityByLocationId.get(allocation.stockLocationId);
            const qtyToAdd = Math.min(allocation.quantity, unallocated);
            if (qtyAtLocation != null) {
                quantityByLocationId.set(allocation.stockLocationId, qtyAtLocation + qtyToAdd);
            } else {
                quantityByLocationId.set(allocation.stockLocationId, qtyToAdd);
            }
            unallocated -= qtyToAdd;
        }
        return [...quantityByLocationId.entries()].map(([locationId, qty]) => ({
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            location: stockLocations.find(l => idsAreEqual(l.id, locationId))!,
            quantity: qty,
        }));
    }
}

/**
 * @description
 * The DefaultStockLocationStrategy was the default implementation of the {@link StockLocationStrategy}
 * prior to the introduction of the {@link MultiChannelStockLocationStrategy}.
 * It assumes only a single StockLocation and that all stock is allocated from that location. When
 * more than one StockLocation or Channel is used, it will not behave as expected.
 *
 * Since 3.7.4, `forAllocation()` caps each allocation at the stock the ProductVariant actually has
 * available, read under a write lock. With the default {@link DefaultStockAllocationStrategy} the
 * saleable stock check runs on the transition to `ArrangingPayment` and the allocation runs on the
 * transition to `PaymentSettled`, in a later request, so another Order can take the stock in
 * between. Before 3.7.4 the allocation went through at the full quantity and oversold the variant.
 * Now the Order which loses that race is allocated less than it ordered, and
 * {@link StockShortfallEvent} reports the shortfall. The customer has already paid at that point,
 * and core neither refunds nor cancels the Order: subscribe to the event to decide what to do.
 *
 * @docsCategory products & stock
 * @since 2.0.0
 */
export class DefaultStockLocationStrategy extends BaseStockLocationStrategy {
    getAvailableStock(ctx: RequestContext, productVariantId: ID, stockLevels: StockLevel[]): AvailableStock {
        let stockOnHand = 0;
        let stockAllocated = 0;
        for (const stockLevel of stockLevels) {
            stockOnHand += stockLevel.stockOnHand;
            stockAllocated += stockLevel.stockAllocated;
        }
        return { stockOnHand, stockAllocated };
    }

    /**
     * @description
     * Allocates from the first StockLocation, capped at the quantity the ProductVariant still has
     * available: `stockOnHand - stockAllocated - outOfStockThreshold`, summed over every
     * StockLevel of the variant, which is the same figure the saleable stock check uses. The
     * StockLevels are read under a write lock, so a concurrent allocation of the same variant
     * waits and then sees this one's result.
     *
     * @since 3.7.4 - The quantity is capped and the StockLevels are read under a lock
     */
    async forAllocation(
        ctx: RequestContext,
        stockLocations: StockLocation[],
        orderLine: OrderLine,
        quantity: number,
    ): Promise<LocationWithQuantity[]> {
        const variant = await this.connection.getEntityOrThrow(
            ctx,
            ProductVariant,
            orderLine.productVariantId,
            { loadEagerRelations: false },
        );
        const { inventoryNotTracked, effectiveOutOfStockThreshold } = await this.getVariantStockSettings(
            ctx,
            variant,
        );
        if (inventoryNotTracked) {
            // Nothing is counted for an untracked variant, so there is nothing to cap it against
            // and no reason to make concurrent checkouts of it wait for each other.
            return [{ location: stockLocations[0], quantity }];
        }
        const stockLevelService = await this.getStockLevelService();
        const stockLevels = await stockLevelService.getLockedStockLevelsForVariant(
            ctx,
            orderLine.productVariantId,
        );
        const { stockOnHand, stockAllocated } = this.getAvailableStock(
            ctx,
            orderLine.productVariantId,
            stockLevels,
        );
        // A negative threshold is a permitted backorder depth, so this stays above
        // `stockOnHand` by exactly that much. A variant with no StockLevel row counts as zero of
        // both figures, which is what the saleable stock check makes of it too.
        const quantityAvailable = stockOnHand - stockAllocated - effectiveOutOfStockThreshold;
        const quantityToAllocate = Math.min(quantity, quantityAvailable);
        if (quantityToAllocate <= 0) {
            return [];
        }
        return [{ location: stockLocations[0], quantity: quantityToAllocate }];
    }
}
