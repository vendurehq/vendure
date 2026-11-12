import { RequestContext } from '../../api/common/request-context';
import { PriceCalculationResult } from '../../common/types/common-types';
import { InjectableStrategy } from '../../common/types/injectable-strategy';
import { Customer } from '../../entity/customer/customer.entity';
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
 * * The {@link DefaultOrderItemPriceCalculationStrategy} calls it for the unit price of each OrderLine.
 *   The price is for the Customer of the Order.
 * * The Shop API `ProductVariant.shopperPrice` field calls it for the active Customer, without an Order.
 *   Thus a storefront can show the price that the cart will use.
 *
 * ### ProductVariantShopperPriceStrategy vs ProductVariantPriceCalculationStrategy
 *
 * The {@link ProductVariantPriceCalculationStrategy} calculates the Channel price. It runs for each
 * ProductVariant that Vendure loads and for the search index, and it gives the `price` and
 * `priceWithTax` fields. It has no quantity and no Customer.
 *
 * The ProductVariantShopperPriceStrategy runs after it, and receives the variant with the Channel price
 * in `listPrice`. Use it for a price that depends on the Customer or the quantity, for example a price
 * per Customer group, quantity tiers, or a base price from an external system.
 *
 * ### ProductVariantShopperPriceStrategy vs OrderItemPriceCalculationStrategy
 *
 * The {@link OrderItemPriceCalculationStrategy} gives the price of an OrderLine and has the Order.
 * Keep logic in it that needs the Order. Logic that needs only the variant, the Customer, the quantity
 * and the OrderLine custom fields goes in the ProductVariantShopperPriceStrategy, so that the
 * `shopperPrice` field and the cart give the same price.
 *
 * A custom OrderItemPriceCalculationStrategy that replaces the default must call this strategy itself.
 * Otherwise the cart does not use it. Prefer to add your logic as a {@link StrategyLayer} over the
 * default OrderItemPriceCalculationStrategy.
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
     * The OrderLine custom fields. In the cart, these are the custom fields of the OrderLine. For the
     * `shopperPrice` field, they are the `customFields` argument of the field, in the same form as the
     * `customFields` input of `addItemToOrder`.
     *
     * The strategy must not write to this object. To store data on the OrderLine, use the
     * {@link OrderItemPriceCalculationStrategy}.
     */
    orderLineCustomFields: { [key: string]: any };
    /**
     * @description
     * Returns the Customer that the price is for: in the cart, the Customer of the Order, and for the
     * `shopperPrice` field, the active Customer. Returns `undefined` for a guest. The Customer is
     * loaded only when the strategy calls this function.
     */
    getCustomer(): Promise<Customer | undefined>;
}
