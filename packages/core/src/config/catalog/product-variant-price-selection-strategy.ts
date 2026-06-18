import { RequestContext } from '../../api/common/request-context';
import { InjectableStrategy } from '../../common/types/injectable-strategy';
import { ProductVariantPrice } from '../../entity/product-variant/product-variant-price.entity';

/**
 * @description
 * The strategy for selecting the price for a ProductVariant in a given Channel.
 *
 * :::info
 *
 * This is configured via the `catalogOptions.productVariantPriceSelectionStrategy` property of
 * your VendureConfig.
 *
 * :::
 *
 * @docsCategory configuration
 * @docsPage ProductVariantPriceSelectionStrategy
 * @docsWeight 0
 * @since 2.0.0
 */
export interface ProductVariantPriceSelectionStrategy extends InjectableStrategy {
    selectPrice(
        ctx: RequestContext,
        prices: ProductVariantPrice[],
    ): ProductVariantPrice | undefined | Promise<ProductVariantPrice | undefined>;
}
