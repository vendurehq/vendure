import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';
import { InjectableStrategy } from '../../common/types/injectable-strategy';
import { ProductVariantPrice } from '../../entity/product-variant/product-variant-price.entity';

/**
 * @description
 * The return value of the `onPriceCreated`, `onPriceUpdated` and `onPriceDeleted` methods
 * of the {@link ProductVariantPriceUpdateStrategy}.
 *
 * @docsPage ProductVariantPriceUpdateStrategy
 * @since 2.2.0
 */
export interface UpdatedProductVariantPrice {
    /**
     * @description
     * The ID of the ProductVariantPrice to update.
     */
    id: ID;
    /**
     * @description
     * The new price to set.
     */
    price: number;
}

/**
 * @description
 * This strategy determines how updates to a ProductVariantPrice is handled in regard to
 * any other prices which may be associated with the same ProductVariant.
 *
 * For instance, in a multichannel setup, if a price is updated for a ProductVariant in one
 * Channel, this strategy can be used to update the prices in other Channels.
 *
 * Using custom logic, this can be made more sophisticated - for example, you could have a
 * one-way sync that only updates prices in child channels when the price in the default
 * channel is updated. You could also have a conditional sync which is dependent on the
 * permissions of the current administrator, or based on custom field flags on the ProductVariant
 * or Channel.
 *
 * Another use-case might be to update the prices of a ProductVariant in other currencies
 * when a price is updated in one currency, based on the current exchange rate.
 *
 *
 * :::info
 *
 * This is configured via the `catalogOptions.productVariantPriceUpdateStrategy` property of
 * your VendureConfig.
 *
 * :::
 *
 * @docsCategory configuration
 * @docsPage ProductVariantPriceUpdateStrategy
 * @docsWeight 0
 * @since 2.2.0
 */
export interface ProductVariantPriceUpdateStrategy extends InjectableStrategy {
    /**
     * @description
     * This method is called when a ProductVariantPrice is created. It receives the created
     * ProductVariantPrice and the array of all prices associated with the ProductVariant.
     *
     * It should return an array of UpdatedProductVariantPrice objects which will be used to update
     * the prices of the specific ProductVariantPrices.
     */
    onPriceCreated(
        ctx: RequestContext,
        createdPrice: ProductVariantPrice,
        prices: ProductVariantPrice[],
    ): UpdatedProductVariantPrice[] | Promise<UpdatedProductVariantPrice[]>;

    /**
     * @description
     * This method is called when a ProductVariantPrice is updated. It receives the updated
     * ProductVariantPrice and the array of all prices associated with the ProductVariant.
     *
     * It should return an array of UpdatedProductVariantPrice objects which will be used to update
     * the prices of the specific ProductVariantPrices.
     */
    onPriceUpdated(
        ctx: RequestContext,
        updatedPrice: ProductVariantPrice,
        prices: ProductVariantPrice[],
    ): UpdatedProductVariantPrice[] | Promise<UpdatedProductVariantPrice[]>;

    /**
     * @description
     * This method is called when a ProductVariantPrice is deleted. It receives the deleted
     * ProductVariantPrice and the array of all prices associated with the ProductVariant.
     *
     * It should return an array of UpdatedProductVariantPrice objects which will be used to update
     * the prices of the specific ProductVariantPrices.
     */
    onPriceDeleted(
        ctx: RequestContext,
        deletedPrice: ProductVariantPrice,
        prices: ProductVariantPrice[],
    ): UpdatedProductVariantPrice[] | Promise<UpdatedProductVariantPrice[]>;
}
