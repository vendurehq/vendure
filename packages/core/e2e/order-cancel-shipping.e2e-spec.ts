/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { mergeConfig } from '@vendure/core';
import { createErrorResultGuard, createTestEnvironment, ErrorResultGuard } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { failsToSettlePaymentMethod } from './fixtures/test-payment-methods';
import { canceledOrderFragment } from './graphql/fragments-admin';
import { FragmentOf } from './graphql/graphql-admin';
import { FragmentOf as FragmentOfShop } from './graphql/graphql-shop';
import {
    cancelOrderDocument,
    getCustomerListDocument,
    getOrderDocument,
    updateChannelDocument,
} from './graphql/shared-definitions';
import { addItemToOrderDocument, testOrderFragment, updatedOrderFragment } from './graphql/shop-definitions';
import { addPaymentToOrder, proceedToArrangingPayment } from './utils/test-order-utils';

// #4348 — cancelOrder with cancelShipping left residual shipping cost when pricesIncludeTax=true
describe('cancelOrder with cancelShipping using a taxed shipping method', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            paymentOptions: {
                paymentMethodHandlers: [failsToSettlePaymentMethod],
            },
        }),
    );

    type CanceledOrderFragment = FragmentOf<typeof canceledOrderFragment>;
    const canceledOrderGuard: ErrorResultGuard<CanceledOrderFragment> = createErrorResultGuard(
        input => !!input.lines,
    );

    type ShopOrderFragment =
        | FragmentOfShop<typeof testOrderFragment>
        | FragmentOfShop<typeof updatedOrderFragment>;
    const shopOrderGuard: ErrorResultGuard<ShopOrderFragment> = createErrorResultGuard(
        input => !!input.lines,
    );

    const password = 'test';
    let customerEmail: string;

    beforeAll(async () => {
        await server.init({
            initialData: {
                ...initialData,
                paymentMethods: [
                    {
                        name: failsToSettlePaymentMethod.code,
                        handler: { code: failsToSettlePaymentMethod.code, arguments: [] },
                    },
                ],
            },
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();

        const { customers } = await adminClient.query(getCustomerListDocument);
        customerEmail = customers.items[0].emailAddress;
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    // Each describe below explicitly sets `channel.pricesIncludeTax` because state leaks
    // across blocks within the same file – mirrors the existing order-taxes.e2e-spec pattern.
    async function createPaymentAuthorizedOrder() {
        await shopClient.asUserWithCredentials(customerEmail, password);
        const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
            productVariantId: 'T_1',
            quantity: 1,
        });
        shopOrderGuard.assertSuccess(addItemToOrder);

        // Index 2 == "Express Shipping (Taxed)" (20% tax) in e2e-initial-data.ts.
        await proceedToArrangingPayment(shopClient, 2);
        // cancelOrderById short-circuits for active orders, so the modifier shipping-
        // cancellation path only runs once we leave AddingItems/ArrangingPayment.
        const order = await addPaymentToOrder(shopClient, failsToSettlePaymentMethod);
        shopOrderGuard.assertSuccess(order);
        return order;
    }

    describe('channel.pricesIncludeTax = true (the buggy branch)', () => {
        beforeAll(async () => {
            await adminClient.query(updateChannelDocument, {
                input: { id: 'T_1', pricesIncludeTax: true },
            });
        });

        it('cancelShipping zeroes both shipping and shippingWithTax', async () => {
            const order = await createPaymentAuthorizedOrder();

            // Pre-cancellation snapshot: with pricesIncludeTax=true the shipping method's
            // listPrice (1000) is treated as gross, so shipping (net) < shippingWithTax (gross).
            expect(order.state).toBe('PaymentAuthorized');
            expect(order.shipping).toBeGreaterThan(0);
            expect(order.shippingWithTax).toBeGreaterThan(order.shipping);

            const { cancelOrder } = await adminClient.query(cancelOrderDocument, {
                input: { orderId: order.id, cancelShipping: true },
            });
            canceledOrderGuard.assertSuccess(cancelOrder);

            const { order: cancelledOrder } = await adminClient.query(getOrderDocument, {
                id: order.id,
            });
            // Before the fix, shippingWithTax was left equal to the tax amount of the
            // original shipping cost (shippingWithTax - shipping). Asserting on BOTH values
            // means a regression that only zeroes one of them would fail.
            expect(cancelledOrder!.state).toBe('Cancelled');
            expect(cancelledOrder!.shipping).toBe(0);
            expect(cancelledOrder!.shippingWithTax).toBe(0);
            expect(cancelledOrder!.total).toBe(0);
            expect(cancelledOrder!.totalWithTax).toBe(0);
        });
    });

    describe('channel.pricesIncludeTax = false (regression protection)', () => {
        beforeAll(async () => {
            await adminClient.query(updateChannelDocument, {
                input: { id: 'T_1', pricesIncludeTax: false },
            });
        });

        it('cancelShipping zeroes both shipping and shippingWithTax', async () => {
            const order = await createPaymentAuthorizedOrder();

            // Pre-cancellation snapshot: with pricesIncludeTax=false the listPrice (1000) is
            // treated as net, so shipping (net) === listPrice and shippingWithTax = net + tax.
            expect(order.state).toBe('PaymentAuthorized');
            expect(order.shipping).toBeGreaterThan(0);
            expect(order.shippingWithTax).toBeGreaterThan(order.shipping);

            const { cancelOrder } = await adminClient.query(cancelOrderDocument, {
                input: { orderId: order.id, cancelShipping: true },
            });
            canceledOrderGuard.assertSuccess(cancelOrder);

            const { order: cancelledOrder } = await adminClient.query(getOrderDocument, {
                id: order.id,
            });
            expect(cancelledOrder!.state).toBe('Cancelled');
            expect(cancelledOrder!.shipping).toBe(0);
            expect(cancelledOrder!.shippingWithTax).toBe(0);
            expect(cancelledOrder!.total).toBe(0);
            expect(cancelledOrder!.totalWithTax).toBe(0);
        });
    });
});
