import { RequestContext } from '../../api/common/request-context';
import { Order } from '../../entity/order/order.entity';
import { OrderState } from '../../service/helpers/order-state-machine/order-state';

import { StockAllocationStrategy } from './stock-allocation-strategy';

/**
 * @description
 * Allocates stock when the Order transitions from `ArrangingPayment` to either
 * `PaymentAuthorized` or `PaymentSettled`.
 *
 * @docsCategory orders
 */
export class DefaultStockAllocationStrategy implements StockAllocationStrategy {
    shouldAllocateStock(
        ctx: RequestContext,
        fromState: OrderState,
        toState: OrderState,
        order: Order,
    ): boolean | Promise<boolean> {
        return (
            fromState === 'ArrangingPayment' &&
            (toState === 'PaymentAuthorized' || toState === 'PaymentSettled')
        );
    }
}
