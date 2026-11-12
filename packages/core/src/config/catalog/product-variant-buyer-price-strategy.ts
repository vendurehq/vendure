import { RequestContext } from '../../api/common/request-context';
import { PriceCalculationResult } from '../../common/types/common-types';
import { InjectableStrategy } from '../../common/types/injectable-strategy';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';

/**
 * @description
 * The ProductVariantBuyerPriceStrategy calculates the unit price of a ProductVariant for a buyer and
 * a quantity. By default the {@link DefaultProductVariantBuyerPriceStrategy} is used, which returns the
 * Channel price.
 *
 * :::info
 *
 * This is configured via the `catalogOptions.productVariantBuyerPriceStrategy` property of
 * your VendureConfig.
 *
 * :::
 *
 * ### Where the strategy is used
 *
 * * The {@link DefaultOrderItemPriceCalculationStrategy} calls it for the unit price of each OrderLine,
 *   for the Customer of the Order, through `ProductVariantService.calculateBuyerPriceForOrder()`.
 * * The Shop API `ProductVariant.buyerPrice` field calls it for the active Customer, without an Order.
 *   Thus a storefront can show the base unit price of the buyer.
 *
 * ### ProductVariantBuyerPriceStrategy vs ProductVariantPriceCalculationStrategy
 *
 * The {@link ProductVariantPriceCalculationStrategy} calculates the Channel price. It runs for each
 * ProductVariant that Vendure loads and for the search index, and it gives the `price` and
 * `priceWithTax` fields. It has no quantity and no Customer.
 *
 * The ProductVariantBuyerPriceStrategy runs after it, and receives the variant with the Channel price
 * in `listPrice`. Use it for a price that depends on the buyer, the quantity or pricing data, for
 * example a price per Customer group, quantity tiers, or a base price from an external system.
 *
 * ### The buyer
 *
 * To find the Customer that the price is for, inject the {@link BuyerIdentityService}. In the cart it
 * gives the Customer of the Order, and for the `buyerPrice` field the active Customer.
 *
 * ### Pricing data
 *
 * The `data` argument carries pricing input that the strategy defines, for example a packaging unit.
 * For the `buyerPrice` field, the storefront passes it. In the cart, `data` is the OrderLine custom
 * fields that the {@link OrderItemPriceCalculationStrategy} chain passes down. To get the same price,
 * a storefront passes the same values to `buyerPrice(data: ...)` that it passes as `customFields`
 * to `addItemToOrder`.
 *
 * The custom fields of a saved OrderLine can differ from the raw input: they can contain default
 * values, other custom fields, and relation entities in place of IDs. So read only the fields that the
 * strategy needs, and validate them.
 *
 * ### ProductVariantBuyerPriceStrategy vs OrderItemPriceCalculationStrategy
 *
 * The {@link OrderItemPriceCalculationStrategy} gives the price of an OrderLine and has the Order.
 * Keep logic in it that needs the Order, or that writes data to the OrderLine. Catalog pricing that
 * depends on the variant, the buyer, the quantity and the pricing data goes in the
 * ProductVariantBuyerPriceStrategy.
 *
 * A custom OrderItemPriceCalculationStrategy that replaces the default must call
 * `ProductVariantService.calculateBuyerPriceForOrder()`. This runs the strategy for the Customer of the
 * Order. Otherwise the cart does not use this strategy, or uses it for the wrong Customer. Prefer to add
 * your logic as a {@link StrategyLayer} over the default OrderItemPriceCalculationStrategy. A layer that
 * needs pricing data in a different shape changes the custom fields that it passes to `inner`.
 *
 * ### The buyer price and the cart price
 *
 * The `buyerPrice` field gives the base unit price of the buyer, not a guarantee of the final
 * cart price. The cart can differ because of logic in the OrderItemPriceCalculationStrategy, a guest
 * Order (the session has no Customer, but the Order has a guest Customer), the tax zone of the Order,
 * or a custom {@link TaxLineCalculationStrategy}.
 *
 * ### Performance
 *
 * Vendure does not cache the result. The `buyerPrice` field runs the strategy once for each
 * ProductVariant that requests the field. If your strategy is slow, for example because it calls an
 * external system, it must cache the results itself.
 *
 * @docsCategory products & stock
 * @docsPage ProductVariantBuyerPriceStrategy
 * @since 4.0.0
 */
export interface ProductVariantBuyerPriceStrategy extends InjectableStrategy {
    /**
     * @description
     * Returns the price of a single unit. The `productVariant` has the Channel price and the tax rate
     * applied: `listPrice`, `listPriceIncludesTax`, `taxRateApplied` and `currencyCode` are set.
     */
    calculateUnitPrice(
        ctx: RequestContext,
        productVariant: ProductVariant,
        args: ProductVariantBuyerPriceArgs,
    ): PriceCalculationResult | Promise<PriceCalculationResult>;
}

/**
 * @description
 * The arguments passed to the `calculateUnitPrice` method of the configured
 * {@link ProductVariantBuyerPriceStrategy}.
 *
 * @docsCategory products & stock
 * @docsPage ProductVariantBuyerPriceStrategy
 * @since 4.0.0
 */
export interface ProductVariantBuyerPriceArgs {
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
     * For the `buyerPrice` field, this is the `data` argument of the field, or `undefined`. In the cart,
     * this is a copy of the OrderLine custom fields that the {@link OrderItemPriceCalculationStrategy}
     * receives.
     */
    data?: Record<string, unknown>;
}
