import { RequestContext } from '../../api/common/request-context';
import { Order } from '../../entity/order/order.entity';
import { OrderLine } from '../../entity/order-line/order-line.entity';

import { MergedOrderLine, OrderMergeStrategy, toMergedOrderLine } from './order-merge-strategy';

/**
 * @description
 * Merges both Orders. If the guest order contains items which are already in the
 * existing Order, the guest Order quantity will replace that of the existing Order.
 *
 * @docsCategory orders
 * @docsPage Merge Strategies
 */
export class MergeOrdersStrategy implements OrderMergeStrategy {
    merge(ctx: RequestContext, guestOrder: Order, existingOrder: Order): MergedOrderLine[] {
        const mergedLines: MergedOrderLine[] = existingOrder.lines.map(toMergedOrderLine);
        const guestLines = guestOrder.lines.slice();
        for (const guestLine of guestLines.reverse()) {
            const existingLine = this.findCorrespondingLine(existingOrder, guestLine);
            if (!existingLine) {
                mergedLines.unshift(toMergedOrderLine(guestLine));
            } else {
                const matchingMergedLine = mergedLines.find(l => l.orderLineId === existingLine.id);
                if (matchingMergedLine) {
                    matchingMergedLine.quantity = guestLine.quantity;
                }
            }
        }
        return mergedLines;
    }

    private findCorrespondingLine(existingOrder: Order, guestLine: OrderLine): OrderLine | undefined {
        return existingOrder.lines.find(
            line =>
                line.productVariant.id === guestLine.productVariant.id &&
                JSON.stringify(line.customFields) === JSON.stringify(guestLine.customFields),
        );
    }
}
