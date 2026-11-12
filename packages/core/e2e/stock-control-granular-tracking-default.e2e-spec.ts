/* eslint-disable @typescript-eslint/no-non-null-assertion */
/**
 * #2908: granular `trackInventory` controls with the DefaultStockLocationStrategy, the strategy
 * core configures by default. The MultiChannelStockLocationStrategy is covered by
 * stock-control-granular-tracking.e2e-spec.ts.
 */
import { DefaultStockLocationStrategy, mergeConfig } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { testSuccessfulPaymentMethod } from './fixtures/test-payment-methods';
import { graphql as graphqlAdmin } from './graphql/graphql-admin';
import { graphql as graphqlShop } from './graphql/graphql-shop';

const GET_STOCK = graphqlAdmin(`
    query GranularDefaultGetStock($id: ID!) {
        productVariant(id: $id) {
            id
            trackInventory
            stockLevels {
                stockLocationId
                stockOnHand
                stockAllocated
            }
        }
    }
`);

const UPDATE_VARIANT = graphqlAdmin(`
    mutation GranularDefaultUpdateVariant($input: [UpdateProductVariantInput!]!) {
        updateProductVariants(input: $input) {
            id
        }
    }
`);

const CREATE_STOCK_LOCATION = graphqlAdmin(`
    mutation GranularDefaultCreateStockLocation($input: CreateStockLocationInput!) {
        createStockLocation(input: $input) {
            id
        }
    }
`);

const CANCEL_ORDER = graphqlAdmin(`
    mutation GranularDefaultCancelOrder($input: CancelOrderInput!) {
        cancelOrder(input: $input) {
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

const ADD_ITEM = graphqlShop(`
    mutation GranularDefaultAddItem($productVariantId: ID!, $quantity: Int!) {
        addItemToOrder(productVariantId: $productVariantId, quantity: $quantity) {
            ... on Order {
                id
                code
                lines {
                    id
                    quantity
                }
            }
            ... on ErrorResult {
                errorCode
                message
            }
            ... on InsufficientStockError {
                quantityAvailable
            }
        }
    }
`);

const SET_CUSTOMER = graphqlShop(`
    mutation GranularDefaultSetCustomer($input: CreateCustomerInput!) {
        setCustomerForOrder(input: $input) {
            ... on Order {
                id
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`);

const SET_ADDRESS = graphqlShop(`
    mutation GranularDefaultSetAddress($input: CreateAddressInput!) {
        setOrderShippingAddress(input: $input) {
            ... on Order {
                id
            }
        }
    }
`);

const ELIGIBLE_SHIPPING = graphqlShop(`
    query GranularDefaultEligibleShipping {
        eligibleShippingMethods {
            id
        }
    }
`);

const SET_SHIPPING = graphqlShop(`
    mutation GranularDefaultSetShipping($id: [ID!]!) {
        setOrderShippingMethod(shippingMethodId: $id) {
            ... on Order {
                id
            }
        }
    }
`);

const TRANSITION = graphqlShop(`
    mutation GranularDefaultTransition($state: String!) {
        transitionOrderToState(state: $state) {
            ... on Order {
                id
                state
            }
            ... on OrderStateTransitionError {
                transitionError
            }
        }
    }
`);

const ADD_PAYMENT = graphqlShop(`
    mutation GranularDefaultAddPayment($input: PaymentInput!) {
        addPaymentToOrder(input: $input) {
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

describe('Stock control: granular trackInventory (DefaultStockLocationStrategy)', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            paymentOptions: { paymentMethodHandlers: [testSuccessfulPaymentMethod] },
            catalogOptions: { stockLocationStrategy: new DefaultStockLocationStrategy() },
        }),
    );
    const defaultLocationId = 'T_1';
    let untrackedLocationId: string;
    let orderCounter = 0;

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
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-stock-control-multi.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
        const { createStockLocation } = await adminClient.query(CREATE_STOCK_LOCATION, {
            input: { name: 'Drop-ship supplier' },
        });
        untrackedLocationId = createStockLocation.id;
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    async function getStock(variantId: string) {
        const { productVariant } = await adminClient.query(GET_STOCK, { id: variantId });
        return productVariant!;
    }

    function levelAt(variant: Awaited<ReturnType<typeof getStock>>, locationId: string) {
        return variant.stockLevels.find(l => l.stockLocationId === locationId);
    }

    async function setVariant(variantId: string, input: Record<string, unknown>) {
        await adminClient.query(UPDATE_VARIANT, { input: [{ id: variantId, ...input } as any] });
    }

    async function placeOrder(variantId: string, quantity: number) {
        await shopClient.asAnonymousUser();
        const { addItemToOrder } = await shopClient.query(ADD_ITEM, {
            productVariantId: variantId,
            quantity,
        });
        if (!('lines' in addItemToOrder)) {
            throw new Error(`addItemToOrder failed: ${JSON.stringify(addItemToOrder)}`);
        }
        orderCounter++;
        await shopClient.query(SET_CUSTOMER, {
            input: {
                emailAddress: `granular-default-${orderCounter}@test.com`,
                firstName: 'Granular',
                lastName: `Default${orderCounter}`,
            },
        });
        await shopClient.query(SET_ADDRESS, { input: { streetLine1: '1 Test St', countryCode: 'GB' } });
        const { eligibleShippingMethods } = await shopClient.query(ELIGIBLE_SHIPPING);
        await shopClient.query(SET_SHIPPING, { id: [eligibleShippingMethods[0].id] });
        await shopClient.query(TRANSITION, { state: 'ArrangingPayment' });
        const { addPaymentToOrder } = await shopClient.query(ADD_PAYMENT, {
            input: { method: testSuccessfulPaymentMethod.code, metadata: {} },
        });
        if (!('state' in addPaymentToOrder) || addPaymentToOrder.state !== 'PaymentSettled') {
            throw new Error(`addPaymentToOrder failed: ${JSON.stringify(addPaymentToOrder)}`);
        }
        return addPaymentToOrder.id;
    }

    // #2908 — tracked stock is used first; an untracked StockLevel only takes the overflow, so
    // the warehouse stock is still counted down
    it('allocates tracked stock first and sends the overflow to the untracked location', async () => {
        await setVariant('T_1', {
            trackInventory: 'TRUE',
            stockLevels: [
                { stockLocationId: defaultLocationId, stockOnHand: 2 },
                { stockLocationId: untrackedLocationId, stockOnHand: 0, trackInventory: 'FALSE' },
            ],
        });

        const orderId = await placeOrder('T_1', 5);

        const variant = await getStock('T_1');
        expect(levelAt(variant, defaultLocationId)).toMatchObject({ stockOnHand: 2, stockAllocated: 2 });
        expect(levelAt(variant, untrackedLocationId)).toMatchObject({ stockOnHand: 0, stockAllocated: 0 });

        const { cancelOrder } = await adminClient.query(CANCEL_ORDER, { input: { orderId } });
        expect((cancelOrder as any).state).toBe('Cancelled');
        expect(levelAt(await getStock('T_1'), defaultLocationId)!.stockAllocated).toBe(0);
    });

    // #2908 — the release follows the tracked state recorded at allocation, not the current flag
    it('tracked at allocation, untracked at release: stockAllocated returns to its start value', async () => {
        await setVariant('T_2', {
            trackInventory: 'TRUE',
            stockLevels: [{ stockLocationId: defaultLocationId, stockOnHand: 10 }],
        });
        const orderId = await placeOrder('T_2', 3);
        expect(levelAt(await getStock('T_2'), defaultLocationId)!.stockAllocated).toBe(3);

        await setVariant('T_2', { trackInventory: 'FALSE' });
        const { cancelOrder } = await adminClient.query(CANCEL_ORDER, { input: { orderId } });
        expect((cancelOrder as any).state).toBe('Cancelled');

        expect(levelAt(await getStock('T_2'), defaultLocationId)!.stockAllocated).toBe(0);
    });

    // #2908 — a variant that is untracked everywhere can be sold beyond its stock and allocates
    // nothing against it
    it('an untracked variant is allocated without touching stockAllocated', async () => {
        await setVariant('T_3', {
            trackInventory: 'FALSE',
            stockLevels: [{ stockLocationId: defaultLocationId, stockOnHand: 1 }],
        });
        await placeOrder('T_3', 4);
        expect(levelAt(await getStock('T_3'), defaultLocationId)).toMatchObject({
            stockOnHand: 1,
            stockAllocated: 0,
        });
    });
});
