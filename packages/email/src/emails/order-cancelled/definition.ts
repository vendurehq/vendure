import { OrderStateTransitionEvent } from '@vendure/core';

import { defineEmail } from '../../define-email';
import { markPackageDefault } from '../../template/email-template';
import { findSampleOrder, loadOrderForEmail } from '../order-helpers';

import { OrderCancelledTemplate } from './template';

/**
 * @description
 * Sent when an order is cancelled.
 *
 * @docsCategory core plugins/Email
 * @docsPage Default emails
 * @since 4.0.0
 */
export const orderCancelledEmail = defineEmail({
    type: 'order-cancelled',
    label: 'Order cancelled',
    event: OrderStateTransitionEvent,
    filter: event => event.toState === 'Cancelled' && !!event.order.customer && !!event.order.orderPlacedAt,
    data: async ({ event, ctx, injector }) => ({
        order: await loadOrderForEmail(ctx, injector, event.order.id),
    }),
    recipient: ({ data }) => data.order.customer?.emailAddress ?? '',
    metadata: ({ data }) => ({ orderId: data.order.id }),
    template: markPackageDefault(OrderCancelledTemplate),
    sample: async ({ ctx, injector, args }) => {
        const order = await findSampleOrder(ctx, injector, args, args.order ? undefined : { states: ['Cancelled'] });
        return order && new OrderStateTransitionEvent('PaymentSettled', 'Cancelled', ctx, order);
    },
    orderSend: {
        targets: ({ order }) => [
            {
                id: String(order.id),
                label: `Order ${order.code}`,
                eligible: order.state === 'Cancelled',
                reason: order.state === 'Cancelled' ? undefined : `The order is "${order.state}", not cancelled.`,
            },
        ],
        createEvent: ({ ctx, order }) => new OrderStateTransitionEvent('PaymentSettled', 'Cancelled', ctx, order),
    },
});
