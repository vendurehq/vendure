import { RequestContext } from '../../api/common/request-context';
import { Order } from '../../entity/order/order.entity';
import { Payment } from '../../entity/payment/payment.entity';
import { PaymentState } from '../../service/helpers/payment-state-machine/payment-state';
import { VendureEvent } from '../vendure-event';

/**
 * @description
 * This event is fired whenever a {@link Payment} transitions from one {@link PaymentState} to another, e.g.
 * a Payment is authorized by the payment provider.
 *
 * The `order` may be loaded without its relations, for example when a Payment is settled,
 * cancelled or moved with `transitionPaymentToState`. Properties such as `order.totalQuantity`,
 * `order.discounts` and `order.taxSummary` need `order.lines`. Load the relations you need with
 * the {@link EntityHydrator} before you use them.
 *
 * @docsCategory events
 * @docsPage Event Types
 */
export class PaymentStateTransitionEvent extends VendureEvent {
    constructor(
        public fromState: PaymentState,
        public toState: PaymentState,
        public ctx: RequestContext,
        public payment: Payment,
        public order: Order,
    ) {
        super();
    }
}
