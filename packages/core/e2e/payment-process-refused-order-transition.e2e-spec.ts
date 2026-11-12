/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { CustomOrderProcess, defaultOrderProcess, mergeConfig } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { testSuccessfulPaymentMethod, twoStagePaymentMethod } from './fixtures/test-payment-methods';
import { ResultOf } from './graphql/graphql-admin';
import { getCustomerListDocument, getOrderDocument } from './graphql/shared-definitions';
import { addItemToOrderDocument, addPaymentDocument } from './graphql/shop-definitions';
import { proceedToArrangingPayment } from './utils/test-order-utils';

/**
 * The default PaymentProcess transitions the Order to PaymentSettled or PaymentAuthorized once its
 * payments cover the total. When an OrderProcess refuses that transition, addPaymentToOrder must
 * return the OrderStateTransitionError, and keep the Payment that was already taken.
 */
const refusePaymentStatesProcess: CustomOrderProcess<never> = {
    onTransitionStart(fromState, toState) {
        if (toState === 'PaymentSettled' || toState === 'PaymentAuthorized') {
            return 'No kitchen capacity for this order';
        }
    },
};

describe('PaymentProcess with a refused Order transition', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            orderOptions: {
                process: [defaultOrderProcess, refusePaymentStatesProcess] as any,
            },
            paymentOptions: {
                paymentMethodHandlers: [testSuccessfulPaymentMethod, twoStagePaymentMethod],
            },
        }),
    );

    let customers: ResultOf<typeof getCustomerListDocument>['customers']['items'];

    beforeAll(async () => {
        await server.init({
            initialData: {
                ...initialData,
                paymentMethods: [testSuccessfulPaymentMethod, twoStagePaymentMethod].map(handler => ({
                    name: handler.code,
                    handler: { code: handler.code, arguments: [] },
                })),
            },
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 2,
        });
        await adminClient.asSuperAdmin();
        ({
            customers: { items: customers },
        } = await adminClient.query(getCustomerListDocument));
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    async function addPaymentAsCustomer(customerIndex: number, method: string) {
        await shopClient.asUserWithCredentials(customers[customerIndex].emailAddress, 'test');
        await shopClient.query(addItemToOrderDocument, { productVariantId: 'T_1', quantity: 1 });
        const orderId = await proceedToArrangingPayment(shopClient);
        const { addPaymentToOrder } = await shopClient.query(addPaymentDocument, {
            input: { method, metadata: {} },
        });
        const { order } = await adminClient.query(getOrderDocument, { id: orderId });
        return { addPaymentToOrder, order: order! };
    }

    // OSS-936 — a refused PaymentSettled transition must not be reported as success
    it('returns OrderStateTransitionError when the PaymentSettled transition is refused', async () => {
        const { addPaymentToOrder, order } = await addPaymentAsCustomer(0, testSuccessfulPaymentMethod.code);

        // The Payment is kept, and the Order was not placed.
        expect(order.state).toBe('ArrangingPayment');
        expect(order.payments!.map(p => p.state)).toEqual(['Settled']);

        expect(addPaymentToOrder.__typename).toBe('OrderStateTransitionError');
        expect((addPaymentToOrder as { transitionError: string }).transitionError).toBe(
            'No kitchen capacity for this order',
        );
    });

    // OSS-936 — a refused PaymentAuthorized transition must not be reported as success
    it('returns OrderStateTransitionError when the PaymentAuthorized transition is refused', async () => {
        const { addPaymentToOrder, order } = await addPaymentAsCustomer(1, twoStagePaymentMethod.code);

        expect(order.state).toBe('ArrangingPayment');
        expect(order.payments!.map(p => p.state)).toEqual(['Authorized']);

        expect(addPaymentToOrder.__typename).toBe('OrderStateTransitionError');
        expect((addPaymentToOrder as { transitionError: string }).transitionError).toBe(
            'No kitchen capacity for this order',
        );
    });
});
