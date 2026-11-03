/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { EventBus, mergeConfig, RefundEvent } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { partialPaymentMethod, singleStageRefundablePaymentMethod } from './fixtures/test-payment-methods';
import { addItemToOrderDocument, addPaymentDocument } from './graphql/shop-definitions';
import { proceedToArrangingPayment } from './utils/test-order-utils';

/**
 * OrderService.refundOrder() publishes a RefundEvent only for the first Refund returned by
 * PaymentService.createRefund(), although a multi-target refund creates several. Refunds created by
 * modifyOrder() go through PaymentService.createRefund() directly and publish no RefundEvent.
 */

const GET_ORDER = gql`
    query GetOrder($id: ID!) {
        order(id: $id) {
            id
            lines {
                id
                quantity
            }
            payments {
                id
                method
                refunds {
                    id
                    total
                }
            }
        }
    }
`;

const REFUND_ORDER = gql`
    mutation RefundOrder($input: RefundOrderInput!) {
        refundOrder(input: $input) {
            ... on Refund {
                id
                total
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

const TRANSITION_ORDER = gql`
    mutation Transition($id: ID!, $state: String!) {
        transitionOrderToState(id: $id, state: $state) {
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

const MODIFY_ORDER = gql`
    mutation ModifyOrder($input: ModifyOrderInput!) {
        modifyOrder(input: $input) {
            ... on Order {
                id
                payments {
                    refunds {
                        id
                        total
                    }
                }
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

describe('RefundEvent', () => {
    const refundEvents: RefundEvent[] = [];

    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            paymentOptions: {
                paymentMethodHandlers: [partialPaymentMethod, singleStageRefundablePaymentMethod],
            },
        }),
    );

    beforeAll(async () => {
        await server.init({
            initialData: {
                ...initialData,
                paymentMethods: [
                    {
                        name: partialPaymentMethod.code,
                        handler: { code: partialPaymentMethod.code, arguments: [] },
                    },
                    {
                        name: singleStageRefundablePaymentMethod.code,
                        handler: { code: singleStageRefundablePaymentMethod.code, arguments: [] },
                    },
                ],
            },
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
        server.app
            .get(EventBus)
            .ofType(RefundEvent)
            .subscribe(event => refundEvents.push(event));
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    beforeEach(() => {
        refundEvents.length = 0;
    });

    async function waitForEvents() {
        // EventBus subscribers are notified after the transaction commits.
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    it('fires once per Refund created by a multi-target refundOrder', async () => {
        await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
        await shopClient.query(addItemToOrderDocument, { productVariantId: 'T_1', quantity: 2 });
        const orderId = await proceedToArrangingPayment(shopClient);
        await shopClient.query(addPaymentDocument, {
            input: { method: partialPaymentMethod.code, metadata: { amount: 500 } },
        });
        await shopClient.query(addPaymentDocument, {
            input: { method: singleStageRefundablePaymentMethod.code, metadata: {} },
        });
        const { order } = await adminClient.query(GET_ORDER, { id: orderId });
        const partialPayment = order.payments.find((p: any) => p.method === partialPaymentMethod.code);
        const refundablePayment = order.payments.find(
            (p: any) => p.method === singleStageRefundablePaymentMethod.code,
        );

        const { refundOrder } = await adminClient.query(REFUND_ORDER, {
            input: {
                paymentId: partialPayment.id,
                reason: 'split refund',
                targets: [
                    { paymentId: partialPayment.id, amount: 300 },
                    { paymentId: refundablePayment.id, amount: 700 },
                ],
            },
        });
        expect(refundOrder.total).toBe(300);
        await waitForEvents();

        const { order: refunded } = await adminClient.query(GET_ORDER, { id: orderId });
        const createdRefunds = refunded.payments.flatMap((p: any) => p.refunds);
        expect(createdRefunds.length).toBe(2);

        expect(refundEvents.map(e => e.refund.total).sort()).toEqual([300, 700]);
    });

    it('fires for a Refund created by modifyOrder', async () => {
        await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
        await shopClient.query(addItemToOrderDocument, { productVariantId: 'T_1', quantity: 2 });
        const orderId = await proceedToArrangingPayment(shopClient);
        await shopClient.query(addPaymentDocument, {
            input: { method: singleStageRefundablePaymentMethod.code, metadata: {} },
        });
        const { order } = await adminClient.query(GET_ORDER, { id: orderId });
        await adminClient.query(TRANSITION_ORDER, { id: orderId, state: 'Modifying' });

        const { modifyOrder } = await adminClient.query(MODIFY_ORDER, {
            input: {
                dryRun: false,
                orderId,
                adjustOrderLines: [{ orderLineId: order.lines[0].id, quantity: 1 }],
                refund: { paymentId: order.payments[0].id },
            },
        });
        expect(modifyOrder.payments[0].refunds.length).toBe(1);
        await waitForEvents();

        expect(refundEvents.length).toBe(1);
    });
});
