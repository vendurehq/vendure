import { RequestContext } from '../../api/common/request-context';
import { idsAreEqual } from '../../common/utils';
import { ProductVariantPrice } from '../../entity/product-variant/product-variant-price.entity';

import { ProductVariantPriceSelectionStrategy } from './product-variant-price-selection-strategy';

/**
 * @description
 * The default strategy for selecting the price for a ProductVariant in a given Channel. It
 * first filters all available prices to those which are in the current Channel, and then
 * selects the first price which matches the current currency.
 *
 * @docsCategory configuration
 * @docsPage ProductVariantPriceSelectionStrategy
 * @since 2.0.0
 */
export class DefaultProductVariantPriceSelectionStrategy implements ProductVariantPriceSelectionStrategy {
    selectPrice(ctx: RequestContext, prices: ProductVariantPrice[]) {
        const pricesInChannel = prices.filter(p => idsAreEqual(p.channelId, ctx.channelId));
        const priceInCurrency = pricesInChannel.find(p => p.currencyCode === ctx.currencyCode);
        return priceInCurrency;
    }
}
