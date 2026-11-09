import {
    CustomOrderProcess,
    defaultOrderProcess,
    mergeConfig,
    OrderLine,
    TransactionalConnection,
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
 * lines, not the stock, not the state.
 */
let cancelGuard: 'refuse' | 'refuseWithFalse' | 'requireZeroSubTotal' | 'requireLinesCancelledInDb' =
    'refuse';
let cancelGuardCalls = 0;
let connection: TransactionalConnection;

const guardCancelProcess: CustomOrderProcess<never> = {
    init(injector) {
        connection = injector.get(TransactionalConnection);
    },
    async onTransitionStart(fromState, toState, { ctx, order }) {
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
            case 'requireLinesCancelledInDb': {
                const lines = await connection
                    .getRepository(ctx, OrderLine)
                    .find({ where: { order: { id: order.id } } });
                return lines.every(l => l.quantity === 0) ? undefined : 'The lines are not cancelled';
            }
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
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    let orderId: string;
    let lineId: string;

    async function getHistoryTypes(id: string): Promise<string[]> {
        const { order } = await adminClient.query(GET_ORDER_HISTORY_TYPES, { id });
        return order.history.items.map((i: any) => i.type);
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

        const { cancelOrder } = await adminClient.query(CANCEL_ORDER, { input: { orderId } });
        expect(cancelOrder.errorCode).toBe('ORDER_STATE_TRANSITION_ERROR');
        expect(cancelOrder.transitionError).toBe('This order has been released to the kitchen');

        const { order } = await adminClient.query(GET_ORDER, { id: orderId });
        expect(order.state).toBe('PaymentSettled');
        // Expected: a refused cancel changes nothing.
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

        const { cancelOrder } = await adminClient.query(CANCEL_ORDER, {
            input: { orderId, lines: [{ orderLineId: lineId, quantity: 1 }] },
        });
        expect(cancelOrder.errorCode).toBe('ORDER_STATE_TRANSITION_ERROR');

        const { order } = await adminClient.query(GET_ORDER, { id: orderId });
        expect(order.state).toBe('PaymentSettled');
        expect(order.lines.map((l: any) => l.quantity)).toEqual([1]);
        expect(await getStock()).toEqual(stockBefore);
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

        const { cancelOrder } = await adminClient.query(CANCEL_ORDER, { input: { orderId } });
        expect(cancelOrder.errorCode).toBe('ORDER_STATE_TRANSITION_ERROR');

        const { order } = await adminClient.query(GET_ORDER, { id: orderId });
        expect(order.state).toBe('PaymentSettled');
        expect(order.lines.map((l: any) => l.quantity)).toEqual([1]);
        expect(await getStock()).toEqual(stockBefore);
    });

    it('checks the transition against the Order totals after the cancellation', async () => {
        cancelGuard = 'requireZeroSubTotal';

        const { cancelOrder } = await adminClient.query(CANCEL_ORDER, { input: { orderId } });
        expect(cancelOrder.state).toBe('Cancelled');

        const { order } = await adminClient.query(GET_ORDER, { id: orderId });
        expect(order.lines.map((l: any) => l.quantity)).toEqual([0]);
        expect((await getStock()).stockAllocated).toBe(0);
    });

    it('runs the guards once, against the cancelled lines as saved in the database', async () => {
        cancelGuard = 'requireLinesCancelledInDb';
        cancelGuardCalls = 0;
        const secondOrderId = await placeOrder(1);

        const { cancelOrder } = await adminClient.query(CANCEL_ORDER, { input: { orderId: secondOrderId } });
        expect(cancelOrder.state).toBe('Cancelled');
        expect(cancelGuardCalls).toBe(1);
        expect(await getHistoryTypes(secondOrderId)).toContain('ORDER_CANCELLATION');
    });

    it('returns the refusal as an error result for an active Order', async () => {
        cancelGuard = 'refuse';
        const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
            productVariantId: 'T_1',
            quantity: 1,
        });

        const { cancelOrder } = await adminClient.query(CANCEL_ORDER, {
            input: { orderId: addItemToOrder.id },
        });
        expect(cancelOrder.errorCode).toBe('ORDER_STATE_TRANSITION_ERROR');

        const { order } = await adminClient.query(GET_ORDER, { id: addItemToOrder.id });
        expect(order.state).toBe('AddingItems');
        expect(order.lines.map((l: any) => l.quantity)).toEqual([1]);
    });
});
