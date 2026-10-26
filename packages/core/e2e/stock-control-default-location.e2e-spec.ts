/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { GlobalFlag } from '@vendure/common/lib/generated-types';
import { DefaultStockLocationStrategy, EventBus, mergeConfig, StockShortfallEvent } from '@vendure/core';
import {
    createErrorResultGuard,
    createTestEnvironment,
    type ErrorResultGuard,
    SimpleGraphQLClient,
} from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { testSuccessfulPaymentMethod } from './fixtures/test-payment-methods';
import { FragmentOf } from './graphql/graphql-shop';
import { getStockMovementDocument, updateProductVariantsDocument } from './graphql/shared-definitions';
import {
    addItemToOrderDocument,
    removeAllOrderLinesDocument,
    testOrderFragment,
    updatedOrderFragment,
} from './graphql/shop-definitions';
import { addPaymentToOrder, proceedToArrangingPayment } from './utils/test-order-utils';

/**
 * GHSA-8ghm-q833-cmgp follow-up. The advisory's fix capped the allocation in
 * MultiChannelStockLocationStrategy, which is the default. DefaultStockLocationStrategy kept
 * allocating the full ordered quantity from the first StockLocation without reading the stock,
 * so a shop configured with it was still oversold.
 *
 * With the default StockAllocationStrategy the saleable stock check runs on the transition to
 * ArrangingPayment and the allocation runs on the transition to PaymentSettled, in a later
 * request. Two Orders can therefore both pass the check for the last unit and both go on to
 * settle. The suite walks exactly that sequence, without needing concurrency, so it has the
 * same meaning on every database including sql.js.
 */
describe('Stock control (DefaultStockLocationStrategy)', () => {
    const testEnvConfig = mergeConfig(testConfig(), {
        paymentOptions: {
            paymentMethodHandlers: [testSuccessfulPaymentMethod],
        },
        catalogOptions: {
            stockLocationStrategy: new DefaultStockLocationStrategy(),
        },
    });
    const { server, adminClient } = createTestEnvironment(testEnvConfig);

    const orderGuard: ErrorResultGuard<
        FragmentOf<typeof testOrderFragment> | FragmentOf<typeof updatedOrderFragment>
    > = createErrorResultGuard(input => !!input.lines);

    async function getVariantStock(variantId: string) {
        const { product } = await adminClient.query(getStockMovementDocument, { id: 'T_1' });
        return product!.variants.find(v => v.id === variantId)!;
    }

    async function setVariantStock(
        variantId: string,
        input: { stockOnHand: number; trackInventory: GlobalFlag; outOfStockThreshold?: number },
    ) {
        await adminClient.query(updateProductVariantsDocument, {
            input: [
                {
                    id: variantId,
                    stockOnHand: input.stockOnHand,
                    trackInventory: input.trackInventory,
                    useGlobalOutOfStockThreshold: false,
                    outOfStockThreshold: input.outOfStockThreshold ?? 0,
                },
            ],
        });
    }

    /**
     * Each Order needs its own session, since a SimpleGraphQLClient holds one, and the two
     * Orders are both active at the same time.
     */
    async function orderClient(emailAddress: string, variantId: string, quantity: number) {
        const client = new SimpleGraphQLClient(
            testEnvConfig,
            `http://localhost:${testEnvConfig.apiOptions.port}/${testEnvConfig.apiOptions.shopApiPath}`,
        );
        await client.asUserWithCredentials(emailAddress, 'test');
        await client.query(removeAllOrderLinesDocument);
        const { addItemToOrder } = await client.query(addItemToOrderDocument, {
            productVariantId: variantId,
            quantity,
        });
        orderGuard.assertSuccess(addItemToOrder);
        return client;
    }

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
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-stock-control.csv'),
            customerCount: 3,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('does not oversell when two Orders pass the stock check for the last unit', async () => {
        const variantId = 'T_1';
        await setVariantStock(variantId, { stockOnHand: 1, trackInventory: GlobalFlag.TRUE });

        // Both Orders pass the saleable stock check: nothing is allocated until settlement.
        const clientA = await orderClient('hayden.zieme12@hotmail.com', variantId, 1);
        const clientB = await orderClient('trevor_donnelly96@hotmail.com', variantId, 1);
        expect(await proceedToArrangingPayment(clientA)).toBeDefined();
        expect(await proceedToArrangingPayment(clientB)).toBeDefined();

        // Order A settles first and takes the unit.
        const orderA = await addPaymentToOrder(clientA, testSuccessfulPaymentMethod);
        orderGuard.assertSuccess(orderA);
        const afterA = await getVariantStock(variantId);
        expect(afterA.stockOnHand).toBe(1);
        expect(afterA.stockAllocated).toBe(1);

        // Order B has already paid, so its allocation is capped rather than refused.
        const events: StockShortfallEvent[] = [];
        const subscription = server.app
            .get(EventBus)
            .ofType(StockShortfallEvent)
            .subscribe(e => events.push(e));
        try {
            const orderB = await addPaymentToOrder(clientB, testSuccessfulPaymentMethod);
            orderGuard.assertSuccess(orderB);
            // Events are published after the transaction commits
            await new Promise(resolve => setTimeout(resolve, 500));

            const afterB = await getVariantStock(variantId);
            expect(afterB.stockOnHand).toBe(1);
            expect(afterB.stockAllocated).toBe(1);
            expect(afterB.stockAllocated).toBeLessThanOrEqual(afterB.stockOnHand);

            expect(events.map(e => e.order.code)).toEqual([orderB.code]);
            expect(events[0].shortfalls).toEqual([expect.objectContaining({ requested: 1, allocated: 0 })]);
        } finally {
            subscription.unsubscribe();
        }
    });

    it('allocates as far as a negative outOfStockThreshold permits', async () => {
        const variantId = 'T_2';
        await setVariantStock(variantId, {
            stockOnHand: 1,
            trackInventory: GlobalFlag.TRUE,
            outOfStockThreshold: -2,
        });

        // Saleable stock is `stockOnHand - stockAllocated - outOfStockThreshold` = 3, so the
        // backorder of 3 passes the check and must also be allocated in full.
        const client = await orderClient('hayden.zieme12@hotmail.com', variantId, 3);
        await proceedToArrangingPayment(client);
        const order = await addPaymentToOrder(client, testSuccessfulPaymentMethod);
        orderGuard.assertSuccess(order);

        const after = await getVariantStock(variantId);
        expect(after.stockOnHand).toBe(1);
        expect(after.stockAllocated).toBe(3);
    });

    it('allocates the full quantity for a variant which does not track inventory', async () => {
        const variantId = 'T_3';
        await setVariantStock(variantId, { stockOnHand: 0, trackInventory: GlobalFlag.FALSE });

        const client = await orderClient('trevor_donnelly96@hotmail.com', variantId, 5);
        await proceedToArrangingPayment(client);
        const order = await addPaymentToOrder(client, testSuccessfulPaymentMethod);
        orderGuard.assertSuccess(order);

        // An untracked variant's stockAllocated is not changed by an allocation, but the
        // Allocation itself must still cover the whole OrderLine.
        const after = await getVariantStock(variantId);
        expect(after.stockOnHand).toBe(0);
        expect(after.stockAllocated).toBe(0);
        const allocations = after.stockMovements.items.filter(m => m.type === 'ALLOCATION');
        expect(allocations.map(a => a.quantity)).toEqual([5]);
    });
});
