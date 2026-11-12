import {
    PriceCalculationResult,
    ProductVariant,
    ProductVariantShopperPriceArgs,
    ProductVariantShopperPriceStrategy,
    RequestContext,
    roundMoney,
    StrategyLayer,
} from '@vendure/core';

export const FIXED_UNIT_PRICE = 1234;

/** The number of units in the `BOX` packaging unit. */
export const BOX_SIZE = 6;

/**
 * The email address of the Customer whose unit price is always {@link FIXED_UNIT_PRICE}. The test sets it.
 */
export const fixedPriceCustomer = { emailAddress: '' };

/**
 * A layer over the {@link ProductVariantShopperPriceStrategy}:
 *
 * * a fixed unit price for one Customer,
 * * 20% off for a quantity of 10 or more,
 * * the price of {@link BOX_SIZE} units when the OrderLine custom field `unitCode` is `BOX`.
 */
export class TestShopperPriceLayer extends StrategyLayer.passThrough<ProductVariantShopperPriceStrategy>() {
    static priority = 100;

    async calculateUnitPrice(
        ctx: RequestContext,
        productVariant: ProductVariant,
        args: ProductVariantShopperPriceArgs,
    ): Promise<PriceCalculationResult> {
        const result = await this.inner.calculateUnitPrice(ctx, productVariant, args);
        let price = result.price;
        const customer = await args.getCustomer();
        if (fixedPriceCustomer.emailAddress && customer?.emailAddress === fixedPriceCustomer.emailAddress) {
            price = FIXED_UNIT_PRICE;
        }
        if (args.quantity >= 10) {
            price = roundMoney(price * 0.8);
        }
        if (args.orderLineCustomFields.unitCode === 'BOX') {
            price = price * BOX_SIZE;
        }
        // Writes to the variant, so that a test can check that the shared entity does not change.
        productVariant.listPrice = price;
        return { ...result, price };
    }
}
