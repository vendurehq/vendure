/**
 * @description
 * The VAT rates of one EU member state, as the `eu` preset uses them.
 */
export interface EuVatRate {
    /** The ISO 3166-1 alpha-2 code. Greece is `GR`, not the EU's `EL`. */
    countryCode: string;
    /** The standard rate, in percent. */
    standard: number;
    /**
     * The rate of the preset's `reduced` tax category, in percent. It is the reduced rate that
     * applies to most foodstuffs, or the main reduced rate where food takes the standard rate.
     * Where a member state has no reduced rate, it is the standard rate.
     */
    reduced: number;
    /** Every reduced rate the member state applies, for reference. The preset does not use them. */
    allReducedRates: number[];
}

/**
 * The date the values below were taken from their source.
 */
export const EU_VAT_RATES_SOURCE_DATE = '2026-07-13';

/**
 * The page the values were taken from. It printed "Last checked: 13/07/2026". The European
 * Commission's own PDF of the rates could not be read on the day.
 */
export const EU_VAT_RATES_SOURCE =
    'https://europa.eu/youreurope/business/taxation/vat/vat-rules-rates/index_en.htm';

/**
 * The date a person checked every rate below against the source. `undefined` until that review is
 * done. The `eu` preset must not be released before it is set.
 */
export const EU_VAT_RATES_REVIEWED_AT: string | undefined = undefined;

/**
 * @description
 * The standard and reduced VAT rates of the 27 EU member states, for the One-Stop Shop scheme.
 * Regional rates, such as those of the Canary Islands or the French overseas departments, are not
 * included.
 *
 * Rates change every year. Before a release, check them against the source and update
 * {@link EU_VAT_RATES_SOURCE_DATE} and {@link EU_VAT_RATES_REVIEWED_AT}.
 */
export const EU_VAT_RATES: readonly EuVatRate[] = [
    { countryCode: 'AT', standard: 20, reduced: 10, allReducedRates: [10, 13] },
    { countryCode: 'BE', standard: 21, reduced: 6, allReducedRates: [6, 12] },
    { countryCode: 'BG', standard: 20, reduced: 9, allReducedRates: [9] },
    { countryCode: 'CY', standard: 19, reduced: 5, allReducedRates: [5, 9] },
    { countryCode: 'CZ', standard: 21, reduced: 12, allReducedRates: [12] },
    { countryCode: 'DE', standard: 19, reduced: 7, allReducedRates: [7] },
    // Denmark has no reduced rate. Its only other rate is a zero rate.
    { countryCode: 'DK', standard: 25, reduced: 25, allReducedRates: [] },
    { countryCode: 'EE', standard: 24, reduced: 9, allReducedRates: [9] },
    { countryCode: 'ES', standard: 21, reduced: 10, allReducedRates: [10] },
    { countryCode: 'FI', standard: 25.5, reduced: 13.5, allReducedRates: [10, 13.5] },
    { countryCode: 'FR', standard: 20, reduced: 5.5, allReducedRates: [5.5, 10] },
    { countryCode: 'GR', standard: 24, reduced: 13, allReducedRates: [6, 13, 17] },
    { countryCode: 'HR', standard: 25, reduced: 5, allReducedRates: [5, 13] },
    { countryCode: 'HU', standard: 27, reduced: 5, allReducedRates: [5, 18] },
    { countryCode: 'IE', standard: 23, reduced: 13.5, allReducedRates: [9, 13.5] },
    { countryCode: 'IT', standard: 22, reduced: 10, allReducedRates: [5, 10] },
    { countryCode: 'LT', standard: 21, reduced: 12, allReducedRates: [5, 12] },
    { countryCode: 'LU', standard: 17, reduced: 8, allReducedRates: [8] },
    { countryCode: 'LV', standard: 21, reduced: 12, allReducedRates: [5, 12] },
    { countryCode: 'MT', standard: 18, reduced: 7, allReducedRates: [5, 7] },
    { countryCode: 'NL', standard: 21, reduced: 9, allReducedRates: [9] },
    { countryCode: 'PL', standard: 23, reduced: 8, allReducedRates: [5, 8] },
    { countryCode: 'PT', standard: 23, reduced: 6, allReducedRates: [6, 13] },
    { countryCode: 'RO', standard: 21, reduced: 11, allReducedRates: [11] },
    { countryCode: 'SE', standard: 25, reduced: 12, allReducedRates: [6, 12] },
    { countryCode: 'SI', standard: 22, reduced: 9.5, allReducedRates: [5, 9.5] },
    { countryCode: 'SK', standard: 23, reduced: 19, allReducedRates: [5, 19] },
];
