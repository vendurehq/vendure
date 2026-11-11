import { Order, RefundStateTransitionEvent, RequestContext } from '@vendure/core';

import { defineEmail, OrderEmailTarget } from '../../define-email';
import { markPackageDefault } from '../../template/email-template';
import { findSampleOrderWithTarget, loadOrderForEmail } from '../order-helpers';

import { OrderRefundedTemplate } from './template';

function allRefunds(order: Order) {
    return (order.payments ?? []).flatMap(payment => (payment.refunds ?? []).map(refund => ({ payment, refund })));
}

function targets(order: Order): OrderEmailTarget[] {
    return allRefunds(order).map(({ payment, refund }) => ({
        id: String(refund.id),
        label: `Refund #${String(refund.id)} of ${(refund.total / 100).toFixed(2)} ${order.currencyCode} (${payment.method}): ${refund.state}`,
        eligible: refund.state === 'Settled',
        reason: refund.state === 'Settled' ? undefined : `The refund is "${refund.state}", not Settled.`,
    }));
}

function createEvent(ctx: RequestContext, order: Order, targetId: string) {
    const found = allRefunds(order).find(({ refund }) => String(refund.id) === targetId);
    if (!found) {
        throw new Error(`Order ${order.code} has no refund with id "${targetId}"`);
    }
    return new RefundStateTransitionEvent('Pending', 'Settled', ctx, found.refund, order);
}

/**
 * @description
 * Sent when a refund is settled.
 *
 * @docsCategory core plugins/Email
 * @docsPage Default emails
 * @since 4.0.0
 */
export const orderRefundedEmail = defineEmail({
    type: 'order-refunded',
    label: 'Order refunded',
    event: RefundStateTransitionEvent,
    filter: event => event.toState === 'Settled',
    data: async ({ event, ctx, injector }) => {
        const order = await loadOrderForEmail(ctx, injector, event.order.id);
        const { refund } = event;
        return {
            order,
            refund: { total: refund.total, method: refund.method ?? null, reason: refund.reason ?? null },
        };
    },
    recipient: ({ data }) => data.order.customer?.emailAddress ?? '',
    metadata: ({ data, event }) => ({ orderId: data.order.id, refundId: event.refund.id }),
    template: markPackageDefault(OrderRefundedTemplate),
    sample: async ({ ctx, injector, args }) => {
        const found = await findSampleOrderWithTarget(ctx, injector, args, targets);
        return found && createEvent(ctx, found.order, found.targetId);
    },
    orderSend: {
        targets: ({ order }) => targets(order),
        createEvent: ({ ctx, order, targetId }) => createEvent(ctx, order, targetId),
    },
});
