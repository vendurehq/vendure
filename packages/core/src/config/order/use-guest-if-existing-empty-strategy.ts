import { RequestContext } from '../../api/common/request-context';
import { Order } from '../../entity/order/order.entity';

import { MergedOrderLine, OrderMergeStrategy, toMergedOrderLine } from './order-merge-strategy';

/**
 * @description
 * If the existing order is empty, then the guest order is used. Otherwise the existing order is used.
 *
 * @docsCategory orders
 * @docsPage Merge Strategies
 */
export class UseGuestIfExistingEmptyStrategy implements OrderMergeStrategy {
    merge(ctx: RequestContext, guestOrder: Order, existingOrder: Order): MergedOrderLine[] {
        return existingOrder.lines.length
            ? existingOrder.lines.map(toMergedOrderLine)
            : guestOrder.lines.map(toMergedOrderLine);
    }
}
