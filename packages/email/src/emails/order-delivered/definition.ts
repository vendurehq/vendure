import { FulfillmentStateTransitionEvent } from '@vendure/core';

import { defineEmail } from '../../define-email';
import { markPackageDefault } from '../../template/email-template';
import { fulfillmentEmailSend, loadFulfillmentData } from '../fulfillment-helpers';

import { OrderDeliveredTemplate } from './template';

const { orderSend, sample } = fulfillmentEmailSend('Delivered', ['Delivered']);

/**
 * @description
 * Sent when a fulfillment of an order is delivered.
 *
 * @docsCategory core plugins/Email
 * @docsPage Default emails
 * @since 4.0.0
 */
export const orderDeliveredEmail = defineEmail({
    type: 'order-delivered',
    label: 'Order delivered',
    event: FulfillmentStateTransitionEvent,
    filter: event => event.toState === 'Delivered',
    data: ({ event, ctx, injector }) => loadFulfillmentData(ctx, injector, event.fulfillment),
    recipient: ({ data }) => data.order.customer?.emailAddress ?? '',
    metadata: ({ data, event }) => ({ orderId: data.order.id, fulfillmentId: event.fulfillment.id }),
    template: markPackageDefault(OrderDeliveredTemplate),
    sample,
    orderSend,
});
