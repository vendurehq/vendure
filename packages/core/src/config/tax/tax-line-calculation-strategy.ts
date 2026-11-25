import { TaxLine } from '@vendure/common/lib/generated-types';

import { RequestContext } from '../../api/common/request-context';
import { InjectableStrategy } from '../../common/types/injectable-strategy';
import { Order } from '../../entity/order/order.entity';
import { OrderLine } from '../../entity/order-line/order-line.entity';
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
 * The amount applies to OrderLines only. ShippingLines and Surcharges derive their tax from the
 * rate.
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
