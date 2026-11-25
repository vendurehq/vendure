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
