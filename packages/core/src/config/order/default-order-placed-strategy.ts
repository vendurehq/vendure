import { RequestContext } from '../../api/common/request-context';
import { Order } from '../../entity/order/order.entity';
import { OrderState } from '../../service/helpers/order-state-machine/order-state';

import { OrderPlacedStrategy } from './order-placed-strategy';

/**
 * @description
 * The default {@link OrderPlacedStrategy}. The order is set as "placed" when it transitions from
 * 'ArrangingPayment' to either 'PaymentAuthorized' or 'PaymentSettled'.
 *
 * @docsCategory orders
 */
export class DefaultOrderPlacedStrategy implements OrderPlacedStrategy {
    shouldSetAsPlaced(
        ctx: RequestContext,
        fromState: OrderState,
        toState: OrderState,
        order: Order,
    ): boolean {
        return fromState === 'ArrangingPayment' &&
            (toState === 'PaymentAuthorized' || toState === 'PaymentSettled')
            ? true
            : false;
    }
}
