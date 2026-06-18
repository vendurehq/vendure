import { RequestContext } from '../../../api/common/request-context';
import { Order } from '../../../entity/order/order.entity';
import { Refund } from '../../../entity/refund/refund.entity';

/**
 * @description
 * An interface to extend standard {@link RefundState}.
 *
 * @deprecated use RefundStates
 */
export interface CustomRefundStates {}

/**
 * @description
 * An interface to extend standard {@link RefundState}.
 *
 * @docsCategory payment
 */
export interface RefundStates {}

/**
 * @description
 * These are the default states of the refund process.
 *
 * @docsCategory payment
 */
export type RefundState = 'Pending' | 'Settled' | 'Failed' | keyof CustomRefundStates | keyof RefundStates;

/**
 * @description
 * The data which is passed to the state transition handler of the RefundStateMachine.
 *
 * @docsCategory payment
 */
export interface RefundTransitionData {
    ctx: RequestContext;
    order: Order;
    refund: Refund;
}
