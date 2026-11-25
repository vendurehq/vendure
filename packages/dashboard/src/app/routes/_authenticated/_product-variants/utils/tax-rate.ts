export type TaxRateForVariant = { value: number; zone: { id: string }; category: { id: string } };

/**
 * The tax rate the variant page shows for a tax category: the rate of the category in the
 * Channel's default tax zone, or 0 when there is none. Undefined while the tax rates or the
 * Channel are still loading (`undefined`); a Channel without a default tax zone gives 0.
 */
export function getTaxRate(
    taxRates: TaxRateForVariant[] | undefined,
    channel: { defaultTaxZone?: { id: string } | null } | undefined,
    taxCategoryId: string | undefined,
): number | undefined {
    if (!taxRates || !channel) {
        return undefined;
    }
    const zoneId = channel.defaultTaxZone?.id;
    if (!zoneId) {
        return 0;
    }
    return taxRates.find(rate => rate.zone.id === zoneId && rate.category.id === taxCategoryId)?.value ?? 0;
}
