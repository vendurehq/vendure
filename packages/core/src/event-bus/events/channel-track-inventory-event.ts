import { RequestContext } from '../../api';
import { Channel } from '../../entity';
import { VendureEvent } from '../vendure-event';

/**
 * @description
 * This event is fired when the `trackInventory` setting of a {@link Channel} changes. It is the
 * default for every ProductVariant and StockLevel set to `INHERIT`, so which of the Channel's
 * variants are in stock can change. Search plugins subscribe to it to reindex the Channel.
 *
 * Unlike {@link ChannelEvent}, it is only fired when the value actually changes, not on every
 * update which includes it.
 *
 * @docsCategory events
 * @docsPage Event Types
 * @since 4.0.0
 */
export class ChannelTrackInventoryEvent extends VendureEvent {
    constructor(
        public ctx: RequestContext,
        public channel: Channel,
        public trackInventory: boolean,
    ) {
        super();
    }
}
