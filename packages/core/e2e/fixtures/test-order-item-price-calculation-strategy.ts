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
    calculateLinePrice(
        ctx: RequestContext,
        productVariant: ProductVariant,
        customFields: { [key: string]: any },
        order: Order,
        quantity: number,
    ): PriceCalculationResult | undefined {
        if (customFields.giftWrap && quantity >= 10) {
            return { price: Math.round((1010 * 95 * quantity) / 100), priceIncludesTax: true };
        }
    }

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
