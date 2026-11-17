import {
    CustomOrderProcess,
    defaultOrderProcess,
    EventBus,
    HistoryEntryEvent,
    mergeConfig,
    OrderLineEvent,
    OrderStateTransitionEvent,
    StockMovementEvent,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { testSuccessfulPaymentMethod } from './fixtures/test-payment-methods';
import { addItemToOrderDocument, addPaymentDocument } from './graphql/shop-definitions';
import { proceedToArrangingPayment } from './utils/test-order-utils';

/**
 * OrderService.cancelOrder() cancels the lines (and writes stock movements) before it transitions the
 * Order to Cancelled. When an OrderProcess refuses that transition, nothing may be changed: not the
 * lines, not the stock, not the state, and no event may reach subscribers.
 */
let cancelGuard:
    | 'refuse'
    | 'refuseWithFalse'
    | 'requireZeroSubTotal'
    | 'requireZeroTotal'
    | 'requireLinesCancelled'
    | 'setCustomField' = 'refuse';
let cancelGuardCalls = 0;

const guardCancelProcess: CustomOrderProcess<never> = {
    onTransitionStart(fromState, toState, { order }) {
        if (toState !== 'Cancelled') {
            return;
        }
        cancelGuardCalls++;
        switch (cancelGuard) {
            case 'refuse':
                return 'This order has been released to the kitchen';
            case 'refuseWithFalse':
                return false;
            case 'requireZeroSubTotal':
                return order.subTotalWithTax === 0 ? undefined : 'The order still has a subtotal';
            case 'requireZeroTotal':
                return order.totalWithTax === 0 ? undefined : 'The order still has a total';
            case 'requireLinesCancelled':
                return order.lines.every(l => l.quantity === 0) ? undefined : 'The lines are not cancelled';
            case 'setCustomField':
                (order.customFields as { cancelledBy?: string }).cancelledBy = 'guard';
                return;
        }
    },
};

const CANCEL_ORDER = gql`
    mutation CancelOrder($input: CancelOrderInput!) {
        cancelOrder(input: $input) {
            ... on Order {
                id
                state
            }
            ... on ErrorResult {
                errorCode
                message
            }
            ... on OrderStateTransitionError {
                transitionError
            }
        }
    }
`;

const GET_ORDER = gql`
    query GetOrder($id: ID!) {
        order(id: $id) {
            id
            state
            totalWithTax
            lines {
                id
                quantity
            }
        }
    }
`;

const GET_ORDER_TOTALS = gql`
    query GetOrderTotals($id: ID!) {
        order(id: $id) {
            id
            state
            shippingWithTax
            totalWithTax
            customFields {
                cancelledBy
            }
        }
    }
`;

const GET_ORDER_HISTORY_TYPES = gql`
    query GetOrderHistoryTypes($id: ID!) {
        order(id: $id) {
            id
            history {
                items {
                    type
                }
            }
        }
    }
`;

const TRACK_VARIANT_INVENTORY = gql`
    mutation TrackVariantInventory($id: ID!) {
        updateProductVariants(input: [{ id: $id, trackInventory: TRUE }]) {
            id
        }
    }
`;

const GET_VARIANT_STOCK = gql`
    query GetVariantStock($id: ID!) {
        productVariant(id: $id) {
            id
            stockOnHand
            stockAllocated
        }
    }
`;

// OSS-938 — a cancel refused by an OrderProcess must not cancel lines or release stock
describe('cancelOrder refused by an OrderProcess', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            orderOptions: {
                process: [defaultOrderProcess, guardCancelProcess],
            },
            customFields: {
                Order: [{ name: 'cancelledBy', type: 'string', nullable: true }],
            },
            paymentOptions: {
                paymentMethodHandlers: [testSuccessfulPaymentMethod],
            },
        }),
    );

    beforeAll(async () => {
        await server.init({
            initialData: {
                ...initialData,
                paymentMethods: [
                    {
                        name: testSuccessfulPaymentMethod.code,
                        handler: { code: testSuccessfulPaymentMethod.code, arguments: [] },
                    },
                ],
            },
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
        await adminClient.query(TRACK_VARIANT_INVENTORY, { id: 'T_1' });
        const eventBus = server.app.get(EventBus);
        eventBus.ofType(OrderLineEvent).subscribe(e => events.push(`OrderLineEvent:${e.type}`));
        eventBus
            .ofType(StockMovementEvent)
            .subscribe(e => e.stockMovements.forEach(m => events.push(`StockMovementEvent:${m.type}`)));
        eventBus
            .ofType(HistoryEntryEvent)
            .subscribe(e => events.push(`HistoryEntryEvent:${(e.input as { type: string }).type}`));
        eventBus
            .ofType(OrderStateTransitionEvent)
            .subscribe(e => events.push(`OrderStateTransitionEvent:${e.fromState}->${e.toState}`));
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    let orderId: string;
    let lineId: string;
    const events: string[] = [];

    // Subscribers receive events after the transaction commits, so give them a moment to arrive.
    async function eventsPublishedBy(work: () => Promise<unknown>): Promise<string[]> {
        events.length = 0;
        await work();
        await new Promise(resolve => setTimeout(resolve, 100));
        return [...events];
    }

    async function getHistoryTypes(id: string): Promise<string[]> {
        const { order } = await adminClient.query(GET_ORDER_HISTORY_TYPES, { id });
        return order.history.items.map((i: any) => i.type);
    }

    // Only the committed partial cancel of one unit may leave an ORDER_CANCELLATION entry.
    function historyCancellations(types: string[]): number {
        return types.filter(t => t === 'ORDER_CANCELLATION').length;
    }

    async function placeOrder(quantity: number) {
        await shopClient.query(addItemToOrderDocument, { productVariantId: 'T_1', quantity });
        const id = await proceedToArrangingPayment(shopClient);
        await shopClient.query(addPaymentDocument, {
            input: { method: testSuccessfulPaymentMethod.code, metadata: {} },
        });
        return id as string;
    }

    async function getStock() {
        const { productVariant } = await adminClient.query(GET_VARIANT_STOCK, { id: 'T_1' });
        return { stockOnHand: productVariant.stockOnHand, stockAllocated: productVariant.stockAllocated };
    }

    it('leaves the Order lines untouched when the Cancelled transition is refused', async () => {
        await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
        orderId = await placeOrder(2);
        const { order: placedOrder } = await adminClient.query(GET_ORDER, { id: orderId });
        lineId = placedOrder.lines[0].id;
        const stockBefore = await getStock();
        expect(stockBefore.stockAllocated).toBe(2);

        let cancelOrder: any;
        const published = await eventsPublishedBy(async () => {
            ({ cancelOrder } = await adminClient.query(CANCEL_ORDER, { input: { orderId } }));
        });
        expect(cancelOrder.errorCode).toBe('ORDER_STATE_TRANSITION_ERROR');
        expect(cancelOrder.transitionError).toBe('This order has been released to the kitchen');
        expect(published).toEqual([]);

        const { order } = await adminClient.query(GET_ORDER, { id: orderId });
        expect(order.state).toBe('PaymentSettled');
        expect(order.lines.map((l: any) => l.quantity)).toEqual([2]);
        expect(order.totalWithTax).toBe(placedOrder.totalWithTax);
        expect(await getStock()).toEqual(stockBefore);
        expect(await getHistoryTypes(orderId)).not.toContain('ORDER_CANCELLATION');
    });

    it('still cancels some of the lines, since a partial cancel does not transition the Order', async () => {
        const { cancelOrder } = await adminClient.query(CANCEL_ORDER, {
            input: { orderId, lines: [{ orderLineId: lineId, quantity: 1 }] },
        });
        expect(cancelOrder.state).toBe('PaymentSettled');

        const { order } = await adminClient.query(GET_ORDER, { id: orderId });
        expect(order.lines.map((l: any) => l.quantity)).toEqual([1]);
        expect((await getStock()).stockAllocated).toBe(1);
    });

    it('leaves the Order lines untouched when the given lines would cancel every line', async () => {
        const stockBefore = await getStock();

        let cancelOrder: any;
        const published = await eventsPublishedBy(async () => {
            ({ cancelOrder } = await adminClient.query(CANCEL_ORDER, {
                input: { orderId, lines: [{ orderLineId: lineId, quantity: 1 }] },
            }));
        });
        expect(cancelOrder.errorCode).toBe('ORDER_STATE_TRANSITION_ERROR');
        expect(published).toEqual([]);

        const { order } = await adminClient.query(GET_ORDER, { id: orderId });
        expect(order.state).toBe('PaymentSettled');
        expect(order.lines.map((l: any) => l.quantity)).toEqual([1]);
        expect(await getStock()).toEqual(stockBefore);
        expect(historyCancellations(await getHistoryTypes(orderId))).toBe(1);
    });

    it('returns the validation error rather than the transition error for invalid lines', async () => {
        const { cancelOrder } = await adminClient.query(CANCEL_ORDER, {
            input: { orderId, lines: [{ orderLineId: lineId, quantity: 5 }] },
        });
        expect(cancelOrder.errorCode).toBe('QUANTITY_TOO_GREAT_ERROR');
    });

    it('leaves the Order lines untouched when onTransitionStart returns false', async () => {
        cancelGuard = 'refuseWithFalse';
        const stockBefore = await getStock();

        let cancelOrder: any;
        const published = await eventsPublishedBy(async () => {
            ({ cancelOrder } = await adminClient.query(CANCEL_ORDER, { input: { orderId } }));
        });
        expect(cancelOrder.errorCode).toBe('ORDER_STATE_TRANSITION_ERROR');
        expect(cancelOrder.transitionError).toBe(
            'Cannot transition Order from "PaymentSettled" to "Cancelled"',
        );
        expect(published).toEqual([]);

        const { order } = await adminClient.query(GET_ORDER, { id: orderId });
        expect(order.state).toBe('PaymentSettled');
        expect(order.lines.map((l: any) => l.quantity)).toEqual([1]);
        expect(await getStock()).toEqual(stockBefore);
        expect(historyCancellations(await getHistoryTypes(orderId))).toBe(1);
    });

    it('checks the transition against the Order totals after the cancellation', async () => {
        cancelGuard = 'requireZeroSubTotal';

        let cancelOrder: any;
        const published = await eventsPublishedBy(async () => {
            ({ cancelOrder } = await adminClient.query(CANCEL_ORDER, { input: { orderId } }));
        });
        expect(cancelOrder.state).toBe('Cancelled');
        expect(published).toEqual([
            'StockMovementEvent:RELEASE',
            'OrderLineEvent:cancelled',
            'HistoryEntryEvent:ORDER_CANCELLATION',
            'OrderStateTransitionEvent:PaymentSettled->Cancelled',
            'HistoryEntryEvent:ORDER_STATE_TRANSITION',
        ]);

        const { order } = await adminClient.query(GET_ORDER, { id: orderId });
        expect(order.lines.map((l: any) => l.quantity)).toEqual([0]);
        expect((await getStock()).stockAllocated).toBe(0);
    });

    it('runs the guards once, against the Order with the cancellation applied', async () => {
        cancelGuard = 'requireLinesCancelled';
        cancelGuardCalls = 0;
        const secondOrderId = await placeOrder(1);

        let cancelOrder: any;
        await eventsPublishedBy(async () => {
            ({ cancelOrder } = await adminClient.query(CANCEL_ORDER, { input: { orderId: secondOrderId } }));
        });
        expect(cancelOrder.state).toBe('Cancelled');
        expect(cancelGuardCalls).toBe(1);
        expect(await getHistoryTypes(secondOrderId)).toContain('ORDER_CANCELLATION');
    });

    it('checks the transition against the shipping cancellation', async () => {
        cancelGuard = 'requireZeroTotal';
        const thirdOrderId = await placeOrder(1);

        let refused: any;
        const publishedOnRefusal = await eventsPublishedBy(async () => {
            ({ cancelOrder: refused } = await adminClient.query(CANCEL_ORDER, {
                input: { orderId: thirdOrderId },
            }));
        });
        expect(refused.transitionError).toBe('The order still has a total');
        expect(publishedOnRefusal).toEqual([]);

        let cancelOrder: any;
        const published = await eventsPublishedBy(async () => {
            ({ cancelOrder } = await adminClient.query(CANCEL_ORDER, {
                input: { orderId: thirdOrderId, cancelShipping: true },
            }));
        });
        expect(cancelOrder.state).toBe('Cancelled');
        expect(published).toContain('OrderStateTransitionEvent:PaymentSettled->Cancelled');
        const { order } = await adminClient.query(GET_ORDER_TOTALS, { id: thirdOrderId });
        expect(order.shippingWithTax).toBe(0);
        expect(order.totalWithTax).toBe(0);
    });

    it('saves the changes onTransitionStart makes to the Order', async () => {
        cancelGuard = 'setCustomField';
        const fourthOrderId = await placeOrder(1);

        let cancelOrder: any;
        const published = await eventsPublishedBy(async () => {
            ({ cancelOrder } = await adminClient.query(CANCEL_ORDER, { input: { orderId: fourthOrderId } }));
        });
        expect(cancelOrder.state).toBe('Cancelled');
        expect(published).toContain('OrderStateTransitionEvent:PaymentSettled->Cancelled');
        const { order } = await adminClient.query(GET_ORDER_TOTALS, { id: fourthOrderId });
        expect(order.customFields.cancelledBy).toBe('guard');
    });

    it('returns the refusal as an error result for an active Order', async () => {
        cancelGuard = 'refuse';
        let addItemToOrder: any;
        // Let the events from creating the Order arrive before the cancel is observed.
        await eventsPublishedBy(async () => {
            ({ addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_1',
                quantity: 1,
            }));
        });

        let cancelOrder: any;
        const published = await eventsPublishedBy(async () => {
            ({ cancelOrder } = await adminClient.query(CANCEL_ORDER, {
                input: { orderId: addItemToOrder.id },
            }));
        });
        expect(cancelOrder.errorCode).toBe('ORDER_STATE_TRANSITION_ERROR');
        expect(published).toEqual([]);

        const { order } = await adminClient.query(GET_ORDER, { id: addItemToOrder.id });
        expect(order.state).toBe('AddingItems');
        expect(order.lines.map((l: any) => l.quantity)).toEqual([1]);
    });
});
