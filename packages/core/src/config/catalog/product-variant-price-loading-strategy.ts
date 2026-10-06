import { RequestContext } from '../../api/common/request-context';
import { InjectableStrategy } from '../../common/types/injectable-strategy';
import { ProductVariantPrice } from '../../entity/product-variant/product-variant-price.entity';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';

/**
 * @description
 * Defines how the price rows of a ProductVariant are loaded before the
 * {@link ProductVariantPriceSelectionStrategy} picks one of them.
 *
 * By default `ProductVariant.productVariantPrices` is an eager relation: every variant Vendure
 * loads arrives with one {@link ProductVariantPrice} per Channel it is assigned to. A request only
 * needs the row of its own Channel, so with many Channels these rows become the largest part of
 * what a product page, a cart or a checkout step reads. A strategy with `eagerLoading: false`
 * turns the eager loading off and supplies the rows itself; see
 * {@link ActiveChannelProductVariantPriceLoadingStrategy}.
 *
 * :::info
 *
 * This is configured via the `catalogOptions.productVariantPriceLoadingStrategy` property of
 * your VendureConfig.
 *
 * :::
 *
 * @docsCategory configuration
 * @docsPage ProductVariantPriceLoadingStrategy
 * @docsWeight 0
 * @since 3.8.0
 */
export interface ProductVariantPriceLoadingStrategy extends InjectableStrategy {
    /**
     * @description
     * When `true`, `ProductVariant.productVariantPrices` stays an eager relation and comes with
     * every variant. When `false`, the relation is loaded only where a query requests it
     * explicitly, and the {@link ProductPriceApplicator} relies on `loadPrices()` instead.
     */
    readonly eagerLoading: boolean;

    /**
     * @description
     * Returns the price rows the {@link ProductVariantPriceSelectionStrategy} should see when the
     * given variant is priced in the Channel of the RequestContext. The caller stores them on
     * `variant.productVariantPrices` and keeps rows of other Channels that are already there.
     */
    loadPrices(
        ctx: RequestContext,
        variant: ProductVariant,
    ): ProductVariantPrice[] | Promise<ProductVariantPrice[]>;
}
