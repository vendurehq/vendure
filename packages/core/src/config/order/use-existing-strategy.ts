import { RequestContext } from '../../api/common/request-context';
import { Order } from '../../entity/order/order.entity';

import { MergedOrderLine, OrderMergeStrategy, toMergedOrderLine } from './order-merge-strategy';

/**
 * @description
 * The guest order is discarded and the existing order is used as the active order.
 *
 * @docsCategory orders
 * @docsPage Merge Strategies
 */
export class UseExistingStrategy implements OrderMergeStrategy {
    merge(ctx: RequestContext, guestOrder: Order, existingOrder: Order): MergedOrderLine[] {
        return existingOrder.lines.map(toMergedOrderLine);
    }
}
