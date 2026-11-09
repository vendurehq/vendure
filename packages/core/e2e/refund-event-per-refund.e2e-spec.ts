/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
    EventBus,
    LanguageCode,
    mergeConfig,
    PaymentMethodHandler,
    type RefundDestinationStrategy,
    RefundEvent,
} from '@vendure/core';
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
 * OSS-939: a RefundEvent is published once for every Refund created, whether by refundOrder() or by
 * modifyOrder(), including the Refunds created before a later target of a multi-target refund fails.
 */

class ThrowingDestination implements RefundDestinationStrategy {
    readonly code = 'throwing';
    readonly description = [{ languageCode: LanguageCode.en, value: 'Always fails' }];

    isAvailable() {
        return true;
    }

    createRefund(): never {
        throw new Error('Voucher service unavailable');
    }
}

const refundThrowsPaymentMethod = new PaymentMethodHandler({
    code: 'refund-throws-payment-method',
    description: [{ languageCode: LanguageCode.en, value: 'Refund always throws' }],
    args: {},
    createPayment: (ctx, order, amount, args, metadata) => ({
        amount,
        state: 'Settled',
        transactionId: 'refund-throws',
        metadata,
    }),
    settlePayment: () => ({ success: true }),
    createRefund: () => {
        throw new Error('Payment provider unavailable');
    },
});

const FAILING_HANDLER_REASON = 'blocking handler fails';

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
            ... on RefundIncompleteError {
                failedTargetIndex
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
    // Blocking handlers run when the event is published, before the transaction commits, so they
    // also see events for Refunds which are later rolled back.
    const blockingRefundEvents: RefundEvent[] = [];

    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            paymentOptions: {
                paymentMethodHandlers: [
                    partialPaymentMethod,
                    singleStageRefundablePaymentMethod,
                    refundThrowsPaymentMethod,
                ],
                refundDestinations: [new ThrowingDestination()],
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
                    {
                        name: refundThrowsPaymentMethod.code,
                        handler: { code: refundThrowsPaymentMethod.code, arguments: [] },
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
        server.app.get(EventBus).registerBlockingEventHandler({
            event: RefundEvent,
            id: 'refund-event-per-refund-spec',
            handler: event => {
                blockingRefundEvents.push(event);
                if (event.refund.reason === FAILING_HANDLER_REASON) {
                    throw new Error('Blocking RefundEvent handler failed');
                }
            },
        });
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    beforeEach(() => {
        refundEvents.length = 0;
        blockingRefundEvents.length = 0;
    });

    async function waitForEvents() {
        // EventBus.ofType() subscribers are notified asynchronously, once the transaction has committed.
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    async function placeOrderWithTwoPayments(secondMethod = singleStageRefundablePaymentMethod.code) {
        await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
        await shopClient.query(addItemToOrderDocument, { productVariantId: 'T_1', quantity: 2 });
        const orderId = await proceedToArrangingPayment(shopClient);
        await shopClient.query(addPaymentDocument, {
            input: { method: partialPaymentMethod.code, metadata: { amount: 500 } },
        });
        await shopClient.query(addPaymentDocument, {
            input: { method: secondMethod, metadata: {} },
        });
        const { order } = await adminClient.query(GET_ORDER, { id: orderId });
        const partialPayment = order.payments.find((p: any) => p.method === partialPaymentMethod.code);
        const refundablePayment = order.payments.find((p: any) => p.method === secondMethod);
        return { orderId, order, partialPayment, refundablePayment };
    }

    // OSS-939
    it('fires once per Refund created by a multi-target refundOrder', async () => {
        const { orderId, partialPayment, refundablePayment } = await placeOrderWithTwoPayments();

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

        expect(refundEvents.map(e => e.refund.total).sort((a, b) => a - b)).toEqual([300, 700]);
    });

    // OSS-939
    it('fires for the Refunds created before a later target fails', async () => {
        const { partialPayment, refundablePayment } = await placeOrderWithTwoPayments();

        const { refundOrder } = await adminClient.query(REFUND_ORDER, {
            input: {
                paymentId: partialPayment.id,
                reason: 'fails on second target',
                targets: [
                    { paymentId: partialPayment.id, amount: 100 },
                    { paymentId: refundablePayment.id, amount: 100, destination: 'throwing' },
                ],
            },
        });
        expect(refundOrder.errorCode).toBe('REFUND_INCOMPLETE_ERROR');
        expect(refundOrder.failedTargetIndex).toBe(1);
        await waitForEvents();

        expect(refundEvents.map(e => e.refund.total)).toEqual([100]);
    });

    // OSS-939
    it('keeps the Refunds of an incomplete refund when a blocking RefundEvent handler fails', async () => {
        const { orderId, partialPayment, refundablePayment } = await placeOrderWithTwoPayments();

        const { refundOrder } = await adminClient.query(REFUND_ORDER, {
            input: {
                paymentId: partialPayment.id,
                reason: FAILING_HANDLER_REASON,
                targets: [
                    { paymentId: partialPayment.id, amount: 100 },
                    { paymentId: refundablePayment.id, amount: 100, destination: 'throwing' },
                ],
            },
        });
        expect(refundOrder.errorCode).toBe('REFUND_INCOMPLETE_ERROR');
        expect(blockingRefundEvents.length).toBe(1);

        const { order: refunded } = await adminClient.query(GET_ORDER, { id: orderId });
        const createdRefunds = refunded.payments.flatMap((p: any) => p.refunds);
        expect(createdRefunds.map((r: any) => r.total)).toEqual([100]);
    });

    // OSS-939
    it('publishes nothing for Refunds rolled back when a spilled-over refund throws', async () => {
        const { orderId, order, partialPayment } = await placeOrderWithTwoPayments(
            refundThrowsPaymentMethod.code,
        );

        // Refunding the whole line exceeds the partial Payment, so the refund spills over onto the
        // second Payment, whose handler throws. That rolls back the first Refund too.
        const { errors } = await adminClient
            .query(REFUND_ORDER, {
                input: {
                    paymentId: partialPayment.id,
                    reason: 'spill-over fails',
                    lines: [{ orderLineId: order.lines[0].id, quantity: 2 }],
                    shipping: 0,
                    adjustment: 0,
                },
            })
            .then(
                () => ({ errors: undefined }),
                (e: any) => ({ errors: e }),
            );
        expect(String(errors?.message)).toContain('Payment provider unavailable');
        await waitForEvents();

        const { order: afterRefund } = await adminClient.query(GET_ORDER, { id: orderId });
        expect(afterRefund.payments.flatMap((p: any) => p.refunds)).toEqual([]);
        expect(blockingRefundEvents.length).toBe(0);
        expect(refundEvents.length).toBe(0);
    });

    // OSS-939
    it('does not fire when the first target fails and nothing is refunded', async () => {
        const { partialPayment, refundablePayment } = await placeOrderWithTwoPayments();

        const { errors } = await adminClient
            .query(REFUND_ORDER, {
                input: {
                    paymentId: refundablePayment.id,
                    reason: 'fails on first target',
                    targets: [
                        { paymentId: refundablePayment.id, amount: 100, destination: 'throwing' },
                        { paymentId: partialPayment.id, amount: 100 },
                    ],
                },
            })
            .then(
                () => ({ errors: undefined }),
                (e: any) => ({ errors: e }),
            );
        expect(String(errors?.message)).toContain('Voucher service unavailable');
        await waitForEvents();

        expect(blockingRefundEvents.length).toBe(0);
        expect(refundEvents.length).toBe(0);
    });

    // OSS-939
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
        expect(modifyOrder.errorCode).toBeUndefined();
        expect(modifyOrder.payments[0].refunds.length).toBe(1);
        await waitForEvents();

        expect(refundEvents.map(e => e.refund.total)).toEqual([modifyOrder.payments[0].refunds[0].total]);
    });
});
