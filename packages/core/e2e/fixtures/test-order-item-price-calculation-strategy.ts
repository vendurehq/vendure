import {
    PriceCalculationResult,
    Order,
    OrderItemPriceCalculationStrategy,
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
    calculateLinePrice(
        ctx: RequestContext,
        productVariant: ProductVariant,
        customFields: { [key: string]: any },
        order: Order,
        quantity: number,
    ): PriceCalculationResult | undefined {
        if (customFields.giftWrap && quantity >= 10) {
            // Lines below 20 units pay a fixed fee, so a new quote differs from a scaled one.
            const fee = quantity < 20 ? 100 : 0;
            return { price: Math.round((1010 * 95 * quantity) / 100) + fee, priceIncludesTax: true };
        }
    }
}
