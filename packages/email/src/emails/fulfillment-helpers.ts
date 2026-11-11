import {
    Fulfillment,
    FulfillmentStateTransitionEvent,
    Injector,
    Order,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';

import { EmailFulfillment } from '../components/order-blocks';
import { OrderEmailSend, OrderEmailTarget, SampleEventFn } from '../define-email';

import { findSampleOrderWithTarget, loadOrderForEmail } from './order-helpers';

/**
 * Loads the order a fulfillment belongs to, and the fulfillment in a form the templates can use.
 */
export async function loadFulfillmentData(
    ctx: RequestContext,
    injector: Injector,
    fulfillment: Fulfillment,
): Promise<{ order: Order; fulfillment: EmailFulfillment }> {
    const withOrders = await injector
        .get(TransactionalConnection)
        .getRepository(ctx, Fulfillment)
        .findOne({ where: { id: fulfillment.id }, relations: { orders: true, lines: true } });
    const orderId = withOrders?.orders?.[0]?.id;
    if (!withOrders || orderId == null) {
        throw new Error(`Fulfillment ${String(fulfillment.id)} has no order`);
    }
    const order = await loadOrderForEmail(ctx, injector, orderId);
    return { order, fulfillment: toEmailFulfillment(order, withOrders) };
}

export function toEmailFulfillment(order: Order, fulfillment: Fulfillment): EmailFulfillment {
    const lines = (fulfillment.lines ?? []).flatMap(fulfillmentLine => {
        const orderLine = order.lines.find(l => String(l.id) === String(fulfillmentLine.orderLineId));
        return orderLine
            ? [
                  {
                      quantity: fulfillmentLine.quantity,
                      productVariant: { name: orderLine.productVariant.name },
                      featuredAsset: orderLine.featuredAsset ? { preview: orderLine.featuredAsset.preview } : null,
                  },
              ]
            : [];
    });
    return { method: fulfillment.method, trackingCode: fulfillment.trackingCode || null, lines };
}

function fulfillmentLabel(fulfillment: Fulfillment) {
    const tracking = fulfillment.trackingCode ? `, ${fulfillment.trackingCode}` : '';
    return `Fulfillment #${String(fulfillment.id)} (${fulfillment.method}${tracking}): ${fulfillment.state}`;
}

/**
 * The manual send and sample event of an email about one fulfillment.
 */
export function fulfillmentEmailSend(
    toState: 'Shipped' | 'Delivered',
    eligibleStates: string[],
): {
    orderSend: OrderEmailSend<FulfillmentStateTransitionEvent>;
    sample: SampleEventFn<FulfillmentStateTransitionEvent>;
} {
    const targets = (order: Order): OrderEmailTarget[] =>
        (order.fulfillments ?? [])
            .filter(f => f.state !== 'Cancelled')
            .map(f => ({
                id: String(f.id),
                label: fulfillmentLabel(f),
                eligible: eligibleStates.includes(f.state),
                reason: eligibleStates.includes(f.state)
                    ? undefined
                    : `The fulfillment is "${f.state}", not ${eligibleStates.join(' or ')}.`,
            }));
    const fromState = toState === 'Shipped' ? 'Pending' : 'Shipped';
    const createEvent = (ctx: RequestContext, order: Order, targetId: string) => {
        const fulfillment = (order.fulfillments ?? []).find(f => String(f.id) === targetId);
        if (!fulfillment) {
            throw new Error(`Order ${order.code} has no fulfillment with id "${targetId}"`);
        }
        return new FulfillmentStateTransitionEvent(fromState, toState, ctx, fulfillment);
    };
    return {
        orderSend: {
            targets: ({ order }) => targets(order),
            createEvent: ({ ctx, order, targetId }) => createEvent(ctx, order, targetId),
        },
        sample: async ({ ctx, injector, args }) => {
            const found = await findSampleOrderWithTarget(ctx, injector, args, targets);
            return found && createEvent(ctx, found.order, found.targetId);
        },
    };
}
