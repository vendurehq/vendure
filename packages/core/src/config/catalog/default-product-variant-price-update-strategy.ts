import { RequestContext } from '../../api/common/request-context';
import { ProductVariantPrice } from '../../entity/product-variant/product-variant-price.entity';

import { ProductVariantPriceUpdateStrategy } from './product-variant-price-update-strategy';

/**
 * @description
 * The options available to the {@link DefaultProductVariantPriceUpdateStrategy}.
 *
 * @docsCategory configuration
 * @docsPage ProductVariantPriceUpdateStrategy
 * @since 2.2.0
 */
export interface DefaultProductVariantPriceUpdateStrategyOptions {
    /**
     * @description
     * When `true`, any price changes to a ProductVariant in one Channel will update any other
     * prices of the same currencyCode in other Channels. Note that if there are different
     * tax settings across the channels, these will not be taken into account. To handle this
     * case, a custom strategy should be implemented.
     */
    syncPricesAcrossChannels: boolean;
}

/**
 * @description
 * The default {@link ProductVariantPriceUpdateStrategy} which by default will not update any other
 * prices when a price is created, updated or deleted.
 *
 * If the `syncPricesAcrossChannels` option is set to `true`, then when a price is updated in one Channel,
 * the price of the same currencyCode in other Channels will be updated to match.  Note that if there are different
 * tax settings across the channels, these will not be taken into account. To handle this
 * case, a custom strategy should be implemented.
 *
 * @example
 * ```ts
 * import { DefaultProductVariantPriceUpdateStrategy, VendureConfig } from '\@vendure/core';
 *
 * export const config: VendureConfig = {
 *   // ...
 *   catalogOptions: {
 *     productVariantPriceUpdateStrategy: new DefaultProductVariantPriceUpdateStrategy({ // [!code highlight]
 *       syncPricesAcrossChannels: true, // [!code highlight]
 *     }), // [!code highlight]
 *   },
 *   // ...
 * };
 * ```
 *
 * @docsCategory configuration
 * @docsPage ProductVariantPriceUpdateStrategy
 * @since 2.2.0
 */
export class DefaultProductVariantPriceUpdateStrategy implements ProductVariantPriceUpdateStrategy {
    constructor(private options: DefaultProductVariantPriceUpdateStrategyOptions) {}

    onPriceCreated(ctx: RequestContext, price: ProductVariantPrice) {
        return [];
    }

    onPriceUpdated(ctx: RequestContext, updatedPrice: ProductVariantPrice, prices: ProductVariantPrice[]) {
        if (this.options.syncPricesAcrossChannels) {
            return prices
                .filter(p => p.currencyCode === updatedPrice.currencyCode)
                .map(p => ({
                    id: p.id,
                    price: updatedPrice.price,
                }));
        } else {
            return [];
        }
    }

    onPriceDeleted(ctx: RequestContext, deletedPrice: ProductVariantPrice, prices: ProductVariantPrice[]) {
        return [];
    }
}
