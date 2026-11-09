/* eslint-disable @typescript-eslint/no-non-null-assertion */
/**
 * Spike OSS-1002 (#2908): more granular `trackInventory` controls.
 *
 * Covers four things:
 * 1. Allocation correctness when the effective `trackInventory` value changes while an Order is
 *    open (allocated, then released / sold). Fails on master: release and sale re-read the
 *    *current* flag instead of the one in force when the stock was allocated.
 * 2. `Channel.trackInventory` acting as the default for variants set to INHERIT. Fails on master:
 *    the column exists but nothing reads it (GlobalSettings.trackInventory is used instead).
 * 3. A per-StockLevel override: a variant tracked at one location and untracked at another.
 * 4. An order split across a tracked and an untracked location, incl. Sale quantities per location.
 */
import {
    CurrencyCode,
    LanguageCode,
    manualFulfillmentHandler,
    mergeConfig,
    MultiChannelStockLocationStrategy,
} from '@vendure/core';
import { createTestEnvironment, E2E_DEFAULT_CHANNEL_TOKEN } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { testSuccessfulPaymentMethod } from './fixtures/test-payment-methods';
import { graphql as graphqlAdmin } from './graphql/graphql-admin';
import { graphql as graphqlShop } from './graphql/graphql-shop';

const CHANNEL_B_TOKEN = 'channel-b-token';

const GET_STOCK = graphqlAdmin(`
    query GranularGetStock($id: ID!) {
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

const GET_STOCK_WITH_FLAGS = graphqlAdmin(`
    query GranularGetStockWithFlags($id: ID!) {
        productVariant(id: $id) {
            id
            trackInventory
            stockLevels {
                stockLocationId
                stockOnHand
                stockAllocated
                trackInventory
            }
        }
    }
`);

const GET_SALES = graphqlAdmin(`
    query GranularGetSales($id: ID!) {
        productVariant(id: $id) {
            stockMovements(options: { take: 100 }) {
                items {
                    type
                    quantity
                }
            }
        }
    }
`);

const UPDATE_VARIANT = graphqlAdmin(`
    mutation GranularUpdateVariant($input: [UpdateProductVariantInput!]!) {
        updateProductVariants(input: $input) {
            id
        }
    }
`);

const UPDATE_GLOBAL_SETTINGS = graphqlAdmin(`
    mutation GranularUpdateGlobalSettings($input: UpdateGlobalSettingsInput!) {
        updateGlobalSettings(input: $input) {
            ... on GlobalSettings {
                id
            }
        }
    }
`);

const CREATE_STOCK_LOCATION = graphqlAdmin(`
    mutation GranularCreateStockLocation($input: CreateStockLocationInput!) {
        createStockLocation(input: $input) {
            id
        }
    }
`);

const CREATE_CHANNEL = graphqlAdmin(`
    mutation GranularCreateChannel($input: CreateChannelInput!) {
        createChannel(input: $input) {
            ... on Channel {
                id
                trackInventory
            }
            ... on ErrorResult {
                message
            }
        }
    }
`);

const ASSIGN_PRODUCTS = graphqlAdmin(`
    mutation GranularAssignProducts($input: AssignProductsToChannelInput!) {
        assignProductsToChannel(input: $input) {
            id
        }
    }
`);

const GET_ORDER = graphqlAdmin(`
    query GranularGetOrder($id: ID!) {
        order(id: $id) {
            id
            state
            lines {
                id
                quantity
            }
        }
    }
`);

const CANCEL_ORDER = graphqlAdmin(`
    mutation GranularCancelOrder($input: CancelOrderInput!) {
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

const CREATE_FULFILLMENT = graphqlAdmin(`
    mutation GranularCreateFulfillment($input: FulfillOrderInput!) {
        addFulfillmentToOrder(input: $input) {
            ... on Fulfillment {
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
    mutation GranularAddItem($productVariantId: ID!, $quantity: Int!) {
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
    mutation GranularSetCustomer($input: CreateCustomerInput!) {
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
    mutation GranularSetAddress($input: CreateAddressInput!) {
        setOrderShippingAddress(input: $input) {
            ... on Order {
                id
            }
        }
    }
`);

const ELIGIBLE_SHIPPING = graphqlShop(`
    query GranularEligibleShipping {
        eligibleShippingMethods {
            id
        }
    }
`);

const SET_SHIPPING = graphqlShop(`
    mutation GranularSetShipping($id: [ID!]!) {
        setOrderShippingMethod(shippingMethodId: $id) {
            ... on Order {
                id
            }
        }
    }
`);

const TRANSITION = graphqlShop(`
    mutation GranularTransition($state: String!) {
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
    mutation GranularAddPayment($input: PaymentInput!) {
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

const SHOP_PRODUCT_STOCK = graphqlShop(`
    query GranularShopStock($id: ID!) {
        product(id: $id) {
            variants {
                id
                stockLevel
            }
        }
    }
`);

describe('Stock control: granular trackInventory (OSS-1002)', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            paymentOptions: {
                paymentMethodHandlers: [testSuccessfulPaymentMethod],
            },
            catalogOptions: {
                stockLocationStrategy: new MultiChannelStockLocationStrategy(),
            },
        }),
    );

    let defaultLocationId: string;
    let secondLocationId: string;
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
        await adminClient.query(UPDATE_GLOBAL_SETTINGS, { input: { trackInventory: true } });
        defaultLocationId = 'T_1';
        const { createStockLocation } = await adminClient.query(CREATE_STOCK_LOCATION, {
            input: { name: 'Untracked dropship location' },
        });
        secondLocationId = createStockLocation.id;
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

    async function setVariantTracking(variantId: string, trackInventory: 'TRUE' | 'FALSE' | 'INHERIT') {
        await adminClient.query(UPDATE_VARIANT, {
            input: [{ id: variantId, trackInventory: trackInventory as any }],
        });
    }

    async function placeOrder(variantId: string, quantity: number) {
        await shopClient.asAnonymousUser();
        const { addItemToOrder } = await shopClient.query(ADD_ITEM, { productVariantId: variantId, quantity });
        if (!('lines' in addItemToOrder)) {
            throw new Error(`addItemToOrder failed: ${JSON.stringify(addItemToOrder)}`);
        }
        orderCounter++;
        await shopClient.query(SET_CUSTOMER, {
            input: {
                emailAddress: `granular-${orderCounter}@test.com`,
                firstName: 'Granular',
                lastName: `Tester${orderCounter}`,
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

    async function cancelOrder(orderId: string) {
        const { cancelOrder: result } = await adminClient.query(CANCEL_ORDER, { input: { orderId } });
        expect((result as any).state).toBe('Cancelled');
    }

    async function fulfillOrder(orderId: string) {
        const { order } = await adminClient.query(GET_ORDER, { id: orderId });
        const { addFulfillmentToOrder } = await adminClient.query(CREATE_FULFILLMENT, {
            input: {
                lines: order!.lines.map(l => ({ orderLineId: l.id, quantity: l.quantity })),
                handler: {
                    code: manualFulfillmentHandler.code,
                    arguments: [
                        { name: 'method', value: 'test' },
                        { name: 'trackingCode', value: 'X' },
                    ],
                },
            },
        });
        expect((addFulfillmentToOrder as any).state).toBe('Pending');
    }

    describe('flag changes while an order is open', () => {
        it('tracked at allocation, untracked at release: stockAllocated returns to its start value', async () => {
            await setVariantTracking('T_1', 'TRUE');
            const before = levelAt(await getStock('T_1'), defaultLocationId)!;
            const orderId = await placeOrder('T_1', 3);
            expect(levelAt(await getStock('T_1'), defaultLocationId)!.stockAllocated).toBe(
                before.stockAllocated + 3,
            );

            await setVariantTracking('T_1', 'FALSE');
            await cancelOrder(orderId);

            // On master the release skips the decrement because the variant is now untracked,
            // so 3 units stay allocated forever.
            expect(levelAt(await getStock('T_1'), defaultLocationId)!.stockAllocated).toBe(
                before.stockAllocated,
            );
        });

        it("untracked at allocation, tracked at release: another order's allocation is not released", async () => {
            // A bystander order holds 4 tracked units of T_2.
            await setVariantTracking('T_2', 'TRUE');
            const before = levelAt(await getStock('T_2'), defaultLocationId)!;
            await placeOrder('T_2', 4);
            expect(levelAt(await getStock('T_2'), defaultLocationId)!.stockAllocated).toBe(
                before.stockAllocated + 4,
            );

            // This order is placed while T_2 is untracked, so it allocates nothing.
            await setVariantTracking('T_2', 'FALSE');
            const orderId = await placeOrder('T_2', 2);
            expect(levelAt(await getStock('T_2'), defaultLocationId)!.stockAllocated).toBe(
                before.stockAllocated + 4,
            );

            await setVariantTracking('T_2', 'TRUE');
            await cancelOrder(orderId);

            // On master the release decrements 2 units it never allocated, silently freeing
            // half of the bystander's allocation (the clamp at zero hides it when nothing else
            // is allocated).
            expect(levelAt(await getStock('T_2'), defaultLocationId)!.stockAllocated).toBe(
                before.stockAllocated + 4,
            );
        });

        it('tracked at allocation, untracked at fulfillment: the sale still consumes the allocated stock', async () => {
            await setVariantTracking('T_1', 'TRUE');
            const before = levelAt(await getStock('T_1'), defaultLocationId)!;
            const orderId = await placeOrder('T_1', 2);

            await setVariantTracking('T_1', 'FALSE');
            await fulfillOrder(orderId);

            const after = levelAt(await getStock('T_1'), defaultLocationId)!;
            // On master neither figure moves: the units stay allocated and are never deducted.
            expect(after.stockAllocated).toBe(before.stockAllocated);
            expect(after.stockOnHand).toBe(before.stockOnHand - 2);
            await setVariantTracking('T_1', 'TRUE');
        });
    });

    describe('Channel.trackInventory as the default for INHERIT', () => {
        let channelBLocationId: string;

        beforeAll(async () => {
            const { createChannel } = await adminClient.query(CREATE_CHANNEL, {
                input: {
                    code: 'channel-b',
                    token: CHANNEL_B_TOKEN,
                    defaultLanguageCode: LanguageCode.en,
                    currencyCode: CurrencyCode.GBP,
                    pricesIncludeTax: true,
                    defaultShippingZoneId: 'T_1',
                    defaultTaxZoneId: 'T_1',
                    trackInventory: false,
                },
            });
            const channelBId = (createChannel as any).id;
            expect((createChannel as any).trackInventory).toBe(false);
            await adminClient.query(ASSIGN_PRODUCTS, {
                input: { channelId: channelBId, productIds: ['T_1'], priceFactor: 1 },
            });
            adminClient.setChannelToken(CHANNEL_B_TOKEN);
            const { createStockLocation } = await adminClient.query(CREATE_STOCK_LOCATION, {
                input: { name: 'Channel B warehouse' },
            });
            channelBLocationId = createStockLocation.id;
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            await setVariantTracking('T_3', 'INHERIT');
        });

        afterAll(() => {
            shopClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        });

        it('default channel (trackInventory: true) treats T_3 as tracked', async () => {
            shopClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            await shopClient.asAnonymousUser();
            const { addItemToOrder } = await shopClient.query(ADD_ITEM, {
                productVariantId: 'T_3',
                quantity: 500,
            });
            expect((addItemToOrder as any).errorCode).toBe('INSUFFICIENT_STOCK_ERROR');
        });

        it('channel B (trackInventory: false) treats T_3 as untracked, though it has no stock there', async () => {
            expect(channelBLocationId).toBeDefined();
            shopClient.setChannelToken(CHANNEL_B_TOKEN);
            await shopClient.asAnonymousUser();
            const { addItemToOrder } = await shopClient.query(ADD_ITEM, {
                productVariantId: 'T_3',
                quantity: 500,
            });
            // On master Channel.trackInventory is ignored, so this is an InsufficientStockError.
            expect((addItemToOrder as any).lines?.[0]?.quantity).toBe(500);
        });
    });

    describe('per-StockLevel override', () => {
        it('sets trackInventory: FALSE on the StockLevel at the second location', async () => {
            await setVariantTracking('T_4', 'TRUE');
            await adminClient.query(UPDATE_VARIANT, {
                input: [
                    {
                        id: 'T_4',
                        stockLevels: [
                            { stockLocationId: defaultLocationId, stockOnHand: 2 },
                            { stockLocationId: secondLocationId, stockOnHand: 0, trackInventory: 'FALSE' },
                        ] as any,
                    },
                ],
            });
            const { productVariant } = await adminClient.query(GET_STOCK_WITH_FLAGS, { id: 'T_4' });
            expect(productVariant!.stockLevels).toEqual(
                expect.arrayContaining([
                    { stockLocationId: defaultLocationId, stockOnHand: 2, stockAllocated: 0, trackInventory: 'INHERIT' },
                    { stockLocationId: secondLocationId, stockOnHand: 0, stockAllocated: 0, trackInventory: 'FALSE' },
                ]),
            );
        });

        it('an untracked location makes the variant saleable beyond the tracked stock', async () => {
            const { product } = await shopClient.query(SHOP_PRODUCT_STOCK, { id: 'T_1' });
            expect(product!.variants.find(v => v.id === 'T_4')!.stockLevel).toBe('IN_STOCK');
            await shopClient.asAnonymousUser();
            const { addItemToOrder } = await shopClient.query(ADD_ITEM, { productVariantId: 'T_4', quantity: 5 });
            expect((addItemToOrder as any).lines?.[0]?.quantity).toBe(5);
        });

        it('split order: tracked units allocated at location 1, the rest from the untracked location', async () => {
            const orderId = await placeOrder('T_4', 5);
            const variant = await getStock('T_4');
            expect(levelAt(variant, defaultLocationId)!.stockAllocated).toBe(2);
            expect(levelAt(variant, secondLocationId)!.stockAllocated).toBe(0);

            await cancelOrder(orderId);
            const afterCancel = await getStock('T_4');
            expect(levelAt(afterCancel, defaultLocationId)!.stockAllocated).toBe(0);
            expect(levelAt(afterCancel, secondLocationId)!.stockAllocated).toBe(0);
        });

        it('split order fulfilled: only the tracked location loses stockOnHand, Sale rows sum to the line quantity', async () => {
            const orderId = await placeOrder('T_4', 5);
            await fulfillOrder(orderId);
            const variant = await getStock('T_4');
            expect(levelAt(variant, defaultLocationId)).toMatchObject({ stockOnHand: 0, stockAllocated: 0 });
            expect(levelAt(variant, secondLocationId)).toMatchObject({ stockOnHand: 0, stockAllocated: 0 });

            const { productVariant } = await adminClient.query(GET_SALES, { id: 'T_4' });
            const saleTotal = productVariant!.stockMovements.items
                .filter(m => m.type === 'SALE')
                .reduce((sum, m) => sum + m.quantity, 0);
            // On master each per-location Sale records the whole line quantity, so this is -10.
            expect(saleTotal).toBe(-5);
        });
    });
});
