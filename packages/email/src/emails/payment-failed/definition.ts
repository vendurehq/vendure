import { Order, PaymentStateTransitionEvent, RequestContext } from '@vendure/core';

import { defineEmail, OrderEmailTarget } from '../../define-email';
import { markPackageDefault } from '../../template/email-template';
import { findSampleOrderWithTarget, loadOrderForEmail } from '../order-helpers';

import { PaymentFailedTemplate } from './template';

const FAILED_STATES = ['Declined', 'Error'];
const SUCCESSFUL_STATES = ['Authorized', 'Settled'];

function targets(order: Order): OrderEmailTarget[] {
    const payments = order.payments ?? [];
    const paid = payments.some(p => SUCCESSFUL_STATES.includes(p.state));
    return payments
        .filter(p => p.state !== 'Cancelled')
        .map(payment => {
            const failed = FAILED_STATES.includes(payment.state);
            return {
                id: String(payment.id),
                label: `Payment #${String(payment.id)} of ${(payment.amount / 100).toFixed(2)} ${order.currencyCode} (${payment.method}): ${payment.state}`,
                eligible: failed && !paid,
                reason: !failed
                    ? `The payment is "${payment.state}", not Declined or Error.`
                    : paid
                      ? 'The order has a successful payment, so this failure no longer applies.'
                      : undefined,
            };
        });
}

function createEvent(ctx: RequestContext, order: Order, targetId: string) {
    const payment = (order.payments ?? []).find(p => String(p.id) === targetId);
    if (!payment) {
        throw new Error(`Order ${order.code} has no payment with id "${targetId}"`);
    }
    return new PaymentStateTransitionEvent('Created', payment.state, ctx, payment, order);
}

/**
 * @description
 * Sent when a payment is declined or fails with an error.
 *
 * @docsCategory core plugins/Email
 * @docsPage Default emails
 * @since 4.0.0
 */
export const paymentFailedEmail = defineEmail({
    type: 'payment-failed',
    label: 'Payment failed',
    event: PaymentStateTransitionEvent,
    filter: event => FAILED_STATES.includes(event.toState) && !!event.order.customer,
    data: async ({ event, ctx, injector }) => {
        const order = await loadOrderForEmail(ctx, injector, event.order.id);
        const { payment } = event;
        return {
            order,
            payment: { amount: payment.amount, method: payment.method, errorMessage: payment.errorMessage ?? null },
        };
    },
    recipient: ({ data }) => data.order.customer?.emailAddress ?? '',
    metadata: ({ data, event }) => ({ orderId: data.order.id, paymentId: event.payment.id }),
    template: markPackageDefault(PaymentFailedTemplate),
    sample: async ({ ctx, injector, args }) => {
        const found = await findSampleOrderWithTarget(ctx, injector, args, targets);
        return found && createEvent(ctx, found.order, found.targetId);
    },
    orderSend: {
        targets: ({ order }) => targets(order),
        createEvent: ({ ctx, order, targetId }) => createEvent(ctx, order, targetId),
    },
});
