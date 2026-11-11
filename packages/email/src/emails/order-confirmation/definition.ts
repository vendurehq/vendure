import { OrderStateTransitionEvent } from '@vendure/core';

import { defineEmail } from '../../define-email';
import { markPackageDefault } from '../../template/email-template';
import { findSampleOrder, loadOrderForEmail, shippingLinesWithMethod } from '../order-helpers';

import { OrderConfirmationTemplate } from './template';

/** Order states in which the order confirmation has been (or should have been) sent. */
const CONFIRMED_STATES = ['PaymentSettled', 'PartiallyShipped', 'Shipped', 'PartiallyDelivered', 'Delivered'];

/**
 * @description
 * Sent when an order's payment is settled.
 *
 * @docsCategory core plugins/Email
 * @docsPage Default emails
 * @since 4.0.0
 */
export const orderConfirmationEmail = defineEmail({
    type: 'order-confirmation',
    label: 'Order confirmation',
    event: OrderStateTransitionEvent,
    filter: event =>
        event.toState === 'PaymentSettled' && event.fromState !== 'Modifying' && !!event.order.customer,
    data: async ({ event, ctx, injector }) => {
        const order = await loadOrderForEmail(ctx, injector, event.order.id);
        return { order, shippingLines: shippingLinesWithMethod(order) };
    },
    recipient: ({ data }) => data.order.customer?.emailAddress ?? '',
    metadata: ({ data }) => ({ orderId: data.order.id }),
    template: markPackageDefault(OrderConfirmationTemplate),
    sample: async ({ ctx, injector, args }) => {
        const order = await findSampleOrder(ctx, injector, args);
        return order && new OrderStateTransitionEvent('ArrangingPayment', 'PaymentSettled', ctx, order);
    },
    orderSend: {
        targets: ({ order }) => [
            {
                id: String(order.id),
                label: `Order ${order.code}`,
                eligible: CONFIRMED_STATES.includes(order.state),
                reason: CONFIRMED_STATES.includes(order.state)
                    ? undefined
                    : `The order is "${order.state}". The confirmation is sent once payment is settled.`,
            },
        ],
        createEvent: ({ ctx, order }) =>
            new OrderStateTransitionEvent('ArrangingPayment', 'PaymentSettled', ctx, order),
    },
});
