/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { CustomOrderProcess, defaultOrderProcess, mergeConfig } from '@vendure/core';
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
 * OrderService.cancelOrder() cancels the lines (and writes stock movements) before it attempts the
 * Cancelled transition. When an OrderProcess refuses that transition, the error is returned but the
 * line cancellations are already saved, so the Order keeps its state with every line cancelled.
 */
const refuseCancelProcess: CustomOrderProcess<never> = {
    onTransitionStart(fromState, toState) {
        if (toState === 'Cancelled') {
            return 'This order has been released to the kitchen';
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
        }
    }
`;

const GET_ORDER = gql`
    query GetOrder($id: ID!) {
        order(id: $id) {
            id
            state
            lines {
                id
                quantity
            }
        }
    }
`;

describe('cancelOrder refused by an OrderProcess', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            orderOptions: {
                process: [defaultOrderProcess, refuseCancelProcess] as any,
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
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('leaves the Order lines untouched when the Cancelled transition is refused', async () => {
        await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
        await shopClient.query(addItemToOrderDocument, { productVariantId: 'T_1', quantity: 2 });
        const orderId = await proceedToArrangingPayment(shopClient);
        await shopClient.query(addPaymentDocument, {
            input: { method: testSuccessfulPaymentMethod.code, metadata: {} },
        });

        const { cancelOrder } = await adminClient.query(CANCEL_ORDER, { input: { orderId } });
        expect(cancelOrder.errorCode).toBe('ORDER_STATE_TRANSITION_ERROR');

        const { order } = await adminClient.query(GET_ORDER, { id: orderId });
        expect(order.state).toBe('PaymentSettled');
        // Expected: a refused cancel changes nothing.
        expect(order.lines.map((l: any) => l.quantity)).toEqual([2]);
    });
});
