import { RequestContext } from '../../../api/common/request-context';
import { Order } from '../../../entity/order/order.entity';
import { Payment } from '../../../entity/payment/payment.entity';

/**
 * @description
 * An interface to extend standard {@link PaymentState}.
 *
 * @deprecated use PaymentStates
 */
export interface CustomPaymentStates {}

/**
 * @description
 * An interface to extend standard {@link PaymentState}.
 *
 * @docsCategory payment
 */
export interface PaymentStates {}

/**
 * @description
 * These are the default states of the payment process.
 *
 * @docsCategory payment
 */
export type PaymentState =
    | 'Created'
    | 'Error'
    | 'Cancelled'
    | keyof CustomPaymentStates
    | keyof PaymentStates;

/**
 * @description
 * The data which is passed to the `onStateTransitionStart` function configured when constructing
 * a new `PaymentMethodHandler`
 *
 * @docsCategory payment
 */
export interface PaymentTransitionData {
    ctx: RequestContext;
    payment: Payment;
    order: Order;
}
