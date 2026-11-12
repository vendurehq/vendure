import {
    composeStrategy,
    Injector,
    PriceCalculationResult,
    ProductVariant,
    ProductVariantBuyerPriceArgs,
    ProductVariantBuyerPriceStrategy,
    RequestContext,
    roundMoney,
    BuyerIdentityService,
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
 * A layer over the {@link ProductVariantBuyerPriceStrategy}:
 *
 * * a fixed unit price for some Customers,
 * * 20% off for a quantity of 10 or more,
 * * the price of {@link BOX_SIZE} units when the pricing data has `unitCode: 'BOX'`. In the cart, the
 *   pricing data is the OrderLine custom fields.
 */
export class TestBuyerPriceLayer extends StrategyLayer.passThrough<ProductVariantBuyerPriceStrategy>() {
    static priority = 100;
    private buyerIdentityService: BuyerIdentityService;

    init(injector: Injector) {
        this.buyerIdentityService = injector.get(BuyerIdentityService);
    }

    async calculateUnitPrice(
        ctx: RequestContext,
        productVariant: ProductVariant,
        args: ProductVariantBuyerPriceArgs,
    ): Promise<PriceCalculationResult> {
        const result = await this.inner.calculateUnitPrice(ctx, productVariant, args);
        let price = result.price;
        const customer = await this.buyerIdentityService.getCustomer(ctx);
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

@VendurePlugin({
    configuration: config => {
        config.catalogOptions.productVariantBuyerPriceStrategy = composeStrategy(
            TestBuyerPriceLayer,
            config.catalogOptions.productVariantBuyerPriceStrategy,
        );
        return config;
    },
})
export class TestBuyerPricePlugin {}
