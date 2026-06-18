import { RequestContext } from '../../../api/common/request-context';
import { Order } from '../../../entity/order/order.entity';

/**
 * @description
 * An interface to extend standard {@link OrderState}.
 *
 * @docsCategory orders
 * @deprecated use OrderStates
 */
export interface CustomOrderStates {}

/**
 * @description
 * An interface to extend the {@link OrderState} type.
 *
 * @docsCategory orders
 * @docsPage OrderProcess
 * @since 2.0.0
 */
export interface OrderStates {}

/**
 * @description
 * These are the default states of the Order process. They can be augmented and
 * modified by using the {@link OrderOptions} `process` property, and by default
 * the {@link defaultOrderProcess} will add the states
 *
 * - `ArrangingPayment`
 * - `PaymentAuthorized`
 * - `PaymentSettled`
 * - `PartiallyShipped`
 * - `Shipped`
 * - `PartiallyDelivered`
 * - `Delivered`
 * - `Modifying`
 * - `ArrangingAdditionalPayment`
 *
 * @docsCategory orders
 * @docsPage OrderProcess
 */
export type OrderState =
    | 'Created'
    | 'Draft'
    | 'AddingItems'
    | 'Cancelled'
    | keyof CustomOrderStates
    | keyof OrderStates;

/**
 * @description
 * This is the object passed to the {@link OrderProcess} state transition hooks.
 *
 * @docsCategory orders
 * @docsPage OrderProcess
 */
export interface OrderTransitionData {
    ctx: RequestContext;
    order: Order;
}
