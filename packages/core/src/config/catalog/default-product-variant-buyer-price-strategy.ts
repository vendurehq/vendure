import { RequestContext } from '../../api/common/request-context';
import { PriceCalculationResult } from '../../common/types/common-types';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';

import { ProductVariantBuyerPriceStrategy } from './product-variant-buyer-price-strategy';

/**
 * @description
 * The default {@link ProductVariantBuyerPriceStrategy}. It returns the Channel price of the
 * ProductVariant for every buyer and quantity.
 *
 * @docsCategory products & stock
 * @docsPage ProductVariantBuyerPriceStrategy
 * @since 4.0.0
 */
export class DefaultProductVariantBuyerPriceStrategy implements ProductVariantBuyerPriceStrategy {
    calculateUnitPrice(ctx: RequestContext, productVariant: ProductVariant): PriceCalculationResult {
        return {
            price: productVariant.listPrice,
            priceIncludesTax: productVariant.listPriceIncludesTax,
        };
    }
}
