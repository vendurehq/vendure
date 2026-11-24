import { idsAreEqual } from '../../common/utils';
import { Channel, Order, Zone } from '../../entity';

/**
 * @description
 * The default rule for the country whose country {@link TaxRate}s apply. It is used when the
 * configured {@link TaxZoneStrategy} does not implement `determineTaxCountryCode()`, and a strategy
 * that does can call it to keep the default for some cases.
 *
 * It returns the country of the Order's shipping address. With no Order or no shipping country, it
 * returns the Channel's `taxCountryCode` when `activeTaxZone` is the Channel's default tax Zone, so
 * that product pages and carts before an address is set show the rate of the seller's own country.
 * Otherwise it returns `undefined`, and only the zone rate of `activeTaxZone` applies.
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
    const shippingCountryCode = order?.shippingAddress?.countryCode;
    if (shippingCountryCode) {
        return shippingCountryCode;
    }
    const isDefaultTaxZone =
        channel.defaultTaxZone && idsAreEqual(activeTaxZone.id, channel.defaultTaxZone.id);
    return (isDefaultTaxZone && channel.taxCountryCode) || undefined;
}
