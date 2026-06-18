import { OrderTaxSummary, TaxLine } from '@vendure/common/lib/generated-types';
import { summate } from '@vendure/common/lib/shared-utils';

import { OrderLine } from '../../entity/order-line/order-line.entity';
import { Order } from '../../entity/order/order.entity';
import { Surcharge } from '../../entity/surcharge/surcharge.entity';

import { OrderTaxCalculationStrategy, OrderTotalsResult } from './order-tax-calculation-strategy';

/**
 * @description
 * The default {@link OrderTaxCalculationStrategy}. Tax is rounded at the
 * individual line level and then summed. This matches the standard Vendure behaviour
 * prior to the introduction of this strategy.
 *
 * @docsCategory tax
 * @docsPage OrderTaxCalculationStrategy
 * @since 3.6.0
 */
export class DefaultOrderTaxCalculationStrategy implements OrderTaxCalculationStrategy {
    calculateOrderTotals(order: Order): OrderTotalsResult {
        let subTotal = 0;
        let subTotalWithTax = 0;
        for (const line of order.lines ?? []) {
            subTotal += line.proratedLinePrice;
            subTotalWithTax += line.proratedLinePriceWithTax;
        }
        for (const surcharge of order.surcharges ?? []) {
            subTotal += surcharge.price;
            subTotalWithTax += surcharge.priceWithTax;
        }

        let shipping = 0;
        let shippingWithTax = 0;
        for (const shippingLine of order.shippingLines ?? []) {
            shipping += shippingLine.discountedPrice;
            shippingWithTax += shippingLine.discountedPriceWithTax;
        }

        return { subTotal, subTotalWithTax, shipping, shippingWithTax };
    }

    calculateTaxSummary(order: Order): OrderTaxSummary[] {
        const taxRateMap = new Map<
            string,
            { rate: number; base: number; tax: number; description: string }
        >();
        const taxId = (taxLine: TaxLine): string => `${taxLine.description}:${taxLine.taxRate}`;
        const taxableLines = [
            ...(order.lines ?? []),
            ...(order.shippingLines ?? []),
            ...(order.surcharges ?? []),
        ];
        for (const line of taxableLines) {
            if (!line.taxLines?.length) {
                continue;
            }
            const taxRateTotal = summate(line.taxLines, 'taxRate');
            for (const taxLine of line.taxLines) {
                const id = taxId(taxLine);
                const row = taxRateMap.get(id);
                const proportionOfTotalRate = 0 < taxLine.taxRate ? taxLine.taxRate / taxRateTotal : 0;

                const lineBase =
                    line instanceof OrderLine
                        ? line.proratedLinePrice
                        : line instanceof Surcharge
                          ? line.price
                          : line.discountedPrice;
                const lineWithTax =
                    line instanceof OrderLine
                        ? line.proratedLinePriceWithTax
                        : line instanceof Surcharge
                          ? line.priceWithTax
                          : line.discountedPriceWithTax;
                const amount = Math.round((lineWithTax - lineBase) * proportionOfTotalRate);
                if (row) {
                    row.tax += amount;
                    row.base += lineBase;
                } else {
                    taxRateMap.set(id, {
                        tax: amount,
                        base: lineBase,
                        description: taxLine.description,
                        rate: taxLine.taxRate,
                    });
                }
            }
        }
        return Array.from(taxRateMap.entries()).map(([, row]) => ({
            taxRate: row.rate,
            description: row.description,
            taxBase: row.base,
            taxTotal: row.tax,
        }));
    }
}
