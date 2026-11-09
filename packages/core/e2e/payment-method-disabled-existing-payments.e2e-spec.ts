/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { LanguageCode, mergeConfig } from '@vendure/core';
import { createErrorResultGuard, createTestEnvironment, type ErrorResultGuard } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import {
    failsToSettlePaymentMethod,
    singleStageRefundablePaymentMethod,
    twoStagePaymentMethod,
} from './fixtures/test-payment-methods';
import { paymentFragment, refundFragment } from './graphql/fragments-admin';
import { type FragmentOf, graphql } from './graphql/graphql-admin';
import {
    cancelPaymentDocument,
    getOrderDocument,
    refundOrderDocument,
    settlePaymentDocument,
} from './graphql/shared-definitions';
import {
    addItemToOrderDocument,
    addPaymentDocument,
    transitionToStateDocument,
} from './graphql/shop-definitions';
import { proceedToArrangingPayment } from './utils/test-order-utils';

/**
 * Disabling a PaymentMethod stops new payments with it, but its existing payments can still be
 * settled, cancelled and refunded.
 */

const getPaymentMethodsDocument = graphql(`
    query GetPaymentMethodCodes {
        paymentMethods {
            items {
                id
                code
            }
        }
    }
`);

const updatePaymentMethodDocument = graphql(`
    mutation SetPaymentMethodEnabled($input: UpdatePaymentMethodInput!) {
        updatePaymentMethod(input: $input) {
            id
            enabled
        }
    }
`);

const createPaymentMethodDocument = graphql(`
    mutation CreateSharedCodePaymentMethod($input: CreatePaymentMethodInput!) {
        createPaymentMethod(input: $input) {
            id
        }
    }
`);

describe('Payments of a disabled PaymentMethod', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            paymentOptions: {
                paymentMethodHandlers: [
                    twoStagePaymentMethod,
                    singleStageRefundablePaymentMethod,
                    failsToSettlePaymentMethod,
                ],
            },
        }),
    );

    const paymentGuard: ErrorResultGuard<FragmentOf<typeof paymentFragment>> = createErrorResultGuard(
        input => !!input.state,
    );
    const refundGuard: ErrorResultGuard<FragmentOf<typeof refundFragment>> = createErrorResultGuard(
        input => !!input.state,
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
        const { order } = await adminClient.query(getOrderDocument, { id: orderId as string });
        return order!;
    }

    async function setEnabled(methodCode: string, enabled: boolean) {
        const { paymentMethods } = await adminClient.query(getPaymentMethodsDocument);
        const method = paymentMethods.items.find(m => m.code === methodCode)!;
        await adminClient.query(updatePaymentMethodDocument, { input: { id: method.id, enabled } });
    }

    // OSS-937 — disabling a method must not block settling, cancelling or refunding its existing payments
    it('settles an Authorized payment after its method is disabled', async () => {
        await setEnabled(twoStagePaymentMethod.code, true);
        const order = await placeOrder(twoStagePaymentMethod.code);
        expect(order.payments![0].state).toBe('Authorized');

        await setEnabled(twoStagePaymentMethod.code, false);

        const { settlePayment } = await adminClient.query(settlePaymentDocument, {
            id: order.payments![0].id,
        });
        paymentGuard.assertSuccess(settlePayment);
        expect(settlePayment.state).toBe('Settled');
    });

    it('cancels an Authorized payment after its method is disabled', async () => {
        await setEnabled(twoStagePaymentMethod.code, true);
        const order = await placeOrder(twoStagePaymentMethod.code);
        expect(order.payments![0].state).toBe('Authorized');

        await setEnabled(twoStagePaymentMethod.code, false);

        const { cancelPayment } = await adminClient.query(cancelPaymentDocument, {
            paymentId: order.payments![0].id,
        });
        paymentGuard.assertSuccess(cancelPayment);
        expect(cancelPayment.state).toBe('Cancelled');
    });

    it('refunds a Settled payment after its method is disabled', async () => {
        await setEnabled(singleStageRefundablePaymentMethod.code, true);
        const order = await placeOrder(singleStageRefundablePaymentMethod.code);
        expect(order.payments![0].state).toBe('Settled');

        await setEnabled(singleStageRefundablePaymentMethod.code, false);

        const { refundOrder } = await adminClient.query(refundOrderDocument, {
            input: {
                paymentId: order.payments![0].id,
                lines: [{ orderLineId: order.lines[0].id, quantity: 1 }],
                shipping: 0,
                adjustment: 0,
                reason: 'disabled method',
            },
        });
        refundGuard.assertSuccess(refundOrder);
        expect(refundOrder.state).toBe('Settled');
    });

    // #3382 — a disabled method must still reject new payments
    it('does not accept a new payment with a disabled method', async () => {
        await setEnabled(twoStagePaymentMethod.code, false);
        await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
        await shopClient.query(addItemToOrderDocument, { productVariantId: 'T_1', quantity: 1 });
        await proceedToArrangingPayment(shopClient);

        await expect(
            shopClient.query(addPaymentDocument, {
                input: { method: twoStagePaymentMethod.code, metadata: {} },
            }),
        ).rejects.toThrow('error.payment-method-not-found');

        // Leave the active order editable for the next test
        await shopClient.query(transitionToStateDocument, { state: 'AddingItems' });
    });

    it('uses the enabled method when a disabled one shares its code', async () => {
        const code = 'shared-code';
        // The disabled method is created first, so it has the lower id. Its handler fails to settle.
        for (const [handlerCode, enabled] of [
            [failsToSettlePaymentMethod.code, false],
            [twoStagePaymentMethod.code, true],
        ] as const) {
            await adminClient.query(createPaymentMethodDocument, {
                input: {
                    code,
                    enabled,
                    handler: { code: handlerCode, arguments: [] },
                    translations: [{ languageCode: LanguageCode.en, name: handlerCode }],
                },
            });
        }
        const order = await placeOrder(code);
        expect(order.payments![0].state).toBe('Authorized');

        const { settlePayment } = await adminClient.query(settlePaymentDocument, {
            id: order.payments![0].id,
        });
        paymentGuard.assertSuccess(settlePayment);
        expect(settlePayment.state).toBe('Settled');
    });
});
