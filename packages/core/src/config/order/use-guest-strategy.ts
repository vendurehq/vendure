import { RequestContext } from '../../api/common/request-context';
import { Order } from '../../entity/order/order.entity';

import { MergedOrderLine, OrderMergeStrategy, toMergedOrderLine } from './order-merge-strategy';

/**
 * @description
 * Any existing order is discarded and the guest order is set as the active order.
 *
 * @docsCategory orders
 * @docsPage Merge Strategies
 */
export class UseGuestStrategy implements OrderMergeStrategy {
    merge(ctx: RequestContext, guestOrder: Order, existingOrder: Order): MergedOrderLine[] {
        return guestOrder.lines.map(toMergedOrderLine);
    }
}
