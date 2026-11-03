/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { mergeConfig } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { singleStageRefundablePaymentMethod, twoStagePaymentMethod } from './fixtures/test-payment-methods';
import { addItemToOrderDocument, addPaymentDocument } from './graphql/shop-definitions';
import { proceedToArrangingPayment } from './utils/test-order-utils';

/**
 * PaymentMethodService.getMethodAndOperations() only finds enabled methods, and settle, cancel and
 * refund all go through it. Disabling a method should stop new payments, not strand existing ones.
 */

const GET_PAYMENT_METHODS = gql`
    query GetPaymentMethods {
        paymentMethods {
            items {
                id
                code
            }
        }
    }
`;

const UPDATE_PAYMENT_METHOD = gql`
    mutation UpdatePaymentMethod($input: UpdatePaymentMethodInput!) {
        updatePaymentMethod(input: $input) {
            id
            enabled
        }
    }
`;

const GET_ORDER_PAYMENTS = gql`
    query GetOrderPayments($id: ID!) {
        order(id: $id) {
            id
            lines {
                id
            }
            payments {
                id
                state
            }
        }
    }
`;

const SETTLE_PAYMENT = gql`
    mutation SettlePayment($id: ID!) {
        settlePayment(id: $id) {
            ... on Payment {
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

const REFUND_ORDER = gql`
    mutation RefundOrder($input: RefundOrderInput!) {
        refundOrder(input: $input) {
            ... on Refund {
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

describe('Payments of a disabled PaymentMethod', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            paymentOptions: {
                paymentMethodHandlers: [twoStagePaymentMethod, singleStageRefundablePaymentMethod],
            },
        }),
    );

    beforeAll(async () => {
        await server.init({
            initialData: {
                ...initialData,
                paymentMethods: [
                    {
                        name: twoStagePaymentMethod.code,
                        handler: { code: twoStagePaymentMethod.code, arguments: [] },
                    },
                    {
                        name: singleStageRefundablePaymentMethod.code,
                        handler: { code: singleStageRefundablePaymentMethod.code, arguments: [] },
                    },
                ],
            },
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 2,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    async function placeOrder(methodCode: string) {
        await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
        await shopClient.query(addItemToOrderDocument, { productVariantId: 'T_1', quantity: 1 });
        const orderId = await proceedToArrangingPayment(shopClient);
        await shopClient.query(addPaymentDocument, { input: { method: methodCode, metadata: {} } });
        const { order } = await adminClient.query(GET_ORDER_PAYMENTS, { id: orderId });
        return order;
    }

    async function setEnabled(methodCode: string, enabled: boolean) {
        const { paymentMethods } = await adminClient.query(GET_PAYMENT_METHODS);
        const method = paymentMethods.items.find((m: any) => m.code === methodCode);
        await adminClient.query(UPDATE_PAYMENT_METHOD, { input: { id: method.id, enabled } });
    }

    it('settles an Authorized payment after its method is disabled', async () => {
        const order = await placeOrder(twoStagePaymentMethod.code);
        expect(order.payments[0].state).toBe('Authorized');

        await setEnabled(twoStagePaymentMethod.code, false);

        const { settlePayment } = await adminClient.query(SETTLE_PAYMENT, { id: order.payments[0].id });
        expect(settlePayment.state).toBe('Settled');
    });

    it('refunds a Settled payment after its method is disabled', async () => {
        const order = await placeOrder(singleStageRefundablePaymentMethod.code);
        expect(order.payments[0].state).toBe('Settled');

        await setEnabled(singleStageRefundablePaymentMethod.code, false);

        const { refundOrder } = await adminClient.query(REFUND_ORDER, {
            input: {
                paymentId: order.payments[0].id,
                lines: [{ orderLineId: order.lines[0].id, quantity: 1 }],
                shipping: 0,
                adjustment: 0,
                reason: 'disabled method',
            },
        });
        expect(refundOrder.state).toBe('Settled');
    });
});
