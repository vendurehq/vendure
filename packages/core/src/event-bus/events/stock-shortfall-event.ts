import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';
import { Order } from '../../entity/order/order.entity';
import { VendureEvent } from '../vendure-event';

/**
 * @description
 * Describes a single order line whose requested quantity could not be fully allocated
 * from available stock.
 *
 * @since 3.8.0
 * @docsCategory events
 * @docsPage Event Types
 */
export interface StockShortfall {
    productVariantId: ID;
    orderLineId: ID;
    requested: number;
    allocated: number;
}

/**
 * @description
 * This event is fired when stock allocation for an Order cannot fully satisfy the requested
 * quantities — i.e. the available stock was depleted (e.g. by concurrent orders) between the time
 * the cart passed the checkout stock check and the time stock was actually allocated. Because the
 * payment may already have been captured, allocation is capped to the available quantity rather than
 * failing, and this event is published so that plugins can react (refund, backorder, notify).
 *
 * @since 3.8.0
 * @docsCategory events
 * @docsPage Event Types
 */
export class StockShortfallEvent extends VendureEvent {
    constructor(
        public ctx: RequestContext,
        public order: Order,
        public shortfalls: StockShortfall[],
    ) {
        super();
    }
}
