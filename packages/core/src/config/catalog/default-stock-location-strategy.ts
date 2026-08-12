import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';
import { DEFAULT_STOCK_LOCATION_PARTITION_KEY } from '../../common/constants';
import { Injector } from '../../common/injector';
import { idsAreEqual } from '../../common/utils';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { OrderLine } from '../../entity/order-line/order-line.entity';
import { StockLevel } from '../../entity/stock-level/stock-level.entity';
import { StockLocation } from '../../entity/stock-location/stock-location.entity';
import { Allocation } from '../../entity/stock-movement/allocation.entity';

import { AvailableStock, LocationWithQuantity, StockLocationStrategy } from './stock-location-strategy';

export abstract class BaseStockLocationStrategy implements StockLocationStrategy {
    protected connection: TransactionalConnection;

    init(injector: Injector): void | Promise<void> {
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
        const locationKeyMap = new Map<string, { locationId: ID; partitionKey: string; quantity: number }>();
        for (const allocation of allocations) {
            if (unallocated <= 0) {
                break;
            }
            const pk = allocation.partitionKey ?? DEFAULT_STOCK_LOCATION_PARTITION_KEY;
            const key = `${allocation.stockLocationId}:${pk}`;
            const qtyToAdd = Math.min(allocation.quantity, unallocated);
            const existing = locationKeyMap.get(key);
            if (existing) {
                existing.quantity += qtyToAdd;
            } else {
                locationKeyMap.set(key, {
                    locationId: allocation.stockLocationId,
                    partitionKey: pk,
                    quantity: qtyToAdd,
                });
            }
            unallocated -= qtyToAdd;
        }
        return [...locationKeyMap.values()].map(({ locationId, partitionKey, quantity: qty }) => ({
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            location: stockLocations.find(l => idsAreEqual(l.id, locationId))!,
            quantity: qty,
            partitionKey: partitionKey || undefined,
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
 * @docsCategory products & stock
 * @since 2.0.0
 */
export class DefaultStockLocationStrategy extends BaseStockLocationStrategy {
    init(injector: Injector) {
        super.init(injector);
    }

    getAvailableStock(ctx: RequestContext, productVariantId: ID, stockLevels: StockLevel[]): AvailableStock {
        let stockOnHand = 0;
        let stockAllocated = 0;
        for (const stockLevel of stockLevels) {
            stockOnHand += stockLevel.stockOnHand;
            stockAllocated += stockLevel.stockAllocated;
        }
        return { stockOnHand, stockAllocated };
    }

    forAllocation(
        ctx: RequestContext,
        stockLocations: StockLocation[],
        orderLine: OrderLine,
        quantity: number,
    ): LocationWithQuantity[] | Promise<LocationWithQuantity[]> {
        return [{ location: stockLocations[0], quantity }];
    }
}
