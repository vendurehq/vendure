import { RequestContext } from '../../api/common/request-context';
import { Channel, Order, Zone } from '../../entity';
import { Logger } from '../logger/vendure-logger';

import { TaxZoneStrategy } from './tax-zone-strategy';

const loggerCtx = 'AddressBasedTaxZoneStrategy';

/**
 * @description
 * Address based {@link TaxZoneStrategy} which tries to find the applicable {@link Zone} based on the
 * country of the shipping address of the Order.
 * This is useful for shops that do cross-border B2C orders and use the One-Stop-Shop (OSS) VAT scheme.
 *
 * Returns the default {@link Channel}'s default tax zone if no applicable zone is found.
 *
 * :::info
 *
 * This is configured via `taxOptions.taxZoneStrategy = new AddressBasedTaxZoneStrategy()` in
 * your VendureConfig.
 *
 * :::
 *
 * @example
 * ```ts
 * import { VendureConfig, AddressBasedTaxZoneStrategy } from '\@vendure/core';
 *
 * export const config: VendureConfig = {
 *   // other options...
 *   taxOptions: {
 *     taxZoneStrategy: new AddressBasedTaxZoneStrategy(), // [!code highlight]
 *   },
 * };
 * ```
 *
 * @since 3.1.0
 * @docsCategory tax
 */
export class AddressBasedTaxZoneStrategy implements TaxZoneStrategy {
    determineTaxZone(ctx: RequestContext, zones: Zone[], channel: Channel, order?: Order): Zone {
        const countryCode = order?.shippingAddress?.countryCode;
        if (order && countryCode) {
            const zone = zones.find(z => z.members?.find(member => member.code === countryCode));
            if (zone) {
                return zone;
            }
            Logger.debug(
                `No tax zone found for country ${countryCode}. Returning default ${channel.defaultTaxZone.name} for order ${order.code}`,
                loggerCtx,
            );
        }
        return channel.defaultTaxZone;
    }
}
