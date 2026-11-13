import { RelationPaths } from '../../../api/decorators/relations.decorator';
import { Order } from '../../../entity/order/order.entity';

/**
 * The relations loaded on the Order which is passed to a RefundDestinationStrategy. The
 * `refundDestinations` query and the `refundOrder` mutation must both load exactly these, so that
 * `isAvailable()` gives the same answer when the destinations are listed as when a refund is made.
 */
export const REFUND_ORDER_RELATIONS: RelationPaths<Order> = ['payments', 'payments.refunds'];
