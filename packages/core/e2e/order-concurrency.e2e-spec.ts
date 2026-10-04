/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { GlobalFlag } from '@vendure/common/lib/generated-types';
import { mergeConfig } from '@vendure/core';
import { createTestEnvironment, SimpleGraphQLClient } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { testSuccessfulPaymentMethod } from './fixtures/test-payment-methods';
import { graphql } from './graphql/graphql-admin';
import {
    getOrderListDocument,
    getProductVariantListDocument,
    updateProductVariantsDocument,
} from './graphql/shared-definitions';
import {
    addItemToOrderDocument,
    getActiveOrderDocument,
    getActiveOrderShippingBillingDocument,
    getEligibleShippingMethodsDocument,
    setCustomerDocument,
    setShippingAddressDocument,
    setShippingMethodDocument,
    transitionToStateDocument,
} from './graphql/shop-definitions';
import { addPaymentToOrder } from './utils/test-order-utils';

const getVariantStockDocument = graphql(`
    query GetVariantStockForConcurrency($id: ID!) {
        productVariant(id: $id) {
            id
            stockOnHand
            stockAllocated
        }
    }
`);

/**
 * Concurrency regression tests for #4152.
 *
 * Every test here fires genuinely concurrent HTTP requests with Promise.all and asserts that the
 * outcome is the one a serialized execution would have produced.
 *
 * They are skipped on sql.js, which serializes every write onto a single connection and so cannot
 * exhibit the races in the first place. That is also why the row locking these tests exercise is a
 * no-op there. See TransactionalConnection.lockRow.
 */
const describeOnRealDb = process.env.DB && process.env.DB !== 'sqljs' ? describe : describe.skip;

describeOnRealDb('Order concurrency', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            paymentOptions: {
                paymentMethodHandlers: [testSuccessfulPaymentMethod],
            },
        }),
    );

    let variantIds: string[] = [];

    /**
     * A client with its own session, and therefore its own active order.
     *
     * The session is established with one request before the client is handed back. Without that,
     * concurrent requests from the client would each arrive without a token and so would each be
     * given a session of their own, which is a different situation from the one under test.
     */
    async function newShopClient(): Promise<SimpleGraphQLClient> {
        const config = testConfig();
        const client = new SimpleGraphQLClient(
            config,
            `http://localhost:${String(config.apiOptions.port)}/${String(config.apiOptions.shopApiPath)}`,
        );
        await client.asAnonymousUser();
        await client.query(getActiveOrderDocument);
        expect(client.getAuthToken()).toBeTruthy();
        return client;
    }

    async function setCustomer(client: SimpleGraphQLClient, emailAddress: string) {
        await client.query(setCustomerDocument, {
            input: { emailAddress, firstName: 'Concurrent', lastName: 'Customer' },
        });
    }

    async function countOrders(): Promise<number> {
        const { orders } = await adminClient.query(getOrderListDocument, {});
        return orders.totalItems;
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
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 2,
        });
        await adminClient.asSuperAdmin();
        const { productVariants } = await adminClient.query(getProductVariantListDocument, {
            options: { take: 5 },
        });
        variantIds = productVariants.items.map(v => v.id);
        expect(variantIds.length).toBeGreaterThanOrEqual(3);
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    // #4152 — this pair already survives on master, because applyPriceAdjustments omits both
    // address columns from the object it saves for exactly this reason. The test pins that
    // mitigation in place, since removing the omit list would reintroduce the lost update.
    it('does not lose an address written concurrently with a shipping method', async () => {
        const client = await newShopClient();
        await client.query(addItemToOrderDocument, {
            productVariantId: variantIds[0],
            quantity: 1,
        });
        const { eligibleShippingMethods } = await client.query(getEligibleShippingMethodsDocument);

        await Promise.all([
            client.query(setShippingAddressDocument, {
                input: {
                    fullName: 'Concurrent Customer',
                    streetLine1: '12 the street',
                    city: 'foo',
                    postalCode: '123456',
                    countryCode: 'US',
                },
            }),
            client.query(setShippingMethodDocument, {
                id: [eligibleShippingMethods[0].id],
            }),
        ]);

        const { activeOrder: addresses } = await client.query(getActiveOrderShippingBillingDocument);
        const { activeOrder } = await client.query(getActiveOrderDocument);
        expect(addresses!.shippingAddress!.streetLine1).toBe('12 the street');
        expect(activeOrder!.shippingLines.length).toBe(1);
    });

    // #2187 — concurrent addItemToOrder calls each read the order, add their line, and write back,
    // so some lines went missing.
    it('adds every item when items are added concurrently', async () => {
        const client = await newShopClient();
        const variantsToAdd = variantIds.slice(0, 3);

        await Promise.all(
            variantsToAdd.map(productVariantId =>
                client.query(addItemToOrderDocument, { productVariantId, quantity: 1 }),
            ),
        );

        const { activeOrder } = await client.query(getActiveOrderDocument);
        expect(activeOrder!.lines.map(l => l.productVariant.id).sort()).toEqual(
            [...variantsToAdd].sort(),
        );
        expect(activeOrder!.lines.length).toBe(variantsToAdd.length);
    });

    // #3398 — the case the Order lock exists for: the order already exists when the concurrent
    // requests arrive, so determining the active order finds it rather than creating it, and the
    // lock on the Session is never reached. Only the lock taken when the Order itself is read
    // serializes these, so this is the test which pins that lock in place.
    it('adds every item when items are added concurrently to an existing order', async () => {
        const client = await newShopClient();
        // Establish the order first, so that the concurrent requests below take the path where an
        // active order is already recorded on the session.
        await client.query(addItemToOrderDocument, {
            productVariantId: variantIds[0],
            quantity: 1,
        });
        const variantsToAdd = variantIds.slice(1, 4);

        await Promise.all(
            variantsToAdd.map(productVariantId =>
                client.query(addItemToOrderDocument, { productVariantId, quantity: 1 }),
            ),
        );

        const { activeOrder } = await client.query(getActiveOrderDocument);
        expect(activeOrder!.lines.map(l => l.productVariant.id).sort()).toEqual(
            [variantIds[0], ...variantsToAdd].sort(),
        );
        // The lines are separate rows, so they survive on their own. The order's own totals are
        // not: each request recalculates them from the snapshot it read and writes the result to
        // the same columns, so without serialization the last writer wins and the total reflects
        // only the lines it happened to see.
        const expectedSubTotal = activeOrder!.lines.reduce((sum, line) => sum + line.linePrice, 0);
        expect(activeOrder!.subTotal).toBe(expectedSubTotal);
    });

    // #4152 — determining the active order is a check-then-act. Concurrent first requests on one
    // session each found no order and each created one, leaving the customer with several.
    it('creates exactly one order when a fresh session adds items concurrently', async () => {
        const client = await newShopClient();
        const ordersBefore = await countOrders();

        await Promise.all(
            variantIds
                .slice(0, 3)
                .map(productVariantId =>
                    client.query(addItemToOrderDocument, { productVariantId, quantity: 1 }),
                ),
        );

        expect(await countOrders()).toBe(ordersBefore + 1);
    });

    // community-plugins#11 — allocations are written by reading stockAllocated, adding the change
    // in JS and writing the sum back, so two concurrent allocations of the same variant both read
    // the same value and one silently overwrote the other. The variant then looked like it had
    // stock it had already promised away.
    //
    // Note what this does not cover: nothing checks saleable stock at allocation time, so both of
    // these orders are allowed to buy the last unit. That is a separate gap, tracked on its own.
    it('records every allocation when the last unit is paid for concurrently', async () => {
        const variantId = variantIds[4] ?? variantIds[0];
        await adminClient.query(updateProductVariantsDocument, {
            input: [
                {
                    id: variantId,
                    trackInventory: GlobalFlag.TRUE,
                    stockOnHand: 1,
                    outOfStockThreshold: 0,
                    useGlobalOutOfStockThreshold: false,
                },
            ],
        });

        // Both carts are built first. Stock is only allocated on the transition out of
        // ArrangingPayment, so both orders reach that state believing the unit is theirs.
        const clients = await Promise.all([newShopClient(), newShopClient()]);
        let index = 0;
        for (const client of clients) {
            await client.query(addItemToOrderDocument, { productVariantId: variantId, quantity: 1 });
            await setCustomer(client, `stock-race-${index++}@test.com`);
            await client.query(setShippingAddressDocument, {
                input: {
                    fullName: 'Concurrent Customer',
                    streetLine1: '12 the street',
                    city: 'foo',
                    postalCode: '123456',
                    countryCode: 'US',
                },
            });
            const { eligibleShippingMethods } = await client.query(getEligibleShippingMethodsDocument);
            await client.query(setShippingMethodDocument, { id: [eligibleShippingMethods[0].id] });
            const { transitionOrderToState } = await client.query(transitionToStateDocument, {
                state: 'ArrangingPayment',
            });
            expect((transitionOrderToState as any).state).toBe('ArrangingPayment');
        }

        await Promise.all(clients.map(client => addPaymentToOrder(client, testSuccessfulPaymentMethod)));

        const { productVariant } = await adminClient.query(getVariantStockDocument, { id: variantId });
        // Two units were allocated, so both allocations are on the record. Computing the sum in JS
        // instead leaves this at 1 and the second order's claim on the stock disappears.
        expect(productVariant!.stockAllocated).toBe(2);
    });
});
