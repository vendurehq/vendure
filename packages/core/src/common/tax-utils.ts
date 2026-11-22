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
 * Returns the country code used to look up country-level TaxRates: the country of the
 * order's shipping address. Returns `undefined` when there is no order or no shipping country.
 */
export function getTaxCountryCode(order?: {
    shippingAddress?: { countryCode?: string } | null;
}): string | undefined {
    return order?.shippingAddress?.countryCode || undefined;
}
