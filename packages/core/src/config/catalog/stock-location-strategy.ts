import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';
import { InjectableStrategy } from '../../common/types/injectable-strategy';
import { OrderLine } from '../../entity/order-line/order-line.entity';
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
    stockOnHand: number;
    stockAllocated: number;
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
     * Returns the available stock for the given ProductVariant, taking into account
     * the stock levels at each StockLocation.
     */
    getAvailableStock(
        ctx: RequestContext,
        productVariantId: ID,
        stockLevels: StockLevel[],
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
