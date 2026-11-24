import { RequestContext } from '../../../api/common/request-context';
import { defaultTaxCountryCode } from '../../../config/tax/default-tax-country-code';
import { TaxZoneStrategy } from '../../../config/tax/tax-zone-strategy';
import { Channel } from '../../../entity/channel/channel.entity';
import { Order } from '../../../entity/order/order.entity';
import { Zone } from '../../../entity/zone/zone.entity';

/**
 * Returns the country code used to look up country TaxRates: the result of the strategy's
 * `determineTaxCountryCode()` when it implements it, otherwise of {@link defaultTaxCountryCode}.
 * An empty string counts as no country.
 *
 * This is internal so that a strategy cannot call it for the default and recurse into itself.
 * The result is not cached: with no Order it can differ from the result for an Order in the same
 * request.
 */
export async function resolveTaxCountryCode(
    strategy: TaxZoneStrategy,
    ctx: RequestContext,
    channel: Channel,
    activeTaxZone: Zone,
    order?: Order,
): Promise<string | undefined> {
    const countryCode = strategy.determineTaxCountryCode
        ? await strategy.determineTaxCountryCode(ctx, channel, activeTaxZone, order)
        : defaultTaxCountryCode(channel, activeTaxZone, order);
    return countryCode || undefined;
}
