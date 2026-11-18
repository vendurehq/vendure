import { RequestContext } from '../../api';
import { Channel } from '../../entity';
import { VendureEvent } from '../vendure-event';

/**
 * @description
 * The Channel settings which decide which of its ProductVariants are in stock, as reported by
 * {@link ChannelStockSettingsEvent}.
 *
 * @docsCategory events
 * @docsPage Event Types
 * @since 4.0.0
 */
export type ChannelStockSetting = 'trackInventory' | 'outOfStockThreshold';

/**
 * @description
 * This event is fired when the `trackInventory` or `outOfStockThreshold` setting of a
 * {@link Channel} changes. `trackInventory` is the default for every ProductVariant and StockLevel
 * set to `INHERIT`, and `outOfStockThreshold` is used by every ProductVariant with
 * `useGlobalOutOfStockThreshold`, so which of the Channel's variants are in stock can change.
 * Search plugins subscribe to it to reindex the Channel.
 *
 * Unlike {@link ChannelEvent}, it is only fired when a value actually changes, not on every
 * update which includes it. `changed` lists the settings which changed; `channel` holds the new
 * values.
 *
 * @docsCategory events
 * @docsPage Event Types
 * @since 4.0.0
 */
export class ChannelStockSettingsEvent extends VendureEvent {
    constructor(
        public ctx: RequestContext,
        public channel: Channel,
        public changed: ChannelStockSetting[],
    ) {
        super();
    }
}
