import { ID } from '@vendure/common/lib/shared-types';
import { unique } from '@vendure/common/lib/unique';
import { FindOptionsWhere } from 'typeorm';
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
import { Cancellation } from '../../entity/stock-movement/cancellation.entity';
import { Release } from '../../entity/stock-movement/release.entity';
import { Sale } from '../../entity/stock-movement/sale.entity';
import { StockMovement } from '../../entity/stock-movement/stock-movement.entity';
import { Logger } from '../logger/vendure-logger';

import { AvailableStock, LocationWithQuantity, StockLocationStrategy } from './stock-location-strategy';
import { resolveTrackInventory } from './track-inventory';

const loggerCtx = 'StockLocationStrategy';

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
        return this.getLocationsFromLedger(ctx, stockLocations, orderLine, quantity, 'sold');
    }

    async forRelease(
        ctx: RequestContext,
        stockLocations: StockLocation[],
        orderLine: OrderLine,
        quantity: number,
    ): Promise<LocationWithQuantity[]> {
        return this.getLocationsFromLedger(ctx, stockLocations, orderLine, quantity, 'allocated');
    }

    async forSale(
        ctx: RequestContext,
        stockLocations: StockLocation[],
        orderLine: OrderLine,
        quantity: number,
    ): Promise<LocationWithQuantity[]> {
        return this.getLocationsFromLedger(ctx, stockLocations, orderLine, quantity, 'allocated');
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
     * (see {@link resolveTrackInventory}). Override to apply other rules. See
     * {@link StockLocationStrategy}`.isInventoryTracked` for what the arguments carry.
     *
     * @since 4.0.0
     */
    isInventoryTracked(
        ctx: RequestContext,
        productVariant: Pick<ProductVariant, 'id' | 'trackInventory'> & Partial<ProductVariant>,
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
     * Resolves `isInventoryTracked` for each StockLevel. Stays synchronous when the resolution is
     * (the default), so `getAvailableStock` can too.
     *
     * @since 4.0.0
     */
    protected resolveTracking(
        ctx: RequestContext,
        variant: Pick<ProductVariant, 'id' | 'trackInventory'>,
        stockLevels: StockLevel[],
    ): boolean[] | Promise<boolean[]> {
        const results = stockLevels.map(level => this.isInventoryTracked(ctx, variant, level));
        return results.some(r => r instanceof Promise)
            ? Promise.all(results.map(r => Promise.resolve(r)))
            : (results as boolean[]);
    }

    /**
     * @description
     * Sums the given StockLevels and reports whether any of them does not track inventory. When
     * there are no StockLevels, the ProductVariant and Channel settings decide whether the variant
     * is untracked. Untracked levels are still summed: the Admin API's stockOnHand/stockAllocated
     * show them, and consumers checking available stock short-circuit on `hasUntrackedStock`.
     *
     * @since 4.0.0
     */
    protected sumStockLevels(
        ctx: RequestContext,
        variant: Pick<ProductVariant, 'id' | 'trackInventory'>,
        stockLevels: StockLevel[],
    ): Required<AvailableStock> | Promise<Required<AvailableStock>> {
        const sum = (levelsTracked: boolean[], isVariantTracked: boolean): Required<AvailableStock> => {
            let stockOnHand = 0;
            let stockAllocated = 0;
            for (const level of stockLevels) {
                stockOnHand += level.stockOnHand;
                stockAllocated += level.stockAllocated;
            }
            const hasUntrackedStock = stockLevels.length ? levelsTracked.includes(false) : !isVariantTracked;
            return { stockOnHand, stockAllocated, hasUntrackedStock };
        };
        const tracked = this.resolveTracking(ctx, variant, stockLevels);
        const variantTracked = stockLevels.length ? true : this.isInventoryTracked(ctx, variant);
        if (tracked instanceof Promise || variantTracked instanceof Promise) {
            return (async () => sum(await tracked, await variantTracked))();
        }
        return sum(tracked, variantTracked);
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
        const tracked = await this.resolveTracking(ctx, variant, unlocked);
        if (!tracked.includes(true)) {
            return unlocked;
        }
        const stockLevelService = await this.getStockLevelService();
        return stockLevelService.getLockedStockLevelsForVariant(ctx, variant.id);
    }

    /**
     * @description
     * The StockLevels (with their resolved tracking) whose location is one of `stockLocations`,
     * in the order of `stockLocations`, so that allocation is deterministic.
     *
     * @since 4.0.0
     */
    protected async orderLevelsByLocation(
        ctx: RequestContext,
        variant: ProductVariant,
        stockLevels: StockLevel[],
        stockLocations: StockLocation[],
    ): Promise<Array<{ level: StockLevel; location: StockLocation; tracked: boolean }>> {
        const tracked = await this.resolveTracking(ctx, variant, stockLevels);
        const result: Array<{ level: StockLevel; location: StockLocation; tracked: boolean }> = [];
        for (const location of stockLocations) {
            const index = stockLevels.findIndex(l => idsAreEqual(l.stockLocationId, location.id));
            if (index !== -1) {
                result.push({ level: stockLevels[index], location, tracked: tracked[index] });
            }
        }
        return result;
    }

    /**
     * Resolves the ProductVariant setting which decides how much of it may be allocated: the
     * threshold below which its stock may not fall.
     *
     * `inventoryNotTracked` is the variant/Channel-level setting only. It ignores StockLevel
     * overrides, so it does not say whether a given allocation is tracked.
     *
     * @deprecated since 4.0.0, `inventoryNotTracked`: use `isInventoryTracked()` per StockLevel.
     */
    protected async getVariantStockSettings(
        ctx: RequestContext,
        variant: ProductVariant,
    ): Promise<{ inventoryNotTracked: boolean; effectiveOutOfStockThreshold: number }> {
        const globalSettingsService = await this.getGlobalSettingsService();
        const { outOfStockThreshold } = await globalSettingsService.getSettings(ctx);
        const effectiveOutOfStockThreshold = variant.useGlobalOutOfStockThreshold
            ? outOfStockThreshold
            : variant.outOfStockThreshold;
        return {
            get inventoryNotTracked() {
                // Kept for subclasses written before v4.0. Resolved with the default rule, as the
                // getter cannot await an overridden asynchronous isInventoryTracked().
                return !resolveTrackInventory({
                    variant: variant.trackInventory,
                    channel: ctx.channel.trackInventory,
                });
            },
            effectiveOutOfStockThreshold,
        };
    }

    /**
     * Picks the locations to release, sell or cancel from, using what is still outstanding at each
     * location for this OrderLine:
     * - `allocated` (release, sale): Allocations minus Releases minus Sales
     * - `sold` (cancellation): Sales minus Cancellations, never more than was allocated there
     *
     * Before v4.0 this looked at the Allocations only, so after a partial fulfilment of a line
     * split across locations, the remaining units could be released from a location which had
     * already sold them, leaving the other location's stockAllocated behind.
     *
     * Movements recorded before v4.0 on a line split across locations carry the whole line
     * quantity at each location. Capping what was sold at a location by what was allocated there
     * keeps those from sending a cancellation to the wrong location.
     *
     * @since 4.0.0
     */
    protected async getLocationsFromLedger(
        ctx: RequestContext,
        stockLocations: StockLocation[],
        orderLine: OrderLine,
        quantity: number,
        mode: 'allocated' | 'sold',
    ): Promise<LocationWithQuantity[]> {
        const where: FindOptionsWhere<Allocation> = { orderLine: { id: orderLine.id } };
        const order = { id: 'ASC' } as const;
        // Sequential rather than Promise.all: one connection per transaction.
        const allocations = await this.connection.getRepository(ctx, Allocation).find({ where, order });
        const releases = await this.connection
            .getRepository(ctx, Release)
            .find({ where: where as FindOptionsWhere<Release> });
        const sales = await this.connection
            .getRepository(ctx, Sale)
            .find({ where: where as FindOptionsWhere<Sale>, order });
        const cancellations = await this.connection
            .getRepository(ctx, Cancellation)
            .find({ where: where as FindOptionsWhere<Cancellation> });

        const sumByLocation = (rows: StockMovement[]) => {
            const map = new Map<string, number>();
            for (const row of rows) {
                const key = String(row.stockLocationId);
                map.set(key, (map.get(key) ?? 0) + Math.abs(row.quantity));
            }
            return map;
        };
        const allocated = sumByLocation(allocations);
        const released = sumByLocation(releases);
        const sold = sumByLocation(sales);
        const cancelled = sumByLocation(cancellations);
        const outstandingAt = (key: string) =>
            mode === 'allocated'
                ? (allocated.get(key) ?? 0) - (released.get(key) ?? 0) - (sold.get(key) ?? 0)
                : Math.min(sold.get(key) ?? 0, allocated.get(key) ?? 0) - (cancelled.get(key) ?? 0);

        // Locations in the order the line first used them.
        const locationOrder = unique(
            (mode === 'allocated' ? allocations : sales).map(row => String(row.stockLocationId)),
        );
        const result: LocationWithQuantity[] = [];
        let remaining = quantity;
        for (const locationId of locationOrder) {
            if (remaining <= 0) {
                break;
            }
            const take = Math.min(Math.max(0, outstandingAt(locationId)), remaining);
            const location = stockLocations.find(l => idsAreEqual(l.id, locationId));
            if (take > 0 && location) {
                result.push({ location, quantity: take });
                remaining -= take;
            }
        }
        if (remaining > 0) {
            Logger.warn(
                `OrderLine ${String(orderLine.id)}: ${remaining} of ${quantity} unit(s) have no ` +
                    `outstanding ${mode === 'allocated' ? 'allocation' : 'sale'} at any StockLocation ` +
                    'of the active Channel, so no stock movement is recorded for them',
                loggerCtx,
            );
        }
        return result;
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
    /**
     * @description
     * Sums every StockLevel of the variant. Synchronous when `productVariant` is passed (core
     * always passes it) and tracking resolves synchronously.
     *
     * @since 4.0.0 - Accepts `productVariant` and reports `hasUntrackedStock`
     */
    getAvailableStock(
        ctx: RequestContext,
        productVariantId: ID,
        stockLevels: StockLevel[],
        productVariant?: Pick<ProductVariant, 'id' | 'trackInventory'>,
    ): AvailableStock | Promise<AvailableStock> {
        if (productVariant) {
            return this.sumStockLevels(ctx, productVariant, stockLevels);
        }
        return this.getVariant(ctx, productVariantId).then(variant =>
            this.sumStockLevels(ctx, variant, stockLevels),
        );
    }

    /**
     * @description
     * Allocates tracked stock first, then sends what is left to an untracked StockLevel.
     *
     * Tracked: capped at the quantity the ProductVariant still has available,
     * `stockOnHand - stockAllocated - outOfStockThreshold` summed over its tracked StockLevels (the
     * figure the saleable stock check uses), and allocated at the first tracked StockLevel's
     * location (or the first StockLocation). The StockLevels are read under a write lock, so a
     * concurrent allocation of the same variant waits and then sees this one's result.
     *
     * Untracked: the remainder goes, without a cap, to the first untracked StockLevel whose
     * location is one of `stockLocations`. Locations are taken in the order of `stockLocations`.
     *
     * @since 3.7.4 - The quantity is capped and the StockLevels are read under a lock
     * @since 4.0.0 - Tracked stock first, untracked StockLevels take the overflow
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
        if (!stockLevels.length && !(await this.isInventoryTracked(ctx, variant))) {
            // Nothing is counted for an untracked variant, so there is nothing to cap it against.
            return [{ location: stockLocations[0], quantity, tracked: false }];
        }
        const tracked = await this.resolveTracking(ctx, variant, stockLevels);
        const trackedLevels = stockLevels.filter((_, i) => tracked[i]);
        const inScope = await this.orderLevelsByLocation(ctx, variant, stockLevels, stockLocations);
        const result: LocationWithQuantity[] = [];
        let remaining = quantity;

        // A variant with no StockLevel at all is tracked here (checked above), and counts as zero
        // of both figures, which is what the saleable stock check makes of it too.
        if (trackedLevels.length || !stockLevels.length) {
            const stockOnHand = trackedLevels.reduce((sum, l) => sum + l.stockOnHand, 0);
            const stockAllocated = trackedLevels.reduce((sum, l) => sum + l.stockAllocated, 0);
            // A negative threshold is a permitted backorder depth, so this stays above
            // `stockOnHand` by exactly that much.
            const quantityAvailable = stockOnHand - stockAllocated - effectiveOutOfStockThreshold;
            const take = Math.min(remaining, quantityAvailable);
            if (take > 0) {
                const location = inScope.find(l => l.tracked)?.location ?? stockLocations[0];
                result.push({ location, quantity: take, tracked: true });
                remaining -= take;
            }
        }
        const untracked = inScope.find(l => !l.tracked);
        if (remaining > 0 && untracked) {
            result.push({ location: untracked.location, quantity: remaining, tracked: false });
        }
        return result;
    }
}
