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
}

/**
 * The date the values below were taken from their source.
 */
export const EU_VAT_RATES_SOURCE_DATE = '2026-11-24';

/**
 * The page the values were taken from. It printed "Last checked: 13/07/2026". The European
 * Commission's own PDF of the rates could not be read on the day. On 2026-11-24 the rows for EE,
 * PL, SE and SK were checked against national and secondary sources, which are named in their
 * comments.
 */
export const EU_VAT_RATES_SOURCE =
    'https://europa.eu/youreurope/business/taxation/vat/vat-rules-rates/index_en.htm';

/**
 * The date a person checked every rate below against the source. `undefined` until that review is
 * done. While it is `undefined`, the `eu` preset is hidden: `listPresets()` leaves it out and
 * `applyPreset()` treats it as unknown.
 */
export const EU_VAT_RATES_REVIEWED_AT: string | undefined = '2026-11-24';

/**
 * @description
 * The standard and reduced VAT rates of the 27 EU member states, for the One-Stop Shop scheme.
 * Regional rates, such as those of the Canary Islands or the French overseas departments, are not
 * included.
 *
 * A comment names the member state's other reduced rates, which the preset does not use.
 *
 * Rates change every year. Before a release, check them against the source and update
 * {@link EU_VAT_RATES_SOURCE_DATE} and {@link EU_VAT_RATES_REVIEWED_AT}.
 */
export const EU_VAT_RATES: readonly EuVatRate[] = [
    { countryCode: 'AT', standard: 20, reduced: 10 }, // also 13
    { countryCode: 'BE', standard: 21, reduced: 6 }, // also 12
    { countryCode: 'BG', standard: 20, reduced: 9 },
    { countryCode: 'CY', standard: 19, reduced: 5 }, // also 9
    { countryCode: 'CZ', standard: 21, reduced: 12 },
    { countryCode: 'DE', standard: 19, reduced: 7 },
    // Denmark has no reduced rate. Its only other rate is a zero rate.
    { countryCode: 'DK', standard: 25, reduced: 25 },
    { countryCode: 'EE', standard: 24, reduced: 9 }, // also 13 (accommodation, since 2025-01-01)
    { countryCode: 'ES', standard: 21, reduced: 10 },
    { countryCode: 'FI', standard: 25.5, reduced: 13.5 }, // also 10
    { countryCode: 'FR', standard: 20, reduced: 5.5 }, // also 10
    { countryCode: 'GR', standard: 24, reduced: 13 }, // also 6, 17
    { countryCode: 'HR', standard: 25, reduced: 5 }, // also 13
    { countryCode: 'HU', standard: 27, reduced: 5 }, // also 18
    { countryCode: 'IE', standard: 23, reduced: 13.5 }, // also 9
    { countryCode: 'IT', standard: 22, reduced: 10 }, // also 5
    { countryCode: 'LT', standard: 21, reduced: 12 }, // also 5
    { countryCode: 'LU', standard: 17, reduced: 8 },
    { countryCode: 'LV', standard: 21, reduced: 12 }, // also 5
    { countryCode: 'MT', standard: 18, reduced: 7 }, // also 5
    { countryCode: 'NL', standard: 21, reduced: 9 },
    { countryCode: 'PL', standard: 23, reduced: 5 }, // also 8. Basic food 5% since 2024-04-01 (PwC, Your Europe)
    { countryCode: 'PT', standard: 23, reduced: 6 }, // also 13
    { countryCode: 'RO', standard: 21, reduced: 11 },
    // also 12; the 6% food rate is temporary, 2026-04-01 to 2027-12-31 (Riksdagen, KPMG)
    { countryCode: 'SE', standard: 25, reduced: 6 },
    { countryCode: 'SI', standard: 22, reduced: 9.5 }, // also 5
    // also 19, 23 (basic food 5%, other food 19%, sugary and salty food 23% since 2026-01-01)
    { countryCode: 'SK', standard: 23, reduced: 5 },
];
