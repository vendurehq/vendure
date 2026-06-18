import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';
import { Product } from '../../entity';
import { VendureEvent } from '../vendure-event';

/**
 * @description
 * This event is fired whenever a {@link Product} is added, updated
 * or deleted.
 *
 * @docsCategory events
 * @docsPage Event Types
 */
export class ProductChannelEvent extends VendureEvent {
    constructor(
        public ctx: RequestContext,
        public product: Product,
        public channelId: ID,
        public type: 'assigned' | 'removed',
    ) {
        super();
    }
}
