import { RequestContext } from '../../api';
import { Channel } from '../../entity';
import { VendureEvent } from '../vendure-event';

/**
 * @description
 * This event is fired when the `taxCountryCode` of a {@link Channel} changes. The tax country
 * chooses the rate that the Channel's tax-inclusive prices include, and the tax rate of prices with
 * no shipping country, so the prices of the Channel's variants can change. Search plugins subscribe
 * to it to reindex the Channel.
 *
 * Unlike {@link ChannelEvent}, it is only fired when the value actually changes. `channel` holds
 * the new value, and `previousTaxCountryCode` the old one.
 *
 * @docsCategory events
 * @docsPage Event Types
 * @since 4.0.0
 */
export class ChannelTaxCountryEvent extends VendureEvent {
    constructor(
        public ctx: RequestContext,
        public channel: Channel,
        public previousTaxCountryCode: string | null,
    ) {
        super();
    }
}
