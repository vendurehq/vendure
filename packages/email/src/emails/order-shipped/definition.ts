import { FulfillmentStateTransitionEvent } from '@vendure/core';

import { defineEmail } from '../../define-email';
import { markPackageDefault } from '../../template/email-template';
import { fulfillmentEmailSend, loadFulfillmentData } from '../fulfillment-helpers';

import { OrderShippedTemplate } from './template';

const { orderSend, sample } = fulfillmentEmailSend('Shipped', ['Shipped', 'Delivered']);

/**
 * @description
 * Sent when a fulfillment of an order is shipped.
 *
 * @docsCategory core plugins/Email
 * @docsPage Default emails
 * @since 4.0.0
 */
export const orderShippedEmail = defineEmail({
    type: 'order-shipped',
    label: 'Order shipped',
    event: FulfillmentStateTransitionEvent,
    filter: event => event.toState === 'Shipped',
    data: ({ event, ctx, injector }) => loadFulfillmentData(ctx, injector, event.fulfillment),
    recipient: ({ data }) => data.order.customer?.emailAddress ?? '',
    metadata: ({ data, event }) => ({ orderId: data.order.id, fulfillmentId: event.fulfillment.id }),
    template: markPackageDefault(OrderShippedTemplate),
    sample,
    orderSend,
});
