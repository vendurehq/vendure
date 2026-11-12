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
 * * The Shop API `ProductVariant.calculatedPrice` field, once for each variant that requests the field.
 *   In this case there is no Order, and the `order` argument is `undefined`.
 *
 * Vendure does not cache the result of this strategy. If your implementation is slow, for example
 * because it calls an external system, your strategy must cache the results itself.
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
 *   is used to calculate the price based on the current quantity.
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
     *
     * Note: since v4.0.0 the `order` argument can be `undefined`. This is the case when Vendure calculates
     * the price outside an Order, for the Shop API `ProductVariant.calculatedPrice` field. The
     * `orderLineCustomFields` argument is then an empty object.
     */
    calculateUnitPrice(
        ctx: RequestContext,
        productVariant: ProductVariant,
        orderLineCustomFields: { [key: string]: any },
        order: Order | undefined,
        quantity: number,
    ): PriceCalculationResult | Promise<PriceCalculationResult>;
}
