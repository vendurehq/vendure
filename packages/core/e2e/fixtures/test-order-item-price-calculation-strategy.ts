import {
    LinePriceCalculationInput,
    Order,
    OrderItemPriceCalculationStrategy,
    PriceCalculationResult,
    ProductVariant,
    RequestContext,
    roundMoney,
} from '@vendure/core';

/**
 * Adds $5 for items with gift wrapping, halves the price when buying 3 or more
 */
export class TestOrderItemPriceCalculationStrategy implements OrderItemPriceCalculationStrategy {
    calculateUnitPrice(
        ctx: RequestContext,
        productVariant: ProductVariant,
        orderLineCustomFields: { [p: string]: any },
        order: Order,
        quantity: number,
    ): PriceCalculationResult | Promise<PriceCalculationResult> {
        let price = productVariant.price;
        if (orderLineCustomFields.giftWrap) {
            price += 500;
        }
        if (quantity > 3) {
            price = roundMoney(price / 2);
        }
        return {
            price,
            priceIncludesTax: productVariant.listPriceIncludesTax,
        };
    }
}

export class TestQuotedLinePriceStrategy extends TestOrderItemPriceCalculationStrategy {
    /** The number of lines in each call, so tests can check that the lines are priced together. */
    static calls: number[] = [];

    calculateLinePrices(
        ctx: RequestContext,
        order: Order,
        lines: LinePriceCalculationInput[],
    ): Array<PriceCalculationResult | undefined> {
        TestQuotedLinePriceStrategy.calls.push(lines.length);
        return lines.map(({ orderLineCustomFields, quantity }) => {
            if (orderLineCustomFields.giftWrap && quantity >= 10) {
                // Lines below 20 units pay a fixed fee, so a new quote differs from a scaled one.
                const fee = quantity < 20 ? 100 : 0;
                return { price: Math.round((1010 * 95 * quantity) / 100) + fee, priceIncludesTax: true };
            }
            return undefined;
        });
    }
}
