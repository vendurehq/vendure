import { RequestContext } from '../../api/common/request-context';
import { PriceCalculationResult } from '../../common/types/common-types';
import { InjectableStrategy } from '../../common/types/injectable-strategy';
import { Order } from '../../entity/order/order.entity';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';

/**
 * @description
 * The OrderItemPriceCalculationStrategy defines the listPrice of an OrderLine when adding an item to an Order. By default the
 * {@link DefaultOrderItemPriceCalculationStrategy} is used.
 *
 * The default strategy returns the price of the {@link ProductVariantBuyerPriceStrategy} for the Customer of the Order.
 * For catalog pricing that depends on the ProductVariant, the buyer, the quantity and the OrderLine custom fields, use
 * the ProductVariantBuyerPriceStrategy instead. Then the Shop API `ProductVariant.buyerPrice` field gives the same
 * base unit price. Keep logic here that needs the Order, or that writes data to the OrderLine. A custom strategy that
 * replaces the default calls `ProductVariantService.calculateBuyerPriceForOrder()`, so that the cart still uses the
 * ProductVariantBuyerPriceStrategy.
 *
 * :::info
 *
 * This is configured via the `orderOptions.orderItemPriceCalculationStrategy` property of
 * your VendureConfig.
 *
 * :::
 *
 * ### When is the strategy invoked ?
 * * addItemToOrder (only on the new order line)
 * * adjustOrderLine  (only on the adjusted order line)
 * * setOrderShippingAddress (on all order lines)
 * * setOrderBillingAddress (on all order lines)
 * * when the Customer of an active Order or a draft Order changes, for example with setCustomerForOrder,
 *   setCustomerForDraftOrder, or a login that gives the guest Order to a Customer (on all order lines)
 *
 * When the strategy throws a {@link NoBuyerPriceError} for an order line that is already in the Order, the line
 * keeps its current price, except on a currency change of the Order. For a new order line, the error is thrown.
 *
 * ### OrderItemPriceCalculationStrategy vs Promotions
 * Both the OrderItemPriceCalculationStrategy and Promotions can be used to alter the price paid for a product.
 *
 * The main difference is when a Promotion is applied, it adds a `discount` line to the Order, and the regular
 * price is used for the value of `OrderLine.listPrice` property, whereas
 * the OrderItemPriceCalculationStrategy actually alters the value of `OrderLine.listPrice` itself, and does not
 * add any discounts to the Order.
 *
 * Use OrderItemPriceCalculationStrategy if:
 *
 * * The price calculation is based on the properties of the ProductVariant and any CustomFields
 *   specified on the OrderLine, for example via a product configurator.
 * * The logic is a permanent part of your business requirements.
 *
 * Use Promotions if:
 *
 * * You want to implement "discounts" and "special offers"
 * * The calculation is not a permanent part of your business requirements.
 * * The price depends on dynamic aspects such as quantities and which other
 *   ProductVariants are in the Order.
 * * The configuration of the logic needs to be manipulated via the Admin UI.
 *
 * ### Example use-cases
 *
 * A custom OrderItemPriceCalculationStrategy can be used to implement things like:
 *
 * * A gift-wrapping service, where a boolean custom field is defined on the OrderLine. If `true`,
 *   a gift-wrapping surcharge would be added to the price.
 * * A product-configurator where e.g. various finishes, colors, and materials can be selected and stored
 *   as OrderLine custom fields (see [the Custom Fields guide](/developer-guide/custom-fields/).
 * * Price lists or bulk pricing, where different price bands are stored e.g. in a customField on the ProductVariant, and this
 *   is used to calculate the price based on the current quantity. Since v4.0.0, prefer the
 *   {@link ProductVariantBuyerPriceStrategy} for this, so that the storefront can show the same price.
 *
 * @docsCategory Orders
 */
export interface OrderItemPriceCalculationStrategy extends InjectableStrategy {
    /**
     * @description
     * Receives the ProductVariant to be added to the Order as well as any OrderLine custom fields and returns
     * the price for a single unit.
     *
     * Note: if you have any `relation` type custom fields defined on the OrderLine entity, they will only be
     * passed in to this method if they are set to `eager: true`. Otherwise, you can use the {@link EntityHydrator}
     * to join the missing relations.
     *
     * Note: the `quantity` argument was added in v2.0.0
     */
    calculateUnitPrice(
        ctx: RequestContext,
        productVariant: ProductVariant,
        orderLineCustomFields: { [key: string]: any },
        order: Order,
        quantity: number,
    ): PriceCalculationResult | Promise<PriceCalculationResult>;
}
