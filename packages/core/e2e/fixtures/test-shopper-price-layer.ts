import {
    composeStrategy,
    Injector,
    Order,
    OrderItemPriceCalculationStrategy,
    PriceCalculationResult,
    ProductVariant,
    ProductVariantShopperPriceArgs,
    ProductVariantShopperPriceStrategy,
    RequestContext,
    roundMoney,
    ShopperIdentityService,
    StrategyLayer,
    VendurePlugin,
} from '@vendure/core';

export const FIXED_UNIT_PRICE = 1234;

/** The number of units in the `BOX` packaging unit. */
export const BOX_SIZE = 6;

/**
 * The email addresses of the Customers whose unit price is always {@link FIXED_UNIT_PRICE}. The test sets them.
 */
export const fixedPriceEmailAddresses = new Set<string>();

/**
 * A layer over the {@link ProductVariantShopperPriceStrategy}:
 *
 * * a fixed unit price for some Customers,
 * * 20% off for a quantity of 10 or more,
 * * the price of {@link BOX_SIZE} units when the pricing data has `unitCode: 'BOX'`.
 */
export class TestShopperPriceLayer extends StrategyLayer.passThrough<ProductVariantShopperPriceStrategy>() {
    static priority = 100;
    private shopperIdentityService: ShopperIdentityService;

    init(injector: Injector) {
        this.shopperIdentityService = injector.get(ShopperIdentityService);
    }

    async calculateUnitPrice(
        ctx: RequestContext,
        productVariant: ProductVariant,
        args: ProductVariantShopperPriceArgs,
    ): Promise<PriceCalculationResult> {
        const result = await this.inner.calculateUnitPrice(ctx, productVariant, args);
        let price = result.price;
        const customer = await this.shopperIdentityService.getCustomer(ctx);
        if (customer && fixedPriceEmailAddresses.has(customer.emailAddress)) {
            price = FIXED_UNIT_PRICE;
        }
        if (args.quantity >= 10) {
            price = roundMoney(price * 0.8);
        }
        if (args.data?.unitCode === 'BOX') {
            price = price * BOX_SIZE;
        }
        // Writes to the variant, so that a test can check that the shared entity does not change.
        productVariant.listPrice = price;
        return { ...result, price };
    }
}

/**
 * A layer over the {@link OrderItemPriceCalculationStrategy} that gives the OrderLine custom field
 * `unitCode` to the shopper price strategy as pricing data.
 */
export class UnitCodePriceDataLayer extends StrategyLayer.passThrough<OrderItemPriceCalculationStrategy>() {
    static priority = 100;

    async getShopperPriceData(
        ctx: RequestContext,
        orderLineCustomFields: { [key: string]: any },
        order: Order,
    ): Promise<Record<string, unknown>> {
        const data = await this.inner.getShopperPriceData?.(ctx, orderLineCustomFields, order);
        return { ...data, unitCode: orderLineCustomFields.unitCode };
    }
}

@VendurePlugin({
    configuration: config => {
        config.catalogOptions.productVariantShopperPriceStrategy = composeStrategy(
            TestShopperPriceLayer,
            config.catalogOptions.productVariantShopperPriceStrategy,
        );
        config.orderOptions.orderItemPriceCalculationStrategy = composeStrategy(
            UnitCodePriceDataLayer,
            config.orderOptions.orderItemPriceCalculationStrategy,
        );
        return config;
    },
})
export class TestShopperPricePlugin {}
