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
    // TODO (next major): consider making a placement-stable strategy (weighting lines by their
    // originally-placed quantity) the default, so that refunds reconcile with the order total for
    // unconditional order-level promotions. See https://github.com/vendure-ecommerce/vendure/issues/4811
    getWeight(ctx: RequestContext, line: OrderLine, order: Order): number {
        return line.quantity !== 0 ? line.proratedLinePriceWithTax : 0;
    }
}
