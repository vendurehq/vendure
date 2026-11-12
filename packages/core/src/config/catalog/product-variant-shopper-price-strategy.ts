import { RequestContext } from '../../api/common/request-context';
import { PriceCalculationResult } from '../../common/types/common-types';
import { InjectableStrategy } from '../../common/types/injectable-strategy';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';

/**
 * @description
 * The ProductVariantShopperPriceStrategy calculates the unit price of a ProductVariant for a shopper and
 * a quantity. By default the {@link DefaultProductVariantShopperPriceStrategy} is used, which returns the
 * Channel price.
 *
 * :::info
 *
 * This is configured via the `catalogOptions.productVariantShopperPriceStrategy` property of
 * your VendureConfig.
 *
 * :::
 *
 * ### Where the strategy is used
 *
 * * The {@link DefaultOrderItemPriceCalculationStrategy} calls it for the unit price of each OrderLine,
 *   for the Customer of the Order.
 * * The Shop API `ProductVariant.shopperPrice` field calls it for the active Customer, without an Order.
 *   Thus a storefront can show the base unit price of the shopper.
 *
 * ### ProductVariantShopperPriceStrategy vs ProductVariantPriceCalculationStrategy
 *
 * The {@link ProductVariantPriceCalculationStrategy} calculates the Channel price. It runs for each
 * ProductVariant that Vendure loads and for the search index, and it gives the `price` and
 * `priceWithTax` fields. It has no quantity and no Customer.
 *
 * The ProductVariantShopperPriceStrategy runs after it, and receives the variant with the Channel price
 * in `listPrice`. Use it for a price that depends on the shopper, the quantity or pricing data, for
 * example a price per Customer group, quantity tiers, or a base price from an external system.
 *
 * ### The shopper
 *
 * To find the Customer that the price is for, inject the {@link ShopperIdentityService}. In the cart it
 * gives the Customer of the Order, and for the `shopperPrice` field the active Customer.
 *
 * ### Pricing data
 *
 * The `data` argument carries pricing input that the strategy defines, for example a packaging unit.
 * The storefront passes it to the `shopperPrice` field. For the cart, add a
 * {@link StrategyLayer} over the {@link OrderItemPriceCalculationStrategy} that maps the OrderLine
 * custom fields to the same data in its `getShopperPriceData()` method.
 *
 * ### ProductVariantShopperPriceStrategy vs OrderItemPriceCalculationStrategy
 *
 * The {@link OrderItemPriceCalculationStrategy} gives the price of an OrderLine and has the Order.
 * Keep logic in it that needs the Order, or that writes data to the OrderLine. Catalog pricing that
 * depends on the variant, the shopper, the quantity and the pricing data goes in the
 * ProductVariantShopperPriceStrategy.
 *
 * A custom OrderItemPriceCalculationStrategy that replaces the default must call this strategy itself.
 * Otherwise the cart does not use it. Prefer to add your logic as a {@link StrategyLayer} over the
 * default OrderItemPriceCalculationStrategy.
 *
 * ### The shopper price and the cart price
 *
 * The `shopperPrice` field gives the base unit price of the shopper, not a guarantee of the final
 * cart price. The cart can differ because of logic in the OrderItemPriceCalculationStrategy, a guest
 * Order (the session has no Customer, but the Order has a guest Customer), the tax zone of the Order,
 * or a custom {@link TaxLineCalculationStrategy}.
 *
 * ### Performance
 *
 * Vendure does not cache the result. The `shopperPrice` field runs the strategy once for each
 * ProductVariant that requests the field. If your strategy is slow, for example because it calls an
 * external system, it must cache the results itself.
 *
 * @docsCategory products & stock
 * @docsPage ProductVariantShopperPriceStrategy
 * @since 4.0.0
 */
export interface ProductVariantShopperPriceStrategy extends InjectableStrategy {
    /**
     * @description
     * Returns the price of a single unit. The `productVariant` has the Channel price and the tax rate
     * applied: `listPrice`, `listPriceIncludesTax`, `taxRateApplied` and `currencyCode` are set.
     */
    calculateUnitPrice(
        ctx: RequestContext,
        productVariant: ProductVariant,
        args: ProductVariantShopperPriceArgs,
    ): PriceCalculationResult | Promise<PriceCalculationResult>;
}

/**
 * @description
 * The arguments passed to the `calculateUnitPrice` method of the configured
 * {@link ProductVariantShopperPriceStrategy}.
 *
 * @docsCategory products & stock
 * @docsPage ProductVariantShopperPriceStrategy
 * @since 4.0.0
 */
export interface ProductVariantShopperPriceArgs {
    /**
     * @description
     * The number of units.
     */
    quantity: number;
    /**
     * @description
     * Pricing input that the strategy defines, for example the code of a packaging unit. Vendure does
     * not validate or interpret it: the strategy must do this.
     *
     * For the `shopperPrice` field, this is the `data` argument of the field. In the cart, the configured
     * {@link OrderItemPriceCalculationStrategy} gives it with its `getShopperPriceData()` method. By
     * default it is `undefined`.
     */
    data?: Record<string, unknown>;
}
