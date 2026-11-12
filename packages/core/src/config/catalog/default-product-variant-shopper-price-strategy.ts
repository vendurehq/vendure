import { RequestContext } from '../../api/common/request-context';
import { PriceCalculationResult } from '../../common/types/common-types';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';

import { ProductVariantShopperPriceStrategy } from './product-variant-shopper-price-strategy';

/**
 * @description
 * The default {@link ProductVariantShopperPriceStrategy}. It returns the Channel price of the
 * ProductVariant for every shopper and quantity.
 *
 * @docsCategory products & stock
 * @docsPage ProductVariantShopperPriceStrategy
 * @since 4.0.0
 */
export class DefaultProductVariantShopperPriceStrategy implements ProductVariantShopperPriceStrategy {
    calculateUnitPrice(ctx: RequestContext, productVariant: ProductVariant): PriceCalculationResult {
        return {
            price: productVariant.listPrice,
            priceIncludesTax: productVariant.listPriceIncludesTax,
        };
    }
}
