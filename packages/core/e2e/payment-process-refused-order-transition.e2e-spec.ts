/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { CustomOrderProcess, defaultOrderProcess, mergeConfig } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { testSuccessfulPaymentMethod } from './fixtures/test-payment-methods';
import { getOrderDocument } from './graphql/shared-definitions';
import { addItemToOrderDocument, addPaymentDocument } from './graphql/shop-definitions';
import { proceedToArrangingPayment } from './utils/test-order-utils';

/**
 * The default PaymentProcess transitions the Order to PaymentSettled once its payments cover the
 * total, but discards the result. An OrderProcess that refuses that transition leaves a settled
 * Payment on an Order in ArrangingPayment, and addPaymentToOrder reports success.
 */
const refusePaymentSettledProcess: CustomOrderProcess<never> = {
    onTransitionStart(fromState, toState) {
        if (toState === 'PaymentSettled') {
            return 'No kitchen capacity for this order';
        }
    },
};

describe('PaymentProcess with a refused Order transition', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            orderOptions: {
                process: [defaultOrderProcess, refusePaymentSettledProcess] as any,
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

    // OSS-936 — a refused PaymentSettled transition must not be reported as success
    it('addPaymentToOrder reports the refused transition instead of returning the Order', async () => {
        await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
        await shopClient.query(addItemToOrderDocument, { productVariantId: 'T_1', quantity: 1 });
        const orderId = await proceedToArrangingPayment(shopClient);

        const { addPaymentToOrder } = await shopClient.query(addPaymentDocument, {
            input: { method: testSuccessfulPaymentMethod.code, metadata: {} },
        });

        const { order } = await adminClient.query(getOrderDocument, { id: orderId });
        // Shows the state the customer is left in: charged, but the Order was not placed.
        expect({
            orderState: order!.state,
            paymentStates: order!.payments!.map(p => p.state),
        }).toEqual({ orderState: 'ArrangingPayment', paymentStates: ['Settled'] });

        // Expected: the caller learns that the Order could not move on.
        expect(addPaymentToOrder.__typename).toBe('OrderStateTransitionError');
    });
});
