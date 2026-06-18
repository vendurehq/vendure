import { OrderTaxSummary, TaxLine } from '@vendure/common/lib/generated-types';

import { taxPayableOn } from '../../common/tax-utils';
import { Order } from '../../entity/order/order.entity';

import { OrderTaxCalculationStrategy, OrderTotalsResult } from './order-tax-calculation-strategy';

interface TaxGroup {
    rate: number;
    description: string;
    netBase: number;
}

/**
 * @description
 * An {@link OrderTaxCalculationStrategy} that groups net subtotals by tax rate
 * and rounds once per group. This eliminates per-line rounding accumulation errors
 * present in the {@link DefaultOrderTaxCalculationStrategy}.
 *
 * This approach is required by certain jurisdictions and ERP systems that expect
 * tax to be calculated on the subtotal per tax rate rather than per line.
 *
 * Note that when using this strategy, the `taxTotal` in the tax summary may differ
 * by ±1 minor unit from the sum of individual line-level `proratedLineTax` values.
 * This is expected and is the intended behaviour.
 *
 * @example
 * ```ts
 * import { OrderLevelTaxCalculationStrategy, VendureConfig } from '\@vendure/core';
 *
 * export const config: VendureConfig = {
 *   taxOptions: {
 *     orderTaxCalculationStrategy: new OrderLevelTaxCalculationStrategy(),
 *   },
 * };
 * ```
 *
 * @docsCategory tax
 * @docsPage OrderTaxCalculationStrategy
 * @since 3.6.0
 */
export class OrderLevelTaxCalculationStrategy implements OrderTaxCalculationStrategy {
    calculateOrderTotals(order: Order): OrderTotalsResult {
        const { subTotal, subTotalGroups, shipping, shippingGroups } = this.groupOrder(order);

        let subTotalTax = 0;
        for (const [, group] of subTotalGroups) {
            subTotalTax += Math.round(taxPayableOn(group.netBase, group.rate));
        }

        let shippingTax = 0;
        for (const [, group] of shippingGroups) {
            shippingTax += Math.round(taxPayableOn(group.netBase, group.rate));
        }

        return {
            subTotal,
            subTotalWithTax: subTotal + subTotalTax,
            shipping,
            shippingWithTax: shipping + shippingTax,
        };
    }

    calculateTaxSummary(order: Order): OrderTaxSummary[] {
        const { subTotalGroups, shippingGroups } = this.groupOrder(order);

        const merged = new Map<string, TaxGroup & { tax: number }>();
        for (const groups of [subTotalGroups, shippingGroups]) {
            for (const [key, group] of groups) {
                const roundedTax = Math.round(taxPayableOn(group.netBase, group.rate));
                const existing = merged.get(key);
                if (existing) {
                    existing.netBase += group.netBase;
                    existing.tax += roundedTax;
                } else {
                    merged.set(key, { ...group, tax: roundedTax });
                }
            }
        }
        const taxSummary: OrderTaxSummary[] = [];
        for (const [, group] of merged) {
            taxSummary.push({
                taxRate: group.rate,
                description: group.description,
                taxBase: group.netBase,
                taxTotal: group.tax,
            });
        }
        return taxSummary;
    }

    private groupOrder(order: Order) {
        let subTotal = 0;
        let shipping = 0;
        const subTotalGroups = new Map<string, TaxGroup>();
        const shippingGroups = new Map<string, TaxGroup>();

        for (const line of order.lines ?? []) {
            subTotal += line.proratedLinePrice;
            this.accumulateIntoGroups(subTotalGroups, line.taxLines, line.proratedLinePrice);
        }
        for (const surcharge of order.surcharges ?? []) {
            subTotal += surcharge.price;
            this.accumulateIntoGroups(subTotalGroups, surcharge.taxLines, surcharge.price);
        }
        for (const shippingLine of order.shippingLines ?? []) {
            shipping += shippingLine.discountedPrice;
            this.accumulateIntoGroups(shippingGroups, shippingLine.taxLines, shippingLine.discountedPrice);
        }

        return { subTotal, subTotalGroups, shipping, shippingGroups };
    }

    private accumulateIntoGroups(
        groups: Map<string, TaxGroup>,
        taxLines: TaxLine[] | undefined,
        lineNetBase: number,
    ) {
        if (!taxLines?.length) {
            return;
        }
        for (const taxLine of taxLines) {
            const key = `${taxLine.description}:${taxLine.taxRate}`;
            const existing = groups.get(key);
            if (existing) {
                existing.netBase += lineNetBase;
            } else {
                groups.set(key, {
                    rate: taxLine.taxRate,
                    description: taxLine.description,
                    netBase: lineNetBase,
                });
            }
        }
    }
}
