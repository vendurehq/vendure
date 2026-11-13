import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';
import { PriceCalculationResult } from '../../common/types/common-types';
import { InjectableStrategy } from '../../common/types/injectable-strategy';
import { Customer } from '../../entity/customer/customer.entity';
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
 * The `buyer` argument tells the strategy who the price is for. In the cart it gives the Customer of
 * the Order, and for the `buyerPrice` field the Customer of the active User. A caller can pass its own
 * Buyer to `ProductVariantService.calculateBuyerPriceForOrder()` and `calculateBuyerPrice()`, for
 * example an order item layer that prices a shared cart for a company. It loads nothing until the
 * strategy calls it. A strategy that caches its results must include the buyer in the cache key.
 *
 * ### Pricing data
 *
 * The `data` argument carries pricing input that the strategy defines, for example a packaging unit.
 * In the cart, `data` is the OrderLine custom fields that the {@link OrderItemPriceCalculationStrategy}
 * chain passes down. For the `buyerPrice` field, it is the `customFields` argument of the field. This
 * argument exists when OrderLine custom fields are defined, and has the same input type as
 * `addItemToOrder`. To get the same price, a storefront passes the same values to both.
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
 * `ProductVariantService.calculateBuyerPriceForOrder()`. This passes the Customer of the Order as the
 * buyer, or the `buyer` option, and the OrderLine custom fields as the data. Otherwise the cart does not
 * use this strategy. Prefer to add
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
 * ### No price and metadata
 *
 * The strategy returns `undefined` when there is no price for this buyer, for example for "price on
 * request" or "log in to see prices". The `buyerPrice` field then gives `null`. In the cart,
 * `ProductVariantService.calculateBuyerPriceForOrder()` throws a {@link NoBuyerPriceError}. Then:
 *
 * * A new OrderLine is not added.
 * * An OrderLine that is already in the Order keeps its current price, for example when the Customer
 *   of the Order changes, an address is set, the quantity changes, or an administrator modifies a
 *   placed Order.
 * * A currency change of the Order fails, because the current price is in the old currency.
 * * A login that merges the guest Order into the active Order of the Customer leaves out a guest line
 *   that has no price. The other guest lines are merged.
 *
 * A project that needs a stricter rule, for example to remove the line or to block the checkout, does
 * it in its own OrderItemPriceCalculationStrategy or {@link OrderProcess}.
 *
 * The result can carry `metadata`, for example the price rule that applied. An outer layer over the
 * OrderItemPriceCalculationStrategy can read it from the result of `inner`, and a plugin can read it
 * in a field resolver for the `BuyerPrice` GraphQL type.
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
     * Returns the price of a single unit, or `undefined` if there is no price for this buyer. The
     * `productVariant` has the Channel price and the tax rate applied: `listPrice`,
     * `listPriceIncludesTax`, `taxRateApplied` and `currencyCode` are set.
     */
    calculateUnitPrice(
        ctx: RequestContext,
        productVariant: ProductVariant,
        args: ProductVariantBuyerPriceArgs,
    ): PriceCalculationResult | undefined | Promise<PriceCalculationResult | undefined>;
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
     * For the `buyerPrice` field, this is a copy of the `customFields` argument of the field, or
     * `undefined`. In the cart, this is a copy of the OrderLine custom fields that the
     * {@link OrderItemPriceCalculationStrategy} receives.
     */
    data?: Record<string, unknown>;
    /**
     * @description
     * The buyer that the price is for.
     */
    buyer: Buyer;
}

/**
 * @description
 * The buyer that a {@link ProductVariantBuyerPriceStrategy} calculates the price for. It loads nothing
 * until a method is called, and each Customer is loaded once for each request. The
 * {@link BuyerIdentityService} creates it.
 *
 * @docsCategory products & stock
 * @docsPage ProductVariantBuyerPriceStrategy
 * @since 4.0.0
 */
export interface Buyer {
    /**
     * @description
     * Returns the ID of the Customer, or `undefined` for a buyer without a Customer. The
     * {@link BuyerIdentityService} also gives `undefined` for a Customer that is deleted or not in the
     * active Channel, as `getCustomer()` does.
     */
    getCustomerId(): Promise<ID | undefined>;
    /**
     * @description
     * Returns the Customer, or `undefined` for a buyer without a Customer.
     */
    getCustomer(): Promise<Customer | undefined>;
}
