/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { ErrorCode, type RefundOrderInput } from '@vendure/common/lib/generated-types';
import {
    LanguageCode,
    mergeConfig,
    type Order,
    type Payment,
    type RefundDestinationStrategy,
    type RequestContext,
} from '@vendure/core';
import { createErrorResultGuard, createTestEnvironment, type ErrorResultGuard } from '@vendure/testing';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { partialPaymentMethod, singleStageRefundablePaymentMethod } from './fixtures/test-payment-methods';
import { graphql } from './graphql/graphql-admin';
import { addItemToOrderDocument, addPaymentDocument } from './graphql/shop-definitions';
import { proceedToArrangingPayment } from './utils/test-order-utils';

const PARTIAL_PAYMENT_AMOUNT = 1000;

const storeCreditSpy = vi.fn();

/**
 * Available for every Payment. Records the arguments it is called with so that the tests can
 * assert on the amount, the Payment it was drawn from, and the `arguments` passed through from
 * the RefundTargetInput.
 */
class StoreCreditDestination implements RefundDestinationStrategy {
    readonly code = 'store-credit';
    readonly description = [{ languageCode: LanguageCode.en, value: 'Refund as store credit' }];

    isAvailable() {
        return true;
    }

    createRefund(
        ctx: RequestContext,
        input: RefundOrderInput,
        amount: number,
        order: Order,
        payment: Payment,
        args?: any,
    ) {
        storeCreditSpy({ amount, paymentMethod: payment.method, args });
        return {
            state: 'Settled' as const,
            transactionId: `sc-${amount}`,
            metadata: { amount, args: args ?? null },
        };
    }
}

/**
 * Only available for payments taken via the refundable payment method, so that the tests can
 * verify that availability is resolved per-Payment rather than per-Order.
 */
class RestrictedDestination implements RefundDestinationStrategy {
    readonly code = 'restricted';
    readonly description = [{ languageCode: LanguageCode.en, value: 'Restricted destination' }];

    isAvailable(ctx: RequestContext, order: Order, payment: Payment) {
        return payment.method === singleStageRefundablePaymentMethod.code;
    }

    createRefund() {
        return { state: 'Settled' as const, transactionId: 'restricted-1' };
    }
}

const refundDestinationsDocument = graphql(`
    query GetRefundDestinations($orderId: ID!) {
        refundDestinations(orderId: $orderId) {
            code
            description
            availableForPaymentIds
        }
    }
`);

const refundWithDestinationDocument = graphql(`
    mutation RefundWithDestination($input: RefundOrderInput!) {
        refundOrder(input: $input) {
            ... on Refund {
                id
                state
                total
                method
                destination
                transactionId
                metadata
                lines {
                    orderLineId
                    quantity
                }
            }
            ... on ErrorResult {
                errorCode
                message
            }
            ... on RefundAmountError {
                maximumRefundable
            }
            ... on RefundDestinationError {
                destinationCode
            }
        }
    }
`);

const getOrderPaymentsDocument = graphql(`
    query GetOrderPayments($id: ID!) {
        order(id: $id) {
            id
            totalWithTax
            lines {
                id
            }
            payments {
                id
                method
                amount
                state
                refunds {
                    id
                    total
                    state
                    destination
                    method
                    lines {
                        orderLineId
                        quantity
                    }
                }
            }
        }
    }
`);

describe('Refund destinations', () => {
    let orderId: string;
    let orderLineId: string;
    let partialPaymentId: string;
    let refundablePaymentId: string;
    let orderTotalWithTax: number;

    const refundGuard: ErrorResultGuard<{ id: string; total: number }> = createErrorResultGuard(
        input => input.total != null,
    );

    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            paymentOptions: {
                paymentMethodHandlers: [partialPaymentMethod, singleStageRefundablePaymentMethod],
                refundDestinations: [new StoreCreditDestination(), new RestrictedDestination()],
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
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 2,
        });
        await adminClient.asSuperAdmin();
        await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');

        // Build an Order paid for by two separate Payments, so that per-payment availability and
        // per-payment refundable capacity can be exercised.
        await shopClient.query(addItemToOrderDocument, { productVariantId: 'T_1', quantity: 2 });
        await proceedToArrangingPayment(shopClient, 2);
        await shopClient.query(addPaymentDocument, {
            input: {
                method: partialPaymentMethod.code,
                metadata: { amount: PARTIAL_PAYMENT_AMOUNT },
            },
        });
        const { addPaymentToOrder: order } = await shopClient.query(addPaymentDocument, {
            input: { method: singleStageRefundablePaymentMethod.code, metadata: {} },
        });

        orderId = (order as any).id;
        orderTotalWithTax = (order as any).totalWithTax;

        const { order: adminOrder } = await adminClient.query(getOrderPaymentsDocument, { id: orderId });
        orderLineId = adminOrder!.lines[0].id;
        partialPaymentId = adminOrder!.payments!.find(p => p.method === partialPaymentMethod.code)!.id;
        refundablePaymentId = adminOrder!.payments!.find(
            p => p.method === singleStageRefundablePaymentMethod.code,
        )!.id;
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    describe('refundDestinations query', () => {
        it('always includes the default destination for every refundable payment', async () => {
            const { refundDestinations } = await adminClient.query(refundDestinationsDocument, { orderId });

            const defaultDestination = refundDestinations.find(d => d.code === 'default');
            expect(defaultDestination).toBeDefined();
            expect(defaultDestination!.availableForPaymentIds.sort()).toEqual(
                [partialPaymentId, refundablePaymentId].sort(),
            );
        });

        it('lists a destination against only the payments it is available for', async () => {
            const { refundDestinations } = await adminClient.query(refundDestinationsDocument, { orderId });

            const storeCredit = refundDestinations.find(d => d.code === 'store-credit');
            expect(storeCredit!.description).toBe('Refund as store credit');
            expect(storeCredit!.availableForPaymentIds.sort()).toEqual(
                [partialPaymentId, refundablePaymentId].sort(),
            );

            const restricted = refundDestinations.find(d => d.code === 'restricted');
            expect(restricted!.availableForPaymentIds).toEqual([refundablePaymentId]);
        });
    });

    describe('validation', () => {
        it('returns RefundDestinationError for an unknown destination code', async () => {
            const { refundOrder } = await adminClient.query(refundWithDestinationDocument, {
                input: {
                    paymentId: refundablePaymentId,
                    amount: 100,
                    reason: 'unknown destination',
                    destination: 'no-such-destination',
                },
            });

            refundGuard.assertErrorResult(refundOrder);
            expect(refundOrder.errorCode).toBe(ErrorCode.REFUND_DESTINATION_ERROR);
            expect((refundOrder as any).destinationCode).toBe('no-such-destination');
        });

        it('returns RefundDestinationError when the destination is not available for the chosen payment', async () => {
            const { refundOrder } = await adminClient.query(refundWithDestinationDocument, {
                input: {
                    paymentId: partialPaymentId,
                    amount: 100,
                    reason: 'unavailable destination',
                    destination: 'restricted',
                },
            });

            refundGuard.assertErrorResult(refundOrder);
            expect(refundOrder.errorCode).toBe(ErrorCode.REFUND_DESTINATION_ERROR);
            expect((refundOrder as any).destinationCode).toBe('restricted');
        });

        it('rejects targets which together exceed a single payment’s refundable amount, without creating any refund', async () => {
            storeCreditSpy.mockClear();

            const { refundOrder } = await adminClient.query(refundWithDestinationDocument, {
                input: {
                    paymentId: partialPaymentId,
                    reason: 'over-allocated',
                    targets: [
                        { paymentId: partialPaymentId, amount: PARTIAL_PAYMENT_AMOUNT - 100 },
                        {
                            paymentId: partialPaymentId,
                            amount: 200,
                            destination: 'store-credit',
                        },
                    ],
                },
            });

            refundGuard.assertErrorResult(refundOrder);
            expect(refundOrder.errorCode).toBe(ErrorCode.REFUND_AMOUNT_ERROR);
            expect((refundOrder as any).maximumRefundable).toBe(100);
            // All targets are validated before any funds move, so the destination must not have run.
            expect(storeCreditSpy).not.toHaveBeenCalled();

            const { order } = await adminClient.query(getOrderPaymentsDocument, { id: orderId });
            const refundCount = order!.payments!.reduce((sum, p) => sum + (p.refunds?.length ?? 0), 0);
            expect(refundCount).toBe(0);
        });
    });

    describe('refunding to a destination', () => {
        it('records the destination code on the Refund and calls the strategy', async () => {
            storeCreditSpy.mockClear();

            const { refundOrder } = await adminClient.query(refundWithDestinationDocument, {
                input: {
                    paymentId: refundablePaymentId,
                    amount: 500,
                    reason: 'store credit refund',
                    destination: 'store-credit',
                },
            });

            refundGuard.assertSuccess(refundOrder);
            expect(refundOrder.total).toBe(500);
            expect(refundOrder.state).toBe('Settled');
            expect(refundOrder.destination).toBe('store-credit');
            // `method` still records the Payment the funds were drawn from.
            expect(refundOrder.method).toBe(singleStageRefundablePaymentMethod.code);
            expect(refundOrder.transactionId).toBe('sc-500');
            expect(storeCreditSpy).toHaveBeenCalledTimes(1);
            expect(storeCreditSpy.mock.calls[0][0]).toEqual({
                amount: 500,
                paymentMethod: singleStageRefundablePaymentMethod.code,
                args: undefined,
            });
        });

        it('leaves destination null when refunding to the original payment method', async () => {
            const { refundOrder } = await adminClient.query(refundWithDestinationDocument, {
                input: {
                    paymentId: refundablePaymentId,
                    amount: 100,
                    reason: 'plain refund',
                },
            });

            refundGuard.assertSuccess(refundOrder);
            expect(refundOrder.destination).toBeNull();
            expect(refundOrder.method).toBe(singleStageRefundablePaymentMethod.code);
        });
    });

    describe('multi-target refunds', () => {
        it('creates one Refund per target, in a single mutation', async () => {
            storeCreditSpy.mockClear();

            const { refundOrder } = await adminClient.query(refundWithDestinationDocument, {
                input: {
                    paymentId: partialPaymentId,
                    reason: 'split refund',
                    lines: [{ orderLineId, quantity: 1 }],
                    targets: [
                        { paymentId: partialPaymentId, amount: 300 },
                        {
                            paymentId: refundablePaymentId,
                            amount: 700,
                            destination: 'store-credit',
                            arguments: { expiresInDays: 90 },
                        },
                    ],
                },
            });

            refundGuard.assertSuccess(refundOrder);
            // The primary (first) Refund is returned.
            expect(refundOrder.total).toBe(300);
            expect(refundOrder.destination).toBeNull();

            expect(storeCreditSpy).toHaveBeenCalledTimes(1);
            expect(storeCreditSpy.mock.calls[0][0]).toEqual({
                amount: 700,
                paymentMethod: singleStageRefundablePaymentMethod.code,
                args: { expiresInDays: 90 },
            });

            const { order } = await adminClient.query(getOrderPaymentsDocument, { id: orderId });
            const partialPayment = order!.payments!.find(p => p.id === partialPaymentId)!;
            const refundablePayment = order!.payments!.find(p => p.id === refundablePaymentId)!;

            const splitRefund = partialPayment.refunds!.find(r => r.total === 300)!;
            expect(splitRefund.destination).toBeNull();

            const storeCreditRefund = refundablePayment.refunds!.find(r => r.total === 700)!;
            expect(storeCreditRefund.destination).toBe('store-credit');
            expect(storeCreditRefund.state).toBe('Settled');
        });

        it('attaches the refund lines only to the first Refund', async () => {
            const { order } = await adminClient.query(getOrderPaymentsDocument, { id: orderId });
            const allRefunds = order!.payments!.flatMap(p => p.refunds ?? []);

            const refundsWithLines = allRefunds.filter(r => (r.lines?.length ?? 0) > 0);
            expect(refundsWithLines).toHaveLength(1);
            expect(refundsWithLines[0].total).toBe(300);
            expect(refundsWithLines[0].lines).toEqual([{ orderLineId, quantity: 1 }]);
        });
    });
});
