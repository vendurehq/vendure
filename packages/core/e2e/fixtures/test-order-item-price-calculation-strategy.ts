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
