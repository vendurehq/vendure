import { RequestContext } from '../../api/common/request-context';
import { InjectableStrategy } from '../../common/types/injectable-strategy';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';

/**
 * @description
 * Defines how the `ProductVariant.stockLevel` value is obtained. It is usually not desirable
 * to directly expose stock levels over a public API, as this could be considered a leak of
 * sensitive information. However, the storefront will usually want to display _some_ indication
 * of whether a given ProductVariant is in stock.
 *
 * :::info
 *
 * This is configured via the `catalogOptions.stockDisplayStrategy` property of
 * your VendureConfig.
 *
 * :::
 *
 * @docsCategory products & stock
 */
export interface StockDisplayStrategy extends InjectableStrategy {
    /**
     * @description
     * Returns a string representing the stock level, which will be used directly
     * in the GraphQL `ProductVariant.stockLevel` field.
     */
    getStockLevel(
        ctx: RequestContext,
        productVariant: ProductVariant,
        saleableStockLevel: number,
    ): string | Promise<string>;
}
