import { RequestContext } from '../../api/common/request-context';
import { Order } from '../../entity/order/order.entity';
import { Refund } from '../../entity/refund/refund.entity';
import { RefundState } from '../../service/helpers/refund-state-machine/refund-state';
import { VendureEvent } from '../vendure-event';

/**
 * @description
 * This event is fired whenever a {@link Refund} transitions from one {@link RefundState} to another.
 *
 * @docsCategory events
 * @docsPage Event Types
 */
export class RefundStateTransitionEvent extends VendureEvent {
    constructor(
        public fromState: RefundState,
        public toState: RefundState,
        public ctx: RequestContext,
        public refund: Refund,
        public order: Order,
    ) {
        super();
    }
}
