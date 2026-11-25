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
 * Returns true when every TaxLine carries an absolute tax `amount` from a TaxLineCalculationStrategy,
 * together with the taxable total (`taxBase`) that the OrderCalculator recorded for it. Only then is
 * the tax taken from the amounts rather than derived from the rates. An `amount` without a
 * `taxBase`, for example one stored by a custom strategy before v3.9, is ignored.
 */
export function hasTaxAmounts(taxLines: ReadonlyArray<{ amount?: number | null }> | undefined): boolean {
    return (
        !!taxLines?.length &&
        taxLines.every(
            taxLine => taxLine.amount != null && (taxLine as { taxBase?: number | null }).taxBase != null,
        )
    );
}

/**
 * @description
 * Returns the TaxLines without their absolute tax amounts, so that the tax is derived from the rates.
 */
export function withoutTaxAmounts<T extends { amount?: number | null }>(taxLines: T[]): T[] {
    return taxLines.map(taxLine => {
        const { amount, taxBase, ...rest } = taxLine as T & { taxBase?: number };
        return rest as T;
    });
}

/**
 * @description
 * When every TaxLine has an absolute `amount` (see {@link hasTaxAmounts}), returns their total as a
 * share of the taxable total they were calculated for, so that the tax of any part of an item can
 * be derived from it. Returns undefined when the tax is derived from the rates.
 */
export function getTaxShare(
    taxLines: ReadonlyArray<{ amount?: number | null }> | undefined,
): number | undefined {
    if (!taxLines || !hasTaxAmounts(taxLines)) {
        return undefined;
    }
    const taxBase = (taxLines[0] as { taxBase?: number }).taxBase;
    if (!taxBase) {
        return 0;
    }
    return taxLines.reduce((sum, taxLine) => sum + (taxLine.amount ?? 0), 0) / taxBase;
}

/**
 * @description
 * Converts a rounded total between the tax basis of an item's price and the other basis, using the
 * share of an absolute tax amount: adds the tax to a net total, or takes it off a gross total. The
 * tax is rounded once, so on the total that the amount was calculated for, it is exactly the amount.
 */
export function applyTaxShare(
    total: number,
    taxShare: number,
    withTax: boolean,
    round: (value: number) => number,
) {
    const tax = round(total * taxShare);
    return withTax ? total + tax : total - tax;
}
