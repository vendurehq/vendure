import { RequestContext } from '../../api/common/request-context';
import { InjectableStrategy } from '../../common/types/injectable-strategy';
import { ProductVariantPrice } from '../../entity/product-variant/product-variant-price.entity';

/**
 * @description
 * The strategy for selecting the price for a ProductVariant in a given Channel.
 *
 * `prices` holds the prices of the active Channel, in each of its currencies. Prices of other
 * Channels are only included if the variant was loaded with them, so a strategy which falls back
 * to another Channel's price must load that price itself.
 *
 * @since 4.0.0 - `prices` holds only the active Channel's prices, unless others were loaded
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
