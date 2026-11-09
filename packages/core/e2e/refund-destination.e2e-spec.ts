/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { CurrencyCode, ErrorCode, type RefundOrderInput } from '@vendure/common/lib/generated-types';
import {
    LanguageCode,
    mergeConfig,
    type Order,
    type Payment,
    type RefundDestinationStrategy,
    type RequestContext,
} from '@vendure/core';
import {
    createErrorResultGuard,
    createTestEnvironment,
    E2E_DEFAULT_CHANNEL_TOKEN,
    type ErrorResultGuard,
} from '@vendure/testing';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import {
    partialPaymentMethod,
    singleStageRefundablePaymentMethod,
    testFailingPaymentMethod,
} from './fixtures/test-payment-methods';
import { graphql } from './graphql/graphql-admin';
import { createChannelDocument } from './graphql/shared-definitions';
import { addItemToOrderDocument, addPaymentDocument } from './graphql/shop-definitions';
import { assertThrowsWithMessage } from './utils/assert-throws-with-message';
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

const hydrationSpy = vi.fn();

/**
 * Reads relations of the Order and Payment in both `isAvailable()` and `createRefund()`, so that the
 * tests can verify both methods receive the same hydration in the query and in the mutation.
 */
class MultiPaymentOnlyDestination implements RefundDestinationStrategy {
    readonly code = 'multi-payment-only';
    readonly description = [{ languageCode: LanguageCode.en, value: 'Only for split payments' }];

    isAvailable(ctx: RequestContext, order: Order, payment: Payment) {
        const settledPayments = order.payments.filter(p => p.state === 'Settled');
        return 1 < settledPayments.length && Array.isArray(payment.refunds);
    }

    createRefund(
        ctx: RequestContext,
        input: RefundOrderInput,
        amount: number,
        order: Order,
        payment: Payment,
    ) {
        hydrationSpy({
            orderPaymentCount: order.payments?.length,
            paymentRefundsLoaded: Array.isArray(payment.refunds),
        });
        return { state: 'Settled' as const, transactionId: `multi-${amount}` };
    }
}

/**
 * Simulates a destination whose external service fails, so that the tests can verify what happens
 * when a later target of a multi-target refund fails after earlier targets have moved funds.
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
            ... on RefundIncompleteError {
                failedTargetIndex
                failureReason
                refunds {
                    id
                    total
                    destination
                }
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
    let declinedPaymentId: string;
    let orderTotalWithTax: number;

    const refundGuard: ErrorResultGuard<{ id: string; total: number }> = createErrorResultGuard(
        input => input.total != null,
    );

    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            paymentOptions: {
                paymentMethodHandlers: [
                    partialPaymentMethod,
                    singleStageRefundablePaymentMethod,
                    testFailingPaymentMethod,
                ],
                refundDestinations: [
                    new StoreCreditDestination(),
                    new RestrictedDestination(),
                    new ThrowingDestination(),
                    new MultiPaymentOnlyDestination(),
                ],
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
                        name: testFailingPaymentMethod.code,
                        handler: { code: testFailingPaymentMethod.code, arguments: [] },
                    },
                ],
            },
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 2,
        });
        await adminClient.asSuperAdmin();
        await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');

        // Build an Order paid for by two separate Payments, so that per-payment availability and
        // per-payment refundable capacity can be exercised. A declined first attempt is also left on
        // the Order, since a declined Payment must never be drawn on by a refund.
        await shopClient.query(addItemToOrderDocument, { productVariantId: 'T_1', quantity: 2 });
        await proceedToArrangingPayment(shopClient, 2);
        await shopClient.query(addPaymentDocument, {
            input: { method: testFailingPaymentMethod.code, metadata: {} },
        });
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
        declinedPaymentId = adminOrder!.payments!.find(p => p.method === testFailingPaymentMethod.code)!.id;
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
    describe('payments which have not been settled', () => {
        it('does not list a Declined payment for any destination', async () => {
            const { refundDestinations } = await adminClient.query(refundDestinationsDocument, { orderId });

            for (const destination of refundDestinations) {
                expect(destination.availableForPaymentIds).not.toContain(declinedPaymentId);
            }
        });

        it('rejects a refund target which draws on a Declined payment', async () => {
            storeCreditSpy.mockClear();

            await assertThrowsWithMessage(
                () =>
                    adminClient.query(refundWithDestinationDocument, {
                        input: {
                            paymentId: refundablePaymentId,
                            reason: 'declined target',
                            targets: [
                                { paymentId: declinedPaymentId, amount: 100, destination: 'store-credit' },
                            ],
                        },
                    }),
                'is in the "Declined" state',
            )();
            expect(storeCreditSpy).not.toHaveBeenCalled();
        });

        it('rejects a refund to a destination which draws on a Declined payment', async () => {
            storeCreditSpy.mockClear();

            await assertThrowsWithMessage(
                () =>
                    adminClient.query(refundWithDestinationDocument, {
                        input: {
                            paymentId: declinedPaymentId,
                            amount: 100,
                            reason: 'declined destination',
                            destination: 'store-credit',
                        },
                    }),
                'is in the "Declined" state',
            )();
            expect(storeCreditSpy).not.toHaveBeenCalled();
        });
    });

    describe('failure part-way through a multi-target refund', () => {
        async function countRefunds() {
            const { order } = await adminClient.query(getOrderPaymentsDocument, { id: orderId });
            return order!.payments!.reduce((sum, p) => sum + (p.refunds?.length ?? 0), 0);
        }

        it('keeps the Refunds for earlier targets and returns RefundIncompleteError', async () => {
            const refundCountBefore = await countRefunds();

            const { refundOrder } = await adminClient.query(refundWithDestinationDocument, {
                input: {
                    paymentId: partialPaymentId,
                    reason: 'fails on second target',
                    targets: [
                        { paymentId: partialPaymentId, amount: 100 },
                        { paymentId: refundablePaymentId, amount: 100, destination: 'throwing' },
                    ],
                },
            });

            refundGuard.assertErrorResult(refundOrder);
            expect(refundOrder.errorCode).toBe(ErrorCode.REFUND_INCOMPLETE_ERROR);
            const incomplete = refundOrder as any;
            expect(incomplete.failedTargetIndex).toBe(1);
            expect(incomplete.failureReason).toBe('Voucher service unavailable');
            expect(incomplete.refunds).toHaveLength(1);
            expect(incomplete.refunds[0].total).toBe(100);
            expect(incomplete.refunds[0].destination).toBeNull();

            // The first target's Refund was committed, since its funds have already been moved.
            expect(await countRefunds()).toBe(refundCountBefore + 1);
        });

        it('creates no Refund when the first target fails', async () => {
            const refundCountBefore = await countRefunds();

            await assertThrowsWithMessage(
                () =>
                    adminClient.query(refundWithDestinationDocument, {
                        input: {
                            paymentId: refundablePaymentId,
                            reason: 'fails on first target',
                            targets: [
                                { paymentId: refundablePaymentId, amount: 100, destination: 'throwing' },
                                { paymentId: partialPaymentId, amount: 100 },
                            ],
                        },
                    }),
                'Voucher service unavailable',
            )();

            expect(await countRefunds()).toBe(refundCountBefore);
        });
    });

    describe('channel scoping', () => {
        const SECOND_CHANNEL_TOKEN = 'refund-destination-second-channel';

        afterAll(() => {
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        });

        it('does not return refund destinations for an Order in another Channel', async () => {
            await adminClient.query(createChannelDocument, {
                input: {
                    code: 'refund-destination-second-channel',
                    token: SECOND_CHANNEL_TOKEN,
                    defaultLanguageCode: LanguageCode.en,
                    currencyCode: CurrencyCode.GBP,
                    pricesIncludeTax: true,
                    defaultShippingZoneId: 'T_1',
                    defaultTaxZoneId: 'T_1',
                },
            });
            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);

            await assertThrowsWithMessage(
                () => adminClient.query(refundDestinationsDocument, { orderId }),
                'No Order with the id',
            )();
        });
    });
    describe('Order hydration passed to strategies', () => {
        it('lists a destination whose isAvailable() reads order.payments', async () => {
            const { refundDestinations } = await adminClient.query(refundDestinationsDocument, { orderId });

            const multi = refundDestinations.find(d => d.code === 'multi-payment-only');
            expect(multi!.availableForPaymentIds.sort()).toEqual(
                [partialPaymentId, refundablePaymentId].sort(),
            );
        });

        it('passes the same hydration to isAvailable() and createRefund() when refunding with targets', async () => {
            hydrationSpy.mockClear();

            const { refundOrder } = await adminClient.query(refundWithDestinationDocument, {
                input: {
                    paymentId: refundablePaymentId,
                    reason: 'hydration via targets',
                    targets: [
                        { paymentId: refundablePaymentId, amount: 50, destination: 'multi-payment-only' },
                    ],
                },
            });

            refundGuard.assertSuccess(refundOrder);
            expect(refundOrder.destination).toBe('multi-payment-only');
            // The declined, partial and refundable Payments are all loaded on the Order.
            expect(hydrationSpy).toHaveBeenCalledWith({ orderPaymentCount: 3, paymentRefundsLoaded: true });
        });

        it('passes the same hydration when refunding with the legacy destination field', async () => {
            hydrationSpy.mockClear();

            const { refundOrder } = await adminClient.query(refundWithDestinationDocument, {
                input: {
                    paymentId: refundablePaymentId,
                    amount: 50,
                    reason: 'hydration via destination',
                    destination: 'multi-payment-only',
                },
            });

            refundGuard.assertSuccess(refundOrder);
            expect(refundOrder.destination).toBe('multi-payment-only');
            expect(hydrationSpy).toHaveBeenCalledWith({ orderPaymentCount: 3, paymentRefundsLoaded: true });
        });
    });
});
