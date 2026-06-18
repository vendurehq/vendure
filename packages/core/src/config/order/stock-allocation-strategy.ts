import { RequestContext } from '../../api/common/request-context';
import { InjectableStrategy } from '../../common/types/injectable-strategy';
import { Order } from '../../entity/order/order.entity';
import { OrderState } from '../../service/helpers/order-state-machine/order-state';

/**
 * @description
 * This strategy is responsible for deciding at which stage in the order process
 * stock will be allocated.
 *
 * :::info
 *
 * This is configured via the `orderOptions.stockAllocationStrategy` property of
 * your VendureConfig.
 *
 * :::
 *
 * @docsCategory orders
 */
export interface StockAllocationStrategy extends InjectableStrategy {
    /**
     * @description
     * This method is called whenever an Order transitions from one state to another.
     * If it resolves to `true`, then stock will be allocated for this order.
     */
    shouldAllocateStock(
        ctx: RequestContext,
        fromState: OrderState,
        toState: OrderState,
        order: Order,
    ): boolean | Promise<boolean>;
}
