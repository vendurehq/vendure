import { RequestContext } from '../../api/common/request-context';
import { OrderLine } from '../../entity/order-line/order-line.entity';
import { Order } from '../../entity/order/order.entity';

import { OrderLineDiscountDistributionStrategy } from './order-line-discount-distribution-strategy';

/**
 * @description
 * The default {@link OrderLineDiscountDistributionStrategy}. Weights each line by its current
 * prorated line price (incl. tax) and assigns zero weight to fully-canceled lines (quantity 0).
 * This reproduces Vendure's historical distribution behavior exactly.
 *
 * This default is consistent with Vendure's promotion model, in which order-level promotions are
 * re-evaluated on every order modification. When an order line is canceled, its share of an
 * order-level discount is redistributed across the surviving lines.
 *
 * Note that for **unconditional** order-level promotions (e.g. a flat "$50 off" with no minimum),
 * this redistribution means a partial refund reduces the order total by more than the amount
 * refunded, since the canceled line's discount share moves onto the retained lines. Stores that
 * require the discount distributions to be immutable by refunds should provide a custom strategy
 * that weights lines by their originally-placed quantity (see the example on
 * {@link OrderLineDiscountDistributionStrategy}).
 *
 * @docsCategory orders
 * @docsPage OrderLineDiscountDistributionStrategy
 * @since 3.7.0
 */
export class DefaultOrderLineDiscountDistributionStrategy implements OrderLineDiscountDistributionStrategy {
    // A placement-stable default (weighting lines by their originally-placed quantity) was considered
    // for v4 and rejected: it is right for fixed-amount order discounts (#4811), but under-discounts
    // the remaining lines for percentage discounts, whose amount already shrinks with a removed line.
    // getWeight() does not receive the promotion, so a strategy cannot tell the two apart.
    getWeight(ctx: RequestContext, line: OrderLine, order: Order): number {
        return line.quantity !== 0 ? line.proratedLinePriceWithTax : 0;
    }
}
