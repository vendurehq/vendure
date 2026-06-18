import { RequestContext } from '../../api/common/request-context';
import { Order } from '../../entity/order/order.entity';
import { OrderLine } from '../../entity/order-line/order-line.entity';
import { ShippingLine } from '../../entity/shipping-line/shipping-line.entity';

import { ShippingLineAssignmentStrategy } from './shipping-line-assignment-strategy';

/**
 * @description
 * This is the default {@link ShippingLineAssignmentStrategy} which simply assigns all OrderLines to the
 * ShippingLine, and is suitable for the most common scenario of a single shipping method per Order.
 *
 * @since 2.0.0
 * @docsCategory shipping
 */
export class DefaultShippingLineAssignmentStrategy implements ShippingLineAssignmentStrategy {
    assignShippingLineToOrderLines(
        ctx: RequestContext,
        shippingLine: ShippingLine,
        order: Order,
    ): OrderLine[] | Promise<OrderLine[]> {
        return order.lines;
    }
}
