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
import { resolveTrackInventory } from './track-inventory';

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
     * @description
     * Decides whether inventory is tracked for the ProductVariant, at the given StockLevel when one
     * is passed. The default resolves StockLevel, then ProductVariant, then the active Channel
     * (see {@link resolveTrackInventory}). Override to apply other rules, e.g. based on custom
     * fields of the StockLocation or Channel.
     *
     * @since 4.0.0
     */
    isInventoryTracked(
        ctx: RequestContext,
        productVariant: ProductVariant,
        stockLevel?: StockLevel,
    ): boolean | Promise<boolean> {
        return resolveTrackInventory({
            stockLevel: stockLevel?.trackInventory,
            variant: productVariant.trackInventory,
            channel: ctx.channel.trackInventory,
        });
    }

    /**
     * @description
     * Splits the given StockLevels into the figures counted towards available stock and whether
     * any of them does not track inventory. When there are no StockLevels, the ProductVariant and
     * Channel settings decide whether the variant is untracked.
     *
     * @since 4.0.0
     */
    protected async sumStockLevels(
        ctx: RequestContext,
        variant: ProductVariant,
        stockLevels: StockLevel[],
    ): Promise<Required<AvailableStock>> {
        let stockOnHand = 0;
        let stockAllocated = 0;
        let hasUntrackedStock = false;
        for (const stockLevel of stockLevels) {
            if (await this.isInventoryTracked(ctx, variant, stockLevel)) {
                stockOnHand += stockLevel.stockOnHand;
                stockAllocated += stockLevel.stockAllocated;
            } else {
                hasUntrackedStock = true;
            }
        }
        if (!stockLevels.length && !(await this.isInventoryTracked(ctx, variant))) {
            hasUntrackedStock = true;
        }
        return { stockOnHand, stockAllocated, hasUntrackedStock };
    }

    protected getVariant(ctx: RequestContext, productVariantId: ID): Promise<ProductVariant> {
        return this.connection.getEntityOrThrow(ctx, ProductVariant, productVariantId, {
            loadEagerRelations: false,
            includeSoftDeleted: true,
        });
    }

    /**
     * Reads the variant's StockLevels, with a write lock only if at least one of them tracks
     * inventory. Untracked stock is never capped, so there is no reason to make concurrent
     * checkouts of it wait for each other.
     */
    protected async getStockLevelsForAllocation(
        ctx: RequestContext,
        variant: ProductVariant,
    ): Promise<StockLevel[]> {
        const unlocked = await this.connection.getRepository(ctx, StockLevel).find({
            where: { productVariantId: variant.id },
            loadEagerRelations: false,
        });
        let anyTracked = false;
        for (const level of unlocked) {
            if (await this.isInventoryTracked(ctx, variant, level)) {
                anyTracked = true;
                break;
            }
        }
        if (!anyTracked) {
            return unlocked;
        }
        const stockLevelService = await this.getStockLevelService();
        return stockLevelService.getLockedStockLevelsForVariant(ctx, variant.id);
    }

    /**
     * Resolves the two ProductVariant settings which decide how much of it may be allocated:
     * whether its inventory is tracked in the active Channel (ignoring StockLevel overrides),
     * and the threshold below which its stock may not fall.
     */
    protected async getVariantStockSettings(
        ctx: RequestContext,
        variant: ProductVariant,
    ): Promise<{ inventoryNotTracked: boolean; effectiveOutOfStockThreshold: number }> {
        const globalSettingsService = await this.getGlobalSettingsService();
        const { outOfStockThreshold } = await globalSettingsService.getSettings(ctx);

        const inventoryNotTracked = !(await this.isInventoryTracked(ctx, variant));
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
    async getAvailableStock(
        ctx: RequestContext,
        productVariantId: ID,
        stockLevels: StockLevel[],
    ): Promise<AvailableStock> {
        const variant = await this.getVariant(ctx, productVariantId);
        return this.sumStockLevels(ctx, variant, stockLevels);
    }

    /**
     * @description
     * Allocates from the first StockLocation, capped at the quantity the ProductVariant still has
     * available: `stockOnHand - stockAllocated - outOfStockThreshold`, summed over every tracked
     * StockLevel of the variant, which is the same figure the saleable stock check uses. The
     * StockLevels are read under a write lock, so a concurrent allocation of the same variant
     * waits and then sees this one's result.
     *
     * If the variant has a StockLevel which does not track inventory, the whole quantity is
     * allocated from that StockLevel's location without a cap.
     *
     * @since 3.7.4 - The quantity is capped and the StockLevels are read under a lock
     * @since 4.0.0 - Untracked StockLevels are allocated from without a cap
     */
    async forAllocation(
        ctx: RequestContext,
        stockLocations: StockLocation[],
        orderLine: OrderLine,
        quantity: number,
    ): Promise<LocationWithQuantity[]> {
        const variant = await this.getVariant(ctx, orderLine.productVariantId);
        const { effectiveOutOfStockThreshold } = await this.getVariantStockSettings(ctx, variant);
        const stockLevels = await this.getStockLevelsForAllocation(ctx, variant);
        for (const stockLevel of stockLevels) {
            if (!(await this.isInventoryTracked(ctx, variant, stockLevel))) {
                const location =
                    stockLocations.find(l => idsAreEqual(l.id, stockLevel.stockLocationId)) ??
                    stockLocations[0];
                return [{ location, quantity }];
            }
        }
        if (!stockLevels.length && !(await this.isInventoryTracked(ctx, variant))) {
            // Nothing is counted for an untracked variant, so there is nothing to cap it against.
            return [{ location: stockLocations[0], quantity }];
        }
        const { stockOnHand, stockAllocated } = await this.sumStockLevels(ctx, variant, stockLevels);
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
