import { RequestContext } from '../../api/common/request-context';
import { InjectableStrategy } from '../../common/types/injectable-strategy';
import { Order } from '../../entity/order/order.entity';
import { OrderLine } from '../../entity/order-line/order-line.entity';
import { ShippingLine } from '../../entity/shipping-line/shipping-line.entity';
/**
 * @description
 * This strategy is used to assign a given {@link ShippingLine} to one or more {@link OrderLine}s of the Order.
 * This allows you to set multiple shipping methods for a single order, each assigned a different subset of
 * OrderLines.
 *
 * The {@link DefaultShippingLineAssignmentStrategy} simply assigns _all_ OrderLines, so is suitable for the
 * most common scenario of a single shipping method per Order.
 *
 * :::info
 *
 * This is configured via the `shippingOptions.shippingLineAssignmentStrategy` property of
 * your VendureConfig.
 *
 * :::
 *
 * Here's an example of a custom ShippingLineAssignmentStrategy which assigns digital products to a
 * different ShippingLine to physical products:
 *
 * ```ts
 * import {
 *     Order,
 *     OrderLine,
 *     RequestContext,
 *     ShippingLine,
 *     ShippingLineAssignmentStrategy,
 * } from '\@vendure/core';
 *
 * export class DigitalShippingLineAssignmentStrategy implements ShippingLineAssignmentStrategy {
 *     assignShippingLineToOrderLines(
 *         ctx: RequestContext,
 *         shippingLine: ShippingLine,
 *         order: Order,
 *     ): OrderLine[] | Promise<OrderLine[]> {
 *         if (shippingLine.shippingMethod.customFields.isDigital) {
 *             return order.lines.filter(l => l.productVariant.customFields.isDigital);
 *         } else {
 *             return order.lines.filter(l => !l.productVariant.customFields.isDigital);
 *         }
 *     }
 * }
 * ```
 *
 * @since 2.0.0
 * @docsCategory shipping
 */
export interface ShippingLineAssignmentStrategy extends InjectableStrategy {
    assignShippingLineToOrderLines(
        ctx: RequestContext,
        shippingLine: ShippingLine,
        order: Order,
    ): OrderLine[] | Promise<OrderLine[]>;
}
