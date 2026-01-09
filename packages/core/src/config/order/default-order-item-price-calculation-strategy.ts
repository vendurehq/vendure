/* eslint-disable */
import { RequestContext } from '../../api/common/request-context';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';

import { OrderItemPriceCalculationStrategy } from './order-item-price-calculation-strategy';

/**
 * @description
 * The default {@link OrderItemPriceCalculationStrategy}, which simply passes through the price of
 * the ProductVariant without performing any calculations
 *
 * @docsCategory orders
 */
export class DefaultOrderItemPriceCalculationStrategy implements OrderItemPriceCalculationStrategy {
    calculateUnitPrice(ctx: RequestContext, productVariant: ProductVariant) {
        if (ctx.channel.code === 'secret-channel') {
            return {
                // Everything for free!
                price: 0,
                priceIncludesTax: false,
            };
        }
        return {
            price: productVariant.listPrice,
            priceIncludesTax: productVariant.listPriceIncludesTax,
        };
    }
}

MyCustomSearchPLugin.init({
    apiKey: '12345',
    excludeProductsFromIndexing: (ctx, product) => {
        if (product.slug === 'secret-product') {
            return true;
        }
        return false;
    },
});
