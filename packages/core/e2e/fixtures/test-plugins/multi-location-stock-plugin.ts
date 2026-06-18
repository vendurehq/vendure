import {
    AvailableStock,
    DefaultStockLocationStrategy,
    ID,
    idsAreEqual,
    Injector,
    LocationWithQuantity,
    OrderLine,
    PluginCommonModule,
    ProductVariant,
    RequestContext,
    StockDisplayStrategy,
    StockLevel,
    StockLocation,
    TransactionalConnection,
    VendurePlugin,
} from '@vendure/core';

declare module '@vendure/core/dist/entity/custom-entity-fields' {
    interface CustomOrderLineFields {
        stockLocationId?: string;
    }
}

export class TestStockLocationStrategy extends DefaultStockLocationStrategy {
    forAllocation(
        ctx: RequestContext,
        stockLocations: StockLocation[],
        orderLine: OrderLine,
        quantity: number,
    ): LocationWithQuantity[] | Promise<LocationWithQuantity[]> {
        const selectedLocation = stockLocations.find(location =>
            idsAreEqual(location.id, orderLine.customFields.stockLocationId),
        );
        return [{ location: selectedLocation ?? stockLocations[0], quantity }];
    }

    getAvailableStock(ctx: RequestContext, productVariantId: ID, stockLevels: StockLevel[]): AvailableStock {
        const locationId = ctx.req?.query.fromLocation;
        const locationStock =
            locationId &&
            stockLevels.find(level => idsAreEqual(level.stockLocationId, locationId.toString()));
        if (locationStock) {
            return {
                stockOnHand: locationStock.stockOnHand,
                stockAllocated: locationStock.stockAllocated,
            };
        }
        return stockLevels.reduce(
            (all, level) => ({
                stockOnHand: all.stockOnHand + level.stockOnHand,
                stockAllocated: all.stockAllocated + level.stockAllocated,
            }),
            { stockOnHand: 0, stockAllocated: 0 },
        );
    }
}

export class TestStockDisplayStrategy implements StockDisplayStrategy {
    getStockLevel(ctx: RequestContext, productVariant: ProductVariant, saleableStockLevel: number) {
        return saleableStockLevel.toString();
    }
}

@VendurePlugin({
    imports: [PluginCommonModule],
    configuration: config => {
        config.catalogOptions.stockLocationStrategy = new TestStockLocationStrategy();
        config.catalogOptions.stockDisplayStrategy = new TestStockDisplayStrategy();
        config.customFields.OrderLine.push({ name: 'stockLocationId', type: 'string', nullable: true });
        return config;
    },
})
export class TestMultiLocationStockPlugin {}
