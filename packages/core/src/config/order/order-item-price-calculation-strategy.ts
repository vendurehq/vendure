import { RequestContext } from '../../api/common/request-context';
import { PriceCalculationResult } from '../../common/types/common-types';
import { InjectableStrategy } from '../../common/types/injectable-strategy';
import { OrderLine } from '../../entity/order-line/order-line.entity';
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
     * the price for a single unit as an integer at the configured {@link MoneyStrategy} precision.
     * For example, at precision 4, return `9595` for a unit price of 0.9595.
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

    /**
     * @description
     * Optionally returns the price of whole lines, for their quantities, as integers in the
     * smallest unit of the configured {@link MoneyStrategy} precision. Use this when an external
     * system such as an ERP prices a line as a total that no whole unit price reproduces.
     *
     * For example, at precision 2 an ERP may price 20 units at 1.235 each as 24.70. Return
     * `{ price: 2470, priceIncludesTax: true }` for that line. The line total is then exactly 24.70,
     * and the unit price shown for the line is the rounded 1.24.
     *
     * Vendure calls this once each time it reprices lines, with every line it is repricing, so
     * that an ERP can price them in a single request. That happens whenever an OrderLine is added
     * or its quantity changes, and for all lines when the Order moves to `ArrangingPayment`. Return
     * an array with one entry per line, in the same order. An entry of `undefined` prices that line
     * with `calculateUnitPrice` instead.
     *
     * Vendure applies tax and promotions to the line total. A partial cancellation scales the
     * existing quote to the remaining units without calling this method. The quote is stored on the
     * OrderLine, so placed Orders keep their prices if this method is later removed.
     *
     * @example
     * ```ts
     * export class ErpPriceCalculationStrategy implements OrderItemPriceCalculationStrategy {
     *     calculateUnitPrice(ctx, productVariant) {
     *         return { price: productVariant.listPrice, priceIncludesTax: productVariant.listPriceIncludesTax };
     *     }
     *
     *     async calculateLinePrices(ctx, order, lines) {
     *         const quotes = await erpClient.priceLines(
     *             lines.map(line => ({ sku: line.productVariant.sku, quantity: line.quantity })),
     *         );
     *         return quotes.map(quote => ({ price: quote.totalInCents, priceIncludesTax: quote.grossPrices }));
     *     }
     * }
     * ```
     *
     * @since 3.9.0
     */
    calculateLinePrices?(
        ctx: RequestContext,
        order: Order,
        lines: LinePriceCalculationInput[],
    ): Array<PriceCalculationResult | undefined> | Promise<Array<PriceCalculationResult | undefined>>;
}

/**
 * @description
 * One OrderLine passed to `OrderItemPriceCalculationStrategy.calculateLinePrices`.
 *
 * @docsCategory Orders
 * @since 3.9.0
 */
export interface LinePriceCalculationInput {
    orderLine: OrderLine;
    productVariant: ProductVariant;
    /**
     * @description
     * The OrderLine custom fields. Relation custom fields are only included if they are
     * `eager: true`.
     */
    orderLineCustomFields: { [key: string]: any };
    quantity: number;
}
