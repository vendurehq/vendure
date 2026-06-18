import { RequestContext } from '../../api/common/request-context';
import { Channel, Order, Zone } from '../../entity';

import { TaxZoneStrategy } from './tax-zone-strategy';

/**
 * @description
 * A default method of determining Zone for tax calculations. The strategy simply returns the default
 * tax zone of the Channel. In many cases you actually want to base the tax zone
 * on the shipping or billing address of the Order, in which case you would use the
 * {@link AddressBasedTaxZoneStrategy}.
 *
 * @docsCategory tax
 */
export class DefaultTaxZoneStrategy implements TaxZoneStrategy {
    determineTaxZone(ctx: RequestContext, zones: Zone[], channel: Channel, order?: Order): Zone {
        return channel.defaultTaxZone;
    }
}
