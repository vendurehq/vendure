import { TaxLine } from '@vendure/common/lib/generated-types';

import { roundMoney } from './round-money';

/**
 * Returns the tax component of a given gross price.
 */
export function taxComponentOf(grossPrice: number, taxRatePc: number): number {
    return grossPrice - grossPrice / ((100 + taxRatePc) / 100);
}

/**
 * Given a gross (tax-inclusive) price, returns the net price.
 */
export function netPriceOf(grossPrice: number, taxRatePc: number): number {
    return grossPrice - taxComponentOf(grossPrice, taxRatePc);
}

/**
 * Returns the tax applicable to the given net price.
 */
export function taxPayableOn(netPrice: number, taxRatePc: number): number {
    return netPrice * (taxRatePc / 100);
}

/**
 * Given a net price, return the gross price (net + tax)
 */
export function grossPriceOf(netPrice: number, taxRatePc: number): number {
    return netPrice + taxPayableOn(netPrice, taxRatePc);
}

/**
 * @description
 * A TaxLine as stored on an OrderLine, ShippingLine or Surcharge. When a TaxLineCalculationStrategy
 * returns an absolute tax `amount`, the OrderCalculator records with it the taxable total that the
 * amount applies to (`taxBase`), in the tax basis of the item's price. The tax of any part of the
 * item, such as the units that remain after a partial cancellation, is the amount's share of it.
 *
 * @internal
 */
export type StoredTaxLine = TaxLine & {
    taxBase?: number | null;
    /**
     * The number of OrderLines in the Order when an OrderLine's amount was given. An external
     * system may spread rounding differences across the lines of an order, so a cart whose lines
     * were added or removed asks again about all of them.
     */
    orderLineCount?: number | null;
};

/**
 * @description
 * Returns true when every TaxLine carries an absolute tax `amount` from a TaxLineCalculationStrategy,
 * together with the taxable total (`taxBase`) that the OrderCalculator recorded for it. Only then is
 * the tax taken from the amounts rather than derived from the rates. An `amount` without a
 * `taxBase`, for example one stored by a custom strategy before v3.9, is ignored.
 */
export function hasTaxAmounts(taxLines: readonly StoredTaxLine[] | undefined): boolean {
    return !!taxLines?.length && taxLines.every(taxLine => taxLine.amount != null && taxLine.taxBase != null);
}

/**
 * @description
 * The total of the absolute tax amounts of the TaxLines.
 */
export function sumTaxAmounts(taxLines: readonly StoredTaxLine[]): number {
    return taxLines.reduce((sum, taxLine) => sum + (taxLine.amount ?? 0), 0);
}

/**
 * @description
 * Returns the TaxLines without their absolute tax amounts, so that the tax is derived from the rates.
 */
export function withoutTaxAmounts(taxLines: StoredTaxLine[]): TaxLine[] {
    return taxLines.map(({ amount, taxBase, orderLineCount, ...rest }) => rest);
}

/**
 * @description
 * Returns true when stored TaxLines with absolute amounts still apply to an item: they were
 * calculated for its current taxable total, and its rates have not changed.
 */
export function taxAmountsApply(
    stored: readonly StoredTaxLine[],
    taxableTotal: number,
    currentTaxLines: readonly TaxLine[],
): boolean {
    const rateOf = (taxLines: readonly TaxLine[]) => taxLines.reduce((sum, t) => sum + t.taxRate, 0);
    return stored[0]?.taxBase === taxableTotal && rateOf(stored) === rateOf(currentTaxLines);
}

/**
 * @description
 * When every TaxLine has an absolute `amount` (see {@link hasTaxAmounts}), returns their total as a
 * share of the taxable total they were calculated for, so that the tax of any part of an item can
 * be derived from it. Returns undefined when the tax is derived from the rates, which includes an
 * amount on a taxable total of zero.
 */
export function getTaxShare(taxLines: readonly StoredTaxLine[] | undefined): number | undefined {
    if (!taxLines || !hasTaxAmounts(taxLines)) {
        return undefined;
    }
    const taxBase = taxLines[0].taxBase;
    if (!taxBase) {
        // An amount on a zero total, such as a fully discounted or cancelled line, says nothing
        // about the tax of the item's other prices, so those are derived from the rate. The tax of
        // the zero total is zero either way.
        return undefined;
    }
    return sumTaxAmounts(taxLines) / taxBase;
}

/**
 * @description
 * Converts a rounded total between the tax basis of an item's price and the other basis, using the
 * share of an absolute tax amount: adds the tax to a net total, or takes it off a gross total. The
 * tax is rounded once, so on the total that the amount was calculated for, it is exactly the amount.
 */
export function applyTaxShare(total: number, taxShare: number, withTax: boolean): number {
    const tax = roundMoney(total * taxShare);
    return withTax ? total + tax : total - tax;
}

/**
 * @description
 * Converts a value in the tax basis of an item's price to the other basis: from the absolute tax
 * amounts when its TaxLines have them, otherwise from the rate.
 */
export function convertTaxBasis(
    value: number,
    withTax: boolean,
    taxLines: readonly StoredTaxLine[] | undefined,
    taxRate: number,
): number {
    const taxShare = getTaxShare(taxLines);
    if (taxShare != null) {
        return applyTaxShare(roundMoney(value), taxShare, withTax);
    }
    return withTax ? grossPriceOf(value, taxRate) : netPriceOf(value, taxRate);
}
