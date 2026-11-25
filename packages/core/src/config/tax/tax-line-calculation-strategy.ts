import { TaxLine } from '@vendure/common/lib/generated-types';

import { RequestContext } from '../../api/common/request-context';
import { InjectableStrategy } from '../../common/types/injectable-strategy';
import { OrderLine } from '../../entity/order-line/order-line.entity';
import { Order } from '../../entity/order/order.entity';
import { ShippingLine } from '../../entity/shipping-line/shipping-line.entity';
import { Surcharge } from '../../entity/surcharge/surcharge.entity';
import { TaxRate } from '../../entity/tax-rate/tax-rate.entity';

/**
 * @description
 * This strategy defines how the TaxLines on OrderItems are calculated. By default,
 * the {@link DefaultTaxLineCalculationStrategy} is used, which directly applies
 * a single TaxLine based on the applicable {@link TaxRate}.
 *
 * However, custom strategies may use any suitable method for calculating TaxLines.
 * For example, a third-party tax API or a lookup of a custom tax table may be used.
 *
 * ## Absolute tax amounts
 *
 * By default, Vendure derives the tax of an OrderLine from the `taxRate` of its TaxLines. If an
 * external system such as an ERP calculates the tax with its own rounding, return its result as
 * the `amount` of each TaxLine instead. The amount is the tax of the whole line, as an integer in
 * the smallest unit of the configured {@link MoneyStrategy} precision. It applies to the line total
 * in the tax basis of the line's price: `orderLine.proratedLinePrice` when prices exclude tax, and
 * `orderLine.proratedLinePriceWithTax` when they include it. Set it on all or none of a line's
 * TaxLines.
 *
 * The `taxRate` remains the rate that the line displays. Vendure keeps the amount as the line's tax
 * until it calls this strategy again. If a partial cancellation removes units without
 * recalculating the Order, Vendure gives the remaining units their share of the amount.
 *
 * ShippingLines and Surcharges derive their tax from the rate, unless the strategy also implements
 * `calculateShippingLineTaxLines()` or `calculateSurchargeTaxLines()` to return amounts for them.
 *
 * @example
 * ```ts
 * export class ErpTaxLineCalculationStrategy implements TaxLineCalculationStrategy {
 *     async calculate({ orderLine, applicableTaxRate }: CalculateTaxLinesArgs) {
 *         const lineTotal = orderLine.listPriceIncludesTax
 *             ? orderLine.proratedLinePriceWithTax
 *             : orderLine.proratedLinePrice;
 *         const erpTax = await erpClient.getLineTax(orderLine.productVariant.sku, lineTotal);
 *         return [
 *             {
 *                 description: applicableTaxRate.name,
 *                 taxRate: applicableTaxRate.value,
 *                 amount: erpTax.amountInCents,
 *             },
 *         ];
 *     }
 * }
 * ```
 *
 * :::info
 *
 * This is configured via the `taxOptions.taxLineCalculationStrategy` property of
 * your VendureConfig.
 *
 * :::
 *
 * @docsCategory tax
 * @docsPage TaxLineCalculationStrategy
 * @docsWeight 0
 */
export interface TaxLineCalculationStrategy extends InjectableStrategy {
    /**
     * @description
     * This method is called when calculating the Order prices. Since it will be called
     * whenever an Order is modified in some way (adding/removing items, applying promotions,
     * setting ShippingMethod etc), care should be taken so that calling the function does
     * not adversely impact overall performance. For example, by using caching and only
     * calling external APIs when absolutely necessary.
     */
    calculate(args: CalculateTaxLinesArgs): TaxLine[] | Promise<TaxLine[]>;

    /**
     * @description
     * Optionally returns the TaxLines of a ShippingLine, with absolute tax `amount`s, for example
     * from an ERP. The amount is the tax of the ShippingLine's discounted price, in the tax basis of
     * its price: `shippingLine.discountedPrice` when it excludes tax, and
     * `shippingLine.discountedPriceWithTax` when it includes it.
     *
     * Vendure calls this after the shipping price and shipping promotions are applied, and only when
     * that price changed since the last call. `args.taxLines` holds the TaxLines that Vendure derived
     * from the ShippingCalculator's rate. Return them unchanged to keep the rate.
     *
     * @since 3.9.0
     */
    calculateShippingLineTaxLines?(args: CalculateShippingLineTaxLinesArgs): TaxLine[] | Promise<TaxLine[]>;

    /**
     * @description
     * Optionally returns the TaxLines of a Surcharge, with absolute tax `amount`s, for example from an
     * ERP. The amount is the tax of the Surcharge's price, in the tax basis of that price.
     *
     * Vendure calls this when it recalculates the Order, and only when the Surcharge's price changed
     * since the last call. `args.taxLines` holds the TaxLines that the Surcharge was created with.
     * Return them unchanged to keep the rate.
     *
     * @since 3.9.0
     */
    calculateSurchargeTaxLines?(args: CalculateSurchargeTaxLinesArgs): TaxLine[] | Promise<TaxLine[]>;
}

/**
 * @description
 *
 * @docsCategory tax
 * @docsPage TaxLineCalculationStrategy
 */
export interface CalculateTaxLinesArgs {
    ctx: RequestContext;
    order: Order;
    orderLine: OrderLine;
    applicableTaxRate: TaxRate;
}

/**
 * @description
 * The arguments passed to `TaxLineCalculationStrategy.calculateShippingLineTaxLines()`: the
 * ShippingLine, with its final price after shipping promotions, and the TaxLines that Vendure
 * derived for it from the ShippingCalculator's rate.
 *
 * @docsCategory tax
 * @docsPage TaxLineCalculationStrategy
 * @since 3.9.0
 */
export interface CalculateShippingLineTaxLinesArgs {
    ctx: RequestContext;
    order: Order;
    shippingLine: ShippingLine;
    taxLines: TaxLine[];
}

/**
 * @description
 * The arguments passed to `TaxLineCalculationStrategy.calculateSurchargeTaxLines()`: the Surcharge,
 * and the TaxLines that it was created with.
 *
 * @docsCategory tax
 * @docsPage TaxLineCalculationStrategy
 * @since 3.9.0
 */
export interface CalculateSurchargeTaxLinesArgs {
    ctx: RequestContext;
    order: Order;
    surcharge: Surcharge;
    taxLines: TaxLine[];
}
