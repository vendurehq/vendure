/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { CurrencyCode } from '@vendure/common/lib/generated-types';
import {
    LanguageCode,
    mergeConfig,
    Payment,
    PaymentMethodService,
    RequestContextService,
} from '@vendure/core';
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
    createChannelDocument,
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

const deletePaymentMethodDocument = graphql(`
    mutation DeleteDisabledTestPaymentMethod($id: ID!, $force: Boolean) {
        deletePaymentMethod(id: $id, force: $force) {
            result
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

    async function createMethod(code: string, handlerCode: string, enabled: boolean) {
        const { createPaymentMethod } = await adminClient.query(createPaymentMethodDocument, {
            input: {
                code,
                enabled,
                handler: { code: handlerCode, arguments: [] },
                translations: [{ languageCode: LanguageCode.en, name: handlerCode }],
            },
        });
        return createPaymentMethod;
    }

    async function getPaymentState(orderId: string) {
        const { order } = await adminClient.query(getOrderDocument, { id: orderId });
        return order!.payments![0].state;
    }

    // Disabling a method must not block settling, cancelling or refunding its existing payments
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
                amount: order.payments![0].amount,
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
        await createMethod(code, failsToSettlePaymentMethod.code, false);
        await createMethod(code, twoStagePaymentMethod.code, true);
        const order = await placeOrder(code);
        expect(order.payments![0].state).toBe('Authorized');

        const { settlePayment } = await adminClient.query(settlePaymentDocument, {
            id: order.payments![0].id,
        });
        paymentGuard.assertSuccess(settlePayment);
        expect(settlePayment.state).toBe('Settled');
    });

    // A Payment stores only the method code, so with several disabled methods on that code the
    // lookup must not guess which handler took the payment
    it('does not settle when several disabled methods share the code', async () => {
        const code = 'ambiguous-code';
        // Created first, so it has the lower id. Its handler fails to settle.
        await createMethod(code, failsToSettlePaymentMethod.code, false);
        const { id } = await createMethod(code, twoStagePaymentMethod.code, true);
        const order = await placeOrder(code);
        expect(order.payments![0].state).toBe('Authorized');

        await adminClient.query(updatePaymentMethodDocument, { input: { id, enabled: false } });

        await expect(adminClient.query(settlePaymentDocument, { id: order.payments![0].id })).rejects.toThrow(
            'error.payment-method-not-found',
        );
        expect(await getPaymentState(order.id)).toBe('Authorized');
    });

    it('does not settle a payment whose method was deleted', async () => {
        const code = 'deleted-method';
        const { id } = await createMethod(code, twoStagePaymentMethod.code, true);
        const order = await placeOrder(code);
        expect(order.payments![0].state).toBe('Authorized');

        await adminClient.query(deletePaymentMethodDocument, { id, force: true });

        await expect(adminClient.query(settlePaymentDocument, { id: order.payments![0].id })).rejects.toThrow(
            'error.payment-method-not-found',
        );
        expect(await getPaymentState(order.id)).toBe('Authorized');
    });

    it('does not resolve a disabled method of another channel', async () => {
        const secondChannelToken = 'second-channel-token';
        await adminClient.query(createChannelDocument, {
            input: {
                code: 'second-channel',
                token: secondChannelToken,
                defaultLanguageCode: LanguageCode.en,
                currencyCode: CurrencyCode.USD,
                pricesIncludeTax: true,
                defaultShippingZoneId: 'T_1',
                defaultTaxZoneId: 'T_1',
            },
        });
        // Assigned to the default channel only
        await setEnabled(twoStagePaymentMethod.code, false);

        const requestContextService = server.app.get(RequestContextService);
        const paymentMethodService = server.app.get(PaymentMethodService);
        const defaultCtx = await requestContextService.create({ apiType: 'admin' });
        const secondCtx = await requestContextService.create({
            apiType: 'admin',
            channelOrToken: secondChannelToken,
        });

        const payment = new Payment({ method: twoStagePaymentMethod.code });

        const { paymentMethod } = await paymentMethodService.getMethodAndOperationsForPayment(
            defaultCtx,
            payment,
        );
        expect(paymentMethod.enabled).toBe(false);
        await expect(
            paymentMethodService.getMethodAndOperationsForPayment(secondCtx, payment),
        ).rejects.toThrow('error.payment-method-not-found');
    });

    it('settles with the same method that took the payment when two enabled methods share a code', async () => {
        const code = 'twin-code';
        const first = await createMethod(code, twoStagePaymentMethod.code, true);
        await createMethod(code, twoStagePaymentMethod.code, true);

        const ctx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
        const paymentMethodService = server.app.get(PaymentMethodService);
        const forCreate = await paymentMethodService.getMethodAndOperations(ctx, code);
        const forPayment = await paymentMethodService.getMethodAndOperationsForPayment(
            ctx,
            new Payment({ method: code }),
        );

        expect(forPayment.paymentMethod.id).toBe(forCreate.paymentMethod.id);
        // The lowest id wins, in both lookups
        expect(`T_${forCreate.paymentMethod.id}`).toBe(first.id);
    });
});
