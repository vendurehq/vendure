import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';
import { VendureEvent } from '../vendure-event';

/**
 * @description
 * This event is fired whenever an coupon code of an active {@link Promotion}
 * is assigned or removed to an {@link Order}.
 *
 * @docsCategory events
 * @docsPage Event Types
 * @since 1.4
 */
export class CouponCodeEvent extends VendureEvent {
    constructor(
        public ctx: RequestContext,
        public couponCode: string,
        public orderId: ID,
        public type: 'assigned' | 'removed',
    ) {
        super();
    }
}
