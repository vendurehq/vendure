import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';
import { InjectableStrategy } from '../../common/types/injectable-strategy';
import { OrderLine } from '../../entity/order-line/order-line.entity';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';
import { StockLevel } from '../../entity/stock-level/stock-level.entity';
import { StockLocation } from '../../entity/stock-location/stock-location.entity';

/**
 * @description
 * The overall available stock for a ProductVariant as determined by the logic of the
 * {@link StockLocationStrategy}'s `getAvailableStock` method.
 *
 * @docsCategory products & stock
 * @since 2.0.0
 * @docsPage StockLocationStrategy
 */
export interface AvailableStock {
    /**
     * @description
     * The stockOnHand summed over the StockLevels which count towards the available stock.
     */
    stockOnHand: number;
    stockAllocated: number;
    /**
     * @description
     * True when at least one StockLevel which counts towards the available stock does not track
     * inventory (or when there is no such StockLevel and the ProductVariant does not track
     * inventory in the active Channel). The ProductVariant can then be sold without limit.
     *
     * When a strategy leaves this undefined, core falls back to the ProductVariant/Channel
     * setting, which is the pre-v4 behaviour.

     *
     * @since 4.0.0
     */
    hasUntrackedStock?: boolean;
}

/**
 * @description
 * Returned by the `StockLocationStrategy` methods to indicate how much stock from each
 * location should be used in the allocation/sale/release/cancellation of an OrderLine.
 *
 * @docsCategory products & stock
 * @since 2.0.0
 * @docsPage StockLocationStrategy
 */
export interface LocationWithQuantity {
    location: StockLocation;
    quantity: number;
    /**
     * @description
     * Whether this quantity is tracked inventory, as decided by the strategy when it chose the
     * location. Recorded on the resulting {@link Allocation}. When omitted, core resolves it
     * for the ProductVariant at this location with `isInventoryTracked`.
     *
     * @since 4.0.0
     */
    tracked?: boolean;
}

/**
 * @description
 * The StockLocationStrategy is responsible for determining which {@link StockLocation}s
 * should be used to fulfill an {@link OrderLine} and how much stock should be allocated
 * from each location. It is also used to determine the available stock for a given
 * {@link ProductVariant}.
 *
 * :::info
 *
 * This is configured via the `catalogOptions.stockLocationStrategy` property of
 * your VendureConfig.
 *
 * :::
 *
 * @docsCategory products & stock
 * @docsWeight 0
 * @since 2.0.0
 */
export interface StockLocationStrategy extends InjectableStrategy {
    /**
     * @description
     * Decides whether inventory is tracked for the ProductVariant, at the given StockLevel when one
     * is passed, in the context of the active Channel. Stock movement bookkeeping (whether an
     * Allocation, Sale, Release or Cancellation changes the StockLevel figures) follows this.
     *
     * When not implemented, core uses {@link resolveTrackInventory}: StockLevel, then
     * ProductVariant, then Channel.
     *
     * The arguments are deliberately minimal, because this is called on hot paths (locking,
     * saleable stock of every variant in a list):
     * - `productVariant` carries at least `id` and `trackInventory`. Other columns, custom fields
     *   and relations may not be loaded; load them yourself if your rule needs them.
     * - `stockLevel` has its columns but no relations (`stockLocation` is not loaded; use
     *   `stockLevel.stockLocationId`).
     * - `ctx.channel` is the Channel whose rules apply: for anything to do with an Order, the
     *   Order's own Channel, even when an Administrator acts from another Channel.
     *
     * @since 4.0.0
     */
    isInventoryTracked?(
        ctx: RequestContext,
        productVariant: Pick<ProductVariant, 'id' | 'trackInventory'> & Partial<ProductVariant>,
        stockLevel?: StockLevel,
    ): boolean | Promise<boolean>;

    /**
     * @description
     * Returns the available stock for the given ProductVariant, taking into account
     * the stock levels at each StockLocation.
     *
     * `productVariant` is passed by core (batched, carrying at least `id` and `trackInventory`)
     * so that implementations need not load it. Callers written before v4.0 omit it.
     *
     * @since 4.0.0 - The `productVariant` parameter
     */
    getAvailableStock(
        ctx: RequestContext,
        productVariantId: ID,
        stockLevels: StockLevel[],
        productVariant?: Pick<ProductVariant, 'id' | 'trackInventory'>,
    ): AvailableStock | Promise<AvailableStock>;

    /**
     * @description
     * Determines which StockLocations should be used to when allocating stock when
     * and Order is placed.
     */
    forAllocation(
        ctx: RequestContext,
        stockLocations: StockLocation[],
        orderLine: OrderLine,
        quantity: number,
    ): LocationWithQuantity[] | Promise<LocationWithQuantity[]>;

    /**
     * @description
     * Determines which StockLocations should be used to when releasing allocated
     * stock when an OrderLine is cancelled before being fulfilled.
     */
    forRelease(
        ctx: RequestContext,
        stockLocations: StockLocation[],
        orderLine: OrderLine,
        quantity: number,
    ): LocationWithQuantity[] | Promise<LocationWithQuantity[]>;

    /**
     * @description
     * Determines which StockLocations should be used to when creating a Sale
     * and reducing the stockOnHand upon fulfillment.
     */
    forSale(
        ctx: RequestContext,
        stockLocations: StockLocation[],
        orderLine: OrderLine,
        quantity: number,
    ): LocationWithQuantity[] | Promise<LocationWithQuantity[]>;

    /**
     * @description
     * Determines which StockLocations should be used to when creating a Cancellation
     * of an OrderLine which has already been fulfilled.
     */
    forCancellation(
        ctx: RequestContext,
        stockLocations: StockLocation[],
        orderLine: OrderLine,
        quantity: number,
    ): LocationWithQuantity[] | Promise<LocationWithQuantity[]>;
}
