import { OrderLineInput } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import { summate } from '@vendure/common/lib/shared-utils';
import { unique } from '@vendure/common/lib/unique';
import { In } from 'typeorm';

import { RequestContext } from '../../../api/common/request-context';
import { EntityNotFoundError } from '../../../common/error/errors';
import { idsAreEqual } from '../../../common/utils';
import { TransactionalConnection } from '../../../connection/transactional-connection';
import { FulfillmentLine } from '../../../entity/order-line-reference/fulfillment-line.entity';
import { OrderLine } from '../../../entity/order-line/order-line.entity';
import { Order } from '../../../entity/order/order.entity';
import { FulfillmentState } from '../fulfillment-state-machine/fulfillment-state';
import { PaymentState } from '../payment-state-machine/payment-state';

/**
 * Returns true if the Order total is covered by Payments in the specified state.
 */
export function orderTotalIsCovered(order: Order, state: PaymentState | PaymentState[]): boolean {
    const paymentsTotal = totalCoveredByPayments(order, state);
    return paymentsTotal >= order.totalWithTax;
}

/**
 * Returns the total amount covered by all Payments (minus any refunds)
 */
export function totalCoveredByPayments(order: Order, state?: PaymentState | PaymentState[]): number {
    const payments = state
        ? Array.isArray(state)
            ? order.payments.filter(p => state.includes(p.state))
            : order.payments.filter(p => p.state === state)
        : order.payments.filter(
              p => p.state !== 'Error' && p.state !== 'Declined' && p.state !== 'Cancelled',
          );
    let total = 0;
    for (const payment of payments) {
        const settledRefunds = payment.refunds?.filter(refund => refund.state === 'Settled') ?? [];
        const settledRefundTotal = summate(settledRefunds, 'total');
        total += payment.amount - Math.abs(settledRefundTotal);
    }
    return total;
}

/**
 * Returns true if all (non-cancelled) OrderItems are delivered.
 */
export function orderItemsAreDelivered(order: Order) {
    return (
        getOrderLinesFulfillmentStates(order).every(state => state === 'Delivered') &&
        !isOrderPartiallyFulfilled(order)
    );
}

/**
 * Returns true if at least one, but not all (non-cancelled) OrderItems are delivered.
 */
export function orderItemsArePartiallyDelivered(order: Order) {
    const states = getOrderLinesFulfillmentStates(order);
    return (
        states.some(state => state === 'Delivered') &&
        (!states.every(state => state === 'Delivered') || isOrderPartiallyFulfilled(order))
    );
}

function getOrderLinesFulfillmentStates(order: Order): Array<FulfillmentState | undefined> {
    const fulfillmentLines = getOrderFulfillmentLines(order);
    const states = unique(
        order.lines
            .filter(line => line.quantity !== 0)
            .map(line => {
                const matchingFulfillmentLines = fulfillmentLines.filter(fl =>
                    idsAreEqual(fl.orderLineId, line.id),
                );
                const totalFulfilled = summate(matchingFulfillmentLines, 'quantity');
                if (0 < totalFulfilled) {
                    return matchingFulfillmentLines.map(l => l.fulfillment.state);
                } else {
                    return undefined;
                }
            })
            .flat(),
    );
    return states;
}

/**
 * Returns true if at least one, but not all (non-cancelled) OrderItems are shipped.
 */
export function orderItemsArePartiallyShipped(order: Order) {
    const states = getOrderLinesFulfillmentStates(order);
    return (
        states.some(state => state === 'Shipped') &&
        (!states.every(state => state === 'Shipped') || isOrderPartiallyFulfilled(order))
    );
}

/**
 * Returns true if all (non-cancelled) OrderItems are shipped.
 */
export function orderItemsAreShipped(order: Order) {
    return (
        getOrderLinesFulfillmentStates(order).every(state => state === 'Shipped') &&
        !isOrderPartiallyFulfilled(order)
    );
}

/**
 * Returns true if all OrderItems in the order are cancelled
 */
export function orderLinesAreAllCancelled(order: Order) {
    return order.lines.every(line => line.quantity === 0);
}

function getOrderFulfillmentLines(order: Order): FulfillmentLine[] {
    return order.fulfillments
        .filter(f => f.state !== 'Cancelled')
        .reduce(
            (fulfillmentLines, fulfillment) => [...fulfillmentLines, ...fulfillment.lines],
            [] as FulfillmentLine[],
        );
}

/**
 * Returns true if Fulfillments exist for only some but not all of the
 * order items.
 */
function isOrderPartiallyFulfilled(order: Order) {
    const fulfillmentLines = getOrderFulfillmentLines(order);
    const lines = fulfillmentLines.reduce(
        (acc, item) => {
            acc[item.orderLineId] = (acc[item.orderLineId] || 0) + item.quantity;
            return acc;
        },
        {} as { [orderLineId: string]: number },
    );
    return order.lines.some(line => line.quantity > lines[line.id]);
}

export async function getOrdersFromLines(
    ctx: RequestContext,
    connection: TransactionalConnection,
    orderLinesInput: OrderLineInput[],
): Promise<Order[]> {
    const orders = new Map<ID, Order>();
    const lines = await connection.getRepository(ctx, OrderLine).find({
        where: { id: In(orderLinesInput.map(l => l.orderLineId)) },
        relations: ['order', 'order.channels'],
        order: { id: 'ASC' },
    });
    for (const line of lines) {
        const inputLine = orderLinesInput.find(l => idsAreEqual(l.orderLineId, line.id));
        if (!inputLine) {
            continue;
        }
        const order = line.order;
        if (!order.channels.some(channel => channel.id === ctx.channelId)) {
            throw new EntityNotFoundError('Order', order.id);
        }
        if (!orders.has(order.id)) {
            orders.set(order.id, order);
        }
    }
    return Array.from(orders.values());
}
