import { RequestContext } from '../../api/common/request-context';
import { InjectableStrategy } from '../../common/types/injectable-strategy';
import { Order } from '../../entity/order/order.entity';
import { OrderState } from '../../service/helpers/order-state-machine/order-state';

/**
 * @description
 * This strategy is responsible for deciding at which stage in the order process
 * the Order will be set as "placed" (i.e. the Customer has checked out, and
 * next it must be processed by an Administrator).
 *
 * By default, the order is set as "placed" when it transitions from
 * 'ArrangingPayment' to either 'PaymentAuthorized' or 'PaymentSettled'.
 *
 * :::info
 *
 * This is configured via the `orderOptions.orderPlacedStrategy` property of
 * your VendureConfig.
 *
 * :::
 *
 * @docsCategory orders
 */
export interface OrderPlacedStrategy extends InjectableStrategy {
    /**
     * @description
     * This method is called whenever an _active_ Order transitions from one state to another.
     * If it resolves to `true`, then the Order will be set as "placed", which means:
     *
     * * Order.active = false
     * * Order.placedAt = new Date()
     * * Any active Promotions are linked to the Order
     */
    shouldSetAsPlaced(
        ctx: RequestContext,
        fromState: OrderState,
        toState: OrderState,
        order: Order,
    ): boolean | Promise<boolean>;
}
