import {
    Order,
    OrderItemPriceCalculationStrategy,
    PriceCalculationResult,
    ProductVariant,
    RequestContext,
    roundMoney,
} from '@vendure/core';

export const FIXED_UNIT_PRICE = 1234;

/**
 * The identifier of the User whose unit price is always {@link FIXED_UNIT_PRICE}. The test sets it.
 */
export const fixedPriceUser = { identifier: '' };

/**
 * The quantities and orders that the strategy received, in the order of the calls.
 */
export const calculatedPriceStrategyCalls: Array<{ quantity: number; hasOrder: boolean }> = [];

/**
 * Gives a fixed unit price to one customer, and 20% off for a quantity of 10 or more.
 */
export class TestCalculatedPriceStrategy implements OrderItemPriceCalculationStrategy {
    calculateUnitPrice(
        ctx: RequestContext,
        productVariant: ProductVariant,
        orderLineCustomFields: { [key: string]: any },
        order: Order | undefined,
        quantity: number,
    ): PriceCalculationResult {
        calculatedPriceStrategyCalls.push({ quantity, hasOrder: order !== undefined });
        let price = productVariant.listPrice;
        if (fixedPriceUser.identifier && ctx.session?.user?.identifier === fixedPriceUser.identifier) {
            price = FIXED_UNIT_PRICE;
        }
        if (quantity >= 10) {
            price = roundMoney(price * 0.8);
        }
        // Writes to the variant, so that a test can check that the shared entity does not change.
        productVariant.listPrice = price;
        return { price, priceIncludesTax: productVariant.listPriceIncludesTax };
    }
}
