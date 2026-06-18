import { RequestContext } from '../../../api/common/request-context';
import { Fulfillment } from '../../../entity/fulfillment/fulfillment.entity';
import { Order } from '../../../entity/order/order.entity';

/**
 * @description
 * An interface to extend standard {@link FulfillmentState}.
 *
 * @deprecated use FulfillmentStates
 */
export interface CustomFulfillmentStates {}

/**
 * @description
 * An interface to extend standard {@link FulfillmentState}.
 *
 * @docsCategory fulfillment
 */
export interface FulfillmentStates {}

/**
 * @description
 * These are the default states of the fulfillment process. By default, they will be extended
 * by the {@link defaultFulfillmentProcess} to also include `Shipped` and `Delivered`.
 *
 *
 * @docsCategory fulfillment
 */
export type FulfillmentState =
    | 'Created'
    | 'Pending'
    | 'Cancelled'
    | keyof CustomFulfillmentStates
    | keyof FulfillmentStates;

/**
 * @description
 * The data which is passed to the state transition handler of the FulfillmentStateMachine.
 *
 * @docsCategory fulfillment
 */
export interface FulfillmentTransitionData {
    ctx: RequestContext;
    orders: Order[];
    fulfillment: Fulfillment;
}
