import { RequestContext } from '../../api/common/request-context';
import { Order } from '../../entity/order/order.entity';
import { OrderState } from '../../service/helpers/order-state-machine/order-state';
import { VendureEvent } from '../vendure-event';

/**
 * @description
 * This event is fired whenever an {@link Order} is set as "placed", which by default is
 * when it transitions from 'ArrangingPayment' to either 'PaymentAuthorized' or 'PaymentSettled'.
 *
 * Note that the exact point that it is set as "placed" can be configured according to the
 * {@link OrderPlacedStrategy}.
 *
 * @docsCategory events
 * @docsPage Event Types
 */
export class OrderPlacedEvent extends VendureEvent {
    constructor(
        public fromState: OrderState,
        public toState: OrderState,
        public ctx: RequestContext,
        public order: Order,
    ) {
        super();
    }
}
