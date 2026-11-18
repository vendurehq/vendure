/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { HistoryEntryType } from '@vendure/common/lib/generated-types';
import { mergeConfig } from '@vendure/core';
import { createTestEnvironment, SimpleGraphQLClient } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { testSuccessfulPaymentMethod } from './fixtures/test-payment-methods';
import { graphql } from './graphql/graphql-admin';
import { graphql as shopGraphql } from './graphql/graphql-shop';
import { getOrderListDocument, getProductVariantListDocument } from './graphql/shared-definitions';
import {
    addItemToOrderDocument,
    getActiveOrderDocument,
    getActiveOrderShippingBillingDocument,
    getEligibleShippingMethodsDocument,
    setBillingAddressDocument,
    setCustomerDocument,
    setShippingAddressDocument,
    setShippingMethodDocument,
    transitionToStateDocument,
} from './graphql/shop-definitions';
import { addPaymentToOrder } from './utils/test-order-utils';

const addManualPaymentDocument = graphql(`
    mutation AddManualPaymentForConcurrency($input: ManualPaymentInput!) {
        addManualPaymentToOrder(input: $input) {
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
`);

const getOrderPaymentsAndHistoryDocument = graphql(`
    query GetOrderPaymentsAndHistoryForConcurrency($id: ID!) {
        order(id: $id) {
            id
            state
            active
            payments {
                id
                state
            }
            history(options: { take: 100 }) {
                items {
                    type
                    data
                }
            }
        }
    }
`);

const getActiveOrderWithCustomerDocument = shopGraphql(`
    query GetActiveOrderWithCustomerForConcurrency {
        activeOrder {
            id
            subTotal
            customer {
                emailAddress
            }
            shippingLines {
                shippingMethod {
                    id
                }
            }
            lines {
                id
                linePrice
            }
        }
    }
`);

const address = {
    fullName: 'Concurrent Customer',
    streetLine1: '12 the street',
    city: 'foo',
    postalCode: '123456',
    countryCode: 'US',
};
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

    /** Builds a cart for the client and takes it to ArrangingPayment, returning the Order id. */
    async function checkoutToArrangingPayment(client: SimpleGraphQLClient, emailAddress: string) {
        await client.query(addItemToOrderDocument, { productVariantId: variantIds[2], quantity: 1 });
        await setCustomer(client, emailAddress);
        await client.query(setShippingAddressDocument, { input: address });
        const { eligibleShippingMethods } = await client.query(getEligibleShippingMethodsDocument);
        await client.query(setShippingMethodDocument, { id: [eligibleShippingMethods[0].id] });
        const { transitionOrderToState } = await client.query(transitionToStateDocument, {
            state: 'ArrangingPayment',
        });
        expect((transitionOrderToState as any).state).toBe('ArrangingPayment');
        return (transitionOrderToState as any).id as string;
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
        expect(activeOrder!.lines.map(l => l.productVariant.id).sort()).toEqual([...variantsToAdd].sort());
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

    // #3398 — the setters write different columns of the same Order row, and each one used to
    // save the whole Order it had read, so whichever finished last silently dropped the others.
    it('keeps every change when the customer, addresses, shipping method and an item are set concurrently', async () => {
        const client = await newShopClient();
        await client.query(addItemToOrderDocument, { productVariantId: variantIds[0], quantity: 1 });
        const { eligibleShippingMethods } = await client.query(getEligibleShippingMethodsDocument);
        const emailAddress = 'concurrent-setters@test.com';

        await Promise.all([
            client.query(setCustomerDocument, {
                input: { emailAddress, firstName: 'Concurrent', lastName: 'Customer' },
            }),
            client.query(setShippingAddressDocument, { input: { ...address, streetLine1: 'ship' } }),
            client.query(setBillingAddressDocument, { input: { ...address, streetLine1: 'bill' } }),
            client.query(setShippingMethodDocument, { id: [eligibleShippingMethods[0].id] }),
            client.query(addItemToOrderDocument, { productVariantId: variantIds[1], quantity: 2 }),
        ]);

        const { activeOrder: addresses } = await client.query(getActiveOrderShippingBillingDocument);
        const { activeOrder } = await client.query(getActiveOrderWithCustomerDocument);
        expect(activeOrder!.customer?.emailAddress).toBe(emailAddress);
        expect(addresses!.shippingAddress!.streetLine1).toBe('ship');
        expect(addresses!.billingAddress!.streetLine1).toBe('bill');
        expect(activeOrder!.shippingLines.length).toBe(1);
        expect(activeOrder!.lines.length).toBe(2);
        expect(activeOrder!.subTotal).toBe(activeOrder!.lines.reduce((sum, line) => sum + line.linePrice, 0));
    });

    // #3398 — the storefront and a payment provider's webhook both record the payment. Without
    // serialization both saw the Order in ArrangingPayment, so the Order entered PaymentSettled
    // twice and everything which reacts to that transition ran twice.
    it('settles the order once when the client and a webhook add the payment concurrently', async () => {
        const client = await newShopClient();
        const orderId = await checkoutToArrangingPayment(client, 'client-and-webhook@test.com');

        await Promise.all([
            addPaymentToOrder(client, testSuccessfulPaymentMethod).catch(() => undefined),
            adminClient
                .query(addManualPaymentDocument, {
                    input: { orderId, method: 'webhook', transactionId: 'webhook-1', metadata: {} },
                })
                .catch(() => undefined),
        ]);

        const { order } = await adminClient.query(getOrderPaymentsAndHistoryDocument, { id: orderId });
        expect(order!.state).toBe('PaymentSettled');
        expect(order!.payments!.filter(p => p.state === 'Settled').length).toBe(1);
        const enteredPaymentSettled = order!.history.items.filter(
            item =>
                item.type === HistoryEntryType.ORDER_STATE_TRANSITION && item.data.to === 'PaymentSettled',
        );
        expect(enteredPaymentSettled.length).toBe(1);
    });

    // #3398 — a webhook settles the payment while the customer goes back to the cart. Without
    // serialization each request acted on the state it had read, which could leave a paid Order
    // back in AddingItems.
    it('does not leave a paid order in the cart when the customer goes back during payment', async () => {
        const client = await newShopClient();
        const orderId = await checkoutToArrangingPayment(client, 'back-to-cart@test.com');

        await Promise.all([
            adminClient
                .query(addManualPaymentDocument, {
                    input: { orderId, method: 'webhook', transactionId: 'webhook-2', metadata: {} },
                })
                .catch(() => undefined),
            client.query(transitionToStateDocument, { state: 'AddingItems' }).catch(() => undefined),
        ]);

        const { order } = await adminClient.query(getOrderPaymentsAndHistoryDocument, { id: orderId });
        const settled = order!.payments!.filter(p => p.state === 'Settled').length;
        if (settled > 0) {
            expect(order!.state).toBe('PaymentSettled');
            expect(order!.active).toBe(false);
        } else {
            expect(order!.state).toBe('AddingItems');
        }
    });
});
