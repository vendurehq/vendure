import { Channel, Order, Zone } from '../../entity';

/**
 * @description
 * The default rule for the country whose country {@link TaxRate}s apply. It is used when the
 * configured {@link TaxZoneStrategy} does not implement `determineTaxCountryCode()`, and a strategy
 * that does can call it to keep the default for some cases.
 *
 * It returns the country of the Order's shipping address, or `undefined` when there is no Order or
 * no shipping country.
 *
 * @example
 * ```ts
 * determineTaxCountryCode(ctx: RequestContext, channel: Channel, activeTaxZone: Zone, order?: Order) {
 *     if (isBusinessCustomer(order)) {
 *         return undefined;
 *     }
 *     return defaultTaxCountryCode(channel, activeTaxZone, order);
 * }
 * ```
 *
 * @docsCategory tax
 * @since 4.0.0
 */
export function defaultTaxCountryCode(
    channel: Channel,
    activeTaxZone: Zone,
    order?: Order,
): string | undefined {
    return order?.shippingAddress?.countryCode || undefined;
}
