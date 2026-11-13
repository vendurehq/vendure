/* eslint-disable @typescript-eslint/no-non-null-assertion */
/**
 * #2908: granular `trackInventory` controls, run with the MultiChannelStockLocationStrategy.
 * The DefaultStockLocationStrategy is covered by stock-control-granular-tracking-default.e2e-spec.ts.
 *
 * Covers:
 * - stock correctness when the effective `trackInventory` changes while an Order is open
 *   (releases, sales and cancellations follow the state recorded at allocation)
 * - `Channel.trackInventory` as the default for INHERIT, judged in the Order's own Channel
 * - per-StockLevel overrides and Orders split across tracked and untracked locations
 * - fulfilments, shortfalls and stock movements recorded before v4.0
 */
import {
    CurrencyCode,
    EventBus,
    LanguageCode,
    manualFulfillmentHandler,
    mergeConfig,
    MultiChannelStockLocationStrategy,
    StockLevelService,
    StockShortfallEvent,
    TransactionalConnection,
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

const GET_RESOLVED_TRACKING = graphqlAdmin(`
    query GranularResolvedTracking($id: ID!) {
        productVariant(id: $id) {
            id
            tracksInventory
            stockLevels {
                stockLocationId
                tracksInventory
            }
        }
    }
`);

const GET_SALES = graphqlAdmin(`
    query GranularGetSales($id: ID!) {
        productVariant(id: $id) {
            stockMovements(options: { take: 100 }) {
                items {
                    ... on StockMovement {
                        type
                        quantity
                    }
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

const ASSIGN_SHIPPING_METHODS = graphqlAdmin(`
    mutation GranularAssignShipping($input: AssignShippingMethodsToChannelInput!) {
        assignShippingMethodsToChannel(input: $input) {
            id
        }
    }
`);

const ADD_MANUAL_PAYMENT = graphqlAdmin(`
    mutation GranularManualPayment($input: ManualPaymentInput!) {
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

const TRANSITION_FULFILLMENT = graphqlAdmin(`
    mutation GranularTransitionFulfillment($id: ID!, $state: String!) {
        transitionFulfillmentToState(id: $id, state: $state) {
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

const UPDATE_CHANNEL = graphqlAdmin(`
    mutation GranularUpdateChannel($input: UpdateChannelInput!) {
        updateChannel(input: $input) {
            ... on Channel {
                id
                trackInventory
            }
        }
    }
`);

const DUPLICATE_PRODUCT = graphqlAdmin(`
    mutation GranularDuplicate($input: DuplicateEntityInput!) {
        duplicateEntity(input: $input) {
            ... on DuplicateEntitySuccess {
                newEntityId
            }
            ... on ErrorResult {
                message
            }
        }
    }
`);

const GET_PRODUCT_STOCK_FLAGS = graphqlAdmin(`
    query GranularProductStockFlags($id: ID!) {
        product(id: $id) {
            variants {
                id
                name
                stockLevels {
                    stockLocationId
                    trackInventory
                }
            }
        }
    }
`);

describe('Stock control: granular trackInventory', () => {
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
        // The default Channel has trackInventory: true, which is the default for INHERIT.
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
        await startOrder(variantId, quantity);
        return payOrder();
    }

    /** Takes a guest Order up to ArrangingPayment, in the shop client's current Channel. */
    async function startOrder(variantId: string, quantity: number) {
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
                emailAddress: `granular-${orderCounter}@test.com`,
                firstName: 'Granular',
                lastName: `Tester${orderCounter}`,
            },
        });
        await shopClient.query(SET_ADDRESS, { input: { streetLine1: '1 Test St', countryCode: 'GB' } });
        const { eligibleShippingMethods } = await shopClient.query(ELIGIBLE_SHIPPING);
        await shopClient.query(SET_SHIPPING, { id: [eligibleShippingMethods[0].id] });
        const { transitionOrderToState } = await shopClient.query(TRANSITION, { state: 'ArrangingPayment' });
        if (!('state' in transitionOrderToState!) || transitionOrderToState.state !== 'ArrangingPayment') {
            throw new Error(`transition failed: ${JSON.stringify(transitionOrderToState)}`);
        }
        return addItemToOrder.id;
    }

    async function payOrder() {
        const { addPaymentToOrder } = await shopClient.query(ADD_PAYMENT, {
            input: { method: testSuccessfulPaymentMethod.code, metadata: {} },
        });
        if (!('state' in addPaymentToOrder) || addPaymentToOrder.state !== 'PaymentSettled') {
            throw new Error(`addPaymentToOrder failed: ${JSON.stringify(addPaymentToOrder)}`);
        }
        return addPaymentToOrder.id;
    }

    async function waitFor(condition: () => boolean, timeoutMs = 5000) {
        const start = Date.now();
        while (!condition()) {
            if (Date.now() - start > timeoutMs) {
                throw new Error('Timed out waiting for condition');
            }
            await new Promise(resolve => setTimeout(resolve, 20));
        }
    }

    async function cancelOrder(orderId: string) {
        const { cancelOrder: result } = await adminClient.query(CANCEL_ORDER, { input: { orderId } });
        expect((result as any).state).toBe('Cancelled');
    }

    async function fulfillOrder(orderId: string, quantity?: number) {
        const { order } = await adminClient.query(GET_ORDER, { id: orderId });
        const { addFulfillmentToOrder } = await adminClient.query(CREATE_FULFILLMENT, {
            input: {
                lines: order!.lines.map(l => ({ orderLineId: l.id, quantity: quantity ?? l.quantity })),
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
        return (addFulfillmentToOrder as any).id as string;
    }

    describe('flag changes while an order is open', () => {
        // #2908 — tracked at allocation, untracked at release: stockAllocated returns to its start value
        it('tracked at allocation, untracked at release: stockAllocated returns to its start value', async () => {
            await setVariantTracking('T_1', 'TRUE');
            const before = levelAt(await getStock('T_1'), defaultLocationId)!;
            const orderId = await placeOrder('T_1', 3);
            expect(levelAt(await getStock('T_1'), defaultLocationId)!.stockAllocated).toBe(
                before.stockAllocated + 3,
            );

            await setVariantTracking('T_1', 'FALSE');
            await cancelOrder(orderId);

            // Re-reading the current (untracked) setting would skip the decrement,
            // so 3 units stay allocated forever.
            expect(levelAt(await getStock('T_1'), defaultLocationId)!.stockAllocated).toBe(
                before.stockAllocated,
            );
        });

        // #2908 — untracked at allocation, tracked at release: another order's allocation is not released
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

            // Re-reading the current (tracked) setting would decrement 2 units never allocated,
            // half of the bystander's allocation (the clamp at zero hides it when nothing else
            // is allocated).
            expect(levelAt(await getStock('T_2'), defaultLocationId)!.stockAllocated).toBe(
                before.stockAllocated + 4,
            );
        });

        // #2908 — tracked at allocation, untracked at fulfillment: the sale still consumes the allocated stock
        it('tracked at allocation, untracked at fulfillment: the sale still consumes the allocated stock', async () => {
            await setVariantTracking('T_1', 'TRUE');
            const before = levelAt(await getStock('T_1'), defaultLocationId)!;
            const orderId = await placeOrder('T_1', 2);

            await setVariantTracking('T_1', 'FALSE');
            await fulfillOrder(orderId);

            const after = levelAt(await getStock('T_1'), defaultLocationId)!;
            // Re-reading the current setting would leave both figures unchanged.
            expect(after.stockAllocated).toBe(before.stockAllocated);
            expect(after.stockOnHand).toBe(before.stockOnHand - 2);
            await setVariantTracking('T_1', 'TRUE');
        });
    });

    describe('Channel.trackInventory as the default for INHERIT', () => {
        let channelBLocationId: string;
        let channelBId: string;

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
            channelBId = (createChannel as any).id;
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

        // #2908 — Every Order also belongs to the default Channel, so an Administrator there
        // can add the payment that triggers allocation. Tracking must follow the Order's Channel.
        it("an admin in the default channel paying a channel B order allocates by channel B's rules", async () => {
            await adminClient.query(ASSIGN_SHIPPING_METHODS, {
                input: { channelId: channelBId, shippingMethodIds: ['T_1'] },
            });
            const before = levelAt(await getStock('T_3'), defaultLocationId)!;
            shopClient.setChannelToken(CHANNEL_B_TOKEN);
            const orderId = await startOrder('T_3', 3);
            shopClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);

            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const { addManualPaymentToOrder } = await adminClient.query(ADD_MANUAL_PAYMENT, {
                input: { orderId, method: 'manual', transactionId: 'X1', metadata: {} },
            });
            expect((addManualPaymentToOrder as any).state).toBe('PaymentSettled');

            // Resolved against the default Channel (tracked, and its locations include the
            // default warehouse), this would have allocated 3 tracked units there.
            expect(levelAt(await getStock('T_3'), defaultLocationId)!.stockAllocated).toBe(
                before.stockAllocated,
            );
        });

        // #2908 — the stock lock is taken in the Order's Channel. With the default Channel
        // untracked and channel B tracked, locking in the acting admin's Channel would skip the
        // variant and leave the saleable check and the allocation unprotected.
        it("locks a variant tracked in the order's channel when an admin in another channel pays", async () => {
            await adminClient.query(UPDATE_CHANNEL, { input: { id: 'T_1', trackInventory: false } });
            await adminClient.query(UPDATE_CHANNEL, { input: { id: channelBId, trackInventory: true } });
            // Only the up-front batch lock (lockStockLevelsForVariants) is counted: it is the one
            // that must cover the variant before the saleable stock check runs.
            const stockLevelService = server.app.get(StockLevelService);
            const original = stockLevelService.getLockedStockLevelsForVariant.bind(stockLevelService);
            const originalBatch = stockLevelService.lockStockLevelsForVariants.bind(stockLevelService);
            const lockedVariantIds: string[] = [];
            let inBatchLock = false;
            try {
                await adminClient.query(UPDATE_VARIANT, {
                    input: [
                        {
                            id: 'T_3',
                            stockLevels: [{ stockLocationId: channelBLocationId, stockOnHand: 10 }] as any,
                        },
                    ],
                });
                shopClient.setChannelToken(CHANNEL_B_TOKEN);
                const orderId = await startOrder('T_3', 1);
                shopClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);

                stockLevelService.lockStockLevelsForVariants = async (ctx, ids, options) => {
                    inBatchLock = true;
                    try {
                        return await originalBatch(ctx, ids, options);
                    } finally {
                        inBatchLock = false;
                    }
                };
                stockLevelService.getLockedStockLevelsForVariant = (ctx, id) => {
                    if (inBatchLock) {
                        lockedVariantIds.push(String(id));
                    }
                    return original(ctx, id);
                };
                const { addManualPaymentToOrder } = await adminClient.query(ADD_MANUAL_PAYMENT, {
                    input: { orderId, method: 'manual', transactionId: 'X2', metadata: {} },
                });
                expect((addManualPaymentToOrder as any).state).toBe('PaymentSettled');
                expect(lockedVariantIds).toContain('3');
                expect(levelAt(await getStock('T_3'), channelBLocationId)!.stockAllocated).toBe(1);
            } finally {
                stockLevelService.getLockedStockLevelsForVariant = original;
                stockLevelService.lockStockLevelsForVariants = originalBatch;
                await adminClient.query(UPDATE_CHANNEL, { input: { id: 'T_1', trackInventory: true } });
                await adminClient.query(UPDATE_CHANNEL, { input: { id: channelBId, trackInventory: false } });
            }
        });

        // #2908 — default channel (trackInventory: true) treats T_3 as tracked
        it('default channel (trackInventory: true) treats T_3 as tracked', async () => {
            shopClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            await shopClient.asAnonymousUser();
            const { addItemToOrder } = await shopClient.query(ADD_ITEM, {
                productVariantId: 'T_3',
                quantity: 500,
            });
            expect((addItemToOrder as any).errorCode).toBe('INSUFFICIENT_STOCK_ERROR');
        });

        // #2908 — channel B (trackInventory: false) treats T_3 as untracked, though it has no stock there
        it('channel B (trackInventory: false) treats T_3 as untracked, though it has no stock there', async () => {
            shopClient.setChannelToken(CHANNEL_B_TOKEN);
            await shopClient.asAnonymousUser();
            const { addItemToOrder } = await shopClient.query(ADD_ITEM, {
                productVariantId: 'T_3',
                quantity: 500,
            });
            // Before v4.0 Channel.trackInventory was ignored: an InsufficientStockError.
            expect((addItemToOrder as any).lines?.[0]?.quantity).toBe(500);
        });
    });

    describe('per-StockLevel override', () => {
        // #2908 — sets trackInventory: FALSE on the StockLevel at the second location
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
                    {
                        stockLocationId: defaultLocationId,
                        stockOnHand: 2,
                        stockAllocated: 0,
                        trackInventory: 'INHERIT',
                    },
                    {
                        stockLocationId: secondLocationId,
                        stockOnHand: 0,
                        stockAllocated: 0,
                        trackInventory: 'FALSE',
                    },
                ]),
            );
        });

        // #2908 — the Admin API exposes the resolved tracking, so clients need not re-implement it
        it('resolves tracksInventory for the variant and each StockLevel', async () => {
            const { productVariant } = await adminClient.query(GET_RESOLVED_TRACKING, { id: 'T_4' });
            // An untracked StockLevel means stock limits do not apply to the variant.
            expect(productVariant!.tracksInventory).toBe(false);
            expect(productVariant!.stockLevels).toEqual(
                expect.arrayContaining([
                    { stockLocationId: defaultLocationId, tracksInventory: true },
                    { stockLocationId: secondLocationId, tracksInventory: false },
                ]),
            );
        });

        // #2908 — an untracked location makes the variant saleable beyond the tracked stock
        it('an untracked location makes the variant saleable beyond the tracked stock', async () => {
            const { product } = await shopClient.query(SHOP_PRODUCT_STOCK, { id: 'T_1' });
            expect(product!.variants.find(v => v.id === 'T_4')!.stockLevel).toBe('IN_STOCK');
            await shopClient.asAnonymousUser();
            const { addItemToOrder } = await shopClient.query(ADD_ITEM, {
                productVariantId: 'T_4',
                quantity: 5,
            });
            expect((addItemToOrder as any).lines?.[0]?.quantity).toBe(5);
        });

        // #2908 — split order: tracked units allocated at location 1, the rest from the untracked location
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

        // #2908 — split order fulfilled: only the tracked location loses stockOnHand, Sale rows sum to the line quantity
        it('split order fulfilled: only the tracked location loses stockOnHand, Sale rows sum to the line quantity', async () => {
            const orderId = await placeOrder('T_4', 5);
            await fulfillOrder(orderId);
            const variant = await getStock('T_4');
            expect(levelAt(variant, defaultLocationId)).toMatchObject({ stockOnHand: 0, stockAllocated: 0 });
            expect(levelAt(variant, secondLocationId)).toMatchObject({ stockOnHand: 0, stockAllocated: 0 });

            const { productVariant } = await adminClient.query(GET_SALES, { id: 'T_4' });
            const saleTotal = productVariant!.stockMovements.items
                .filter((m: any) => m.type === 'SALE')
                .reduce((sum: number, m: any) => sum + m.quantity, 0);
            // Recording the whole line quantity at each location would give -10.
            expect(saleTotal).toBe(-5);
        });

        // #2908 — the tracking setting can be changed without sending stockOnHand, so a stale
        // value cannot overwrite concurrent stock changes
        it('changes StockLevel.trackInventory without touching stockOnHand', async () => {
            const adjustments = async () => {
                const { productVariant: withMovements } = await adminClient.query(GET_SALES, { id: 'T_4' });
                return withMovements!.stockMovements.items.filter((m: any) => m.type === 'ADJUSTMENT').length;
            };
            const before = await adjustments();
            const levelBefore = levelAt(await getStock('T_4'), secondLocationId)!;
            await adminClient.query(UPDATE_VARIANT, {
                input: [
                    {
                        id: 'T_4',
                        stockLevels: [{ stockLocationId: secondLocationId, trackInventory: 'TRUE' }] as any,
                    },
                ],
            });
            const { productVariant } = await adminClient.query(GET_STOCK_WITH_FLAGS, { id: 'T_4' });
            expect(productVariant!.stockLevels.find(l => l.stockLocationId === secondLocationId)).toEqual({
                ...levelBefore,
                trackInventory: 'TRUE',
            });
            expect(await adjustments()).toBe(before);
            await adminClient.query(UPDATE_VARIANT, {
                input: [
                    {
                        id: 'T_4',
                        stockLevels: [{ stockLocationId: secondLocationId, trackInventory: 'FALSE' }] as any,
                    },
                ],
            });
        });

        // #2908 — duplicating a product keeps its per-location tracking settings
        it('keeps StockLevel overrides when a product is duplicated', async () => {
            const { duplicateEntity } = await adminClient.query(DUPLICATE_PRODUCT, {
                input: {
                    entityName: 'Product',
                    entityId: 'T_1',
                    duplicatorInput: {
                        code: 'product-duplicator',
                        arguments: [{ name: 'includeVariants', value: 'true' }],
                    },
                },
            });
            const newProductId = (duplicateEntity as any).newEntityId;
            expect(newProductId).toBeDefined();
            const { product: original } = await adminClient.query(GET_PRODUCT_STOCK_FLAGS, { id: 'T_1' });
            const { product: copy } = await adminClient.query(GET_PRODUCT_STOCK_FLAGS, { id: newProductId });
            const originalT4 = original!.variants.find(v => v.id === 'T_4')!;
            const copiedT4 = copy!.variants.find(v => v.name === originalT4.name)!;
            expect(
                copiedT4.stockLevels.find(l => l.stockLocationId === secondLocationId)?.trackInventory,
            ).toBe('FALSE');
        });
    });

    describe('fulfilments, shortfalls and pre-v4.0 movements', () => {
        // #2908 — A StockLevel set to TRUE on an untracked variant caps the allocation, so a
        // shortfall must be reported even though the variant itself is untracked.
        it('reports a shortfall for a tracked StockLevel of an untracked variant', async () => {
            await adminClient.query(UPDATE_VARIANT, {
                input: [
                    {
                        id: 'T_5',
                        trackInventory: 'FALSE' as any,
                        stockLevels: [
                            { stockLocationId: defaultLocationId, stockOnHand: 2, trackInventory: 'TRUE' },
                        ] as any,
                    },
                ],
            });
            await startOrder('T_5', 2);
            // Another channel sells a unit between the stock check and the payment.
            await adminClient.query(UPDATE_VARIANT, {
                input: [
                    {
                        id: 'T_5',
                        stockLevels: [{ stockLocationId: defaultLocationId, stockOnHand: 1 }] as any,
                    },
                ],
            });
            const events: StockShortfallEvent[] = [];
            const subscription = server.app
                .get(EventBus)
                .ofType(StockShortfallEvent)
                .subscribe(e => events.push(e));
            try {
                await payOrder();
                // Events are published after the transaction commits.
                await waitFor(() => events.length > 0);
                expect(levelAt(await getStock('T_5'), defaultLocationId)!.stockAllocated).toBe(1);
                expect(events.length).toBe(1);
                expect(events[0].shortfalls).toEqual([
                    expect.objectContaining({ requested: 2, allocated: 1 }),
                ]);
            } finally {
                subscription.unsubscribe();
            }
        });

        // #2908 — The second partial fulfilment must sell from the location which still has
        // allocated units, not from the first location again.
        it('a second partial fulfilment of a split line sells from the location still holding allocations', async () => {
            await adminClient.query(UPDATE_VARIANT, {
                input: [
                    {
                        id: 'T_6',
                        trackInventory: 'TRUE' as any,
                        stockLevels: [
                            { stockLocationId: defaultLocationId, stockOnHand: 2 },
                            { stockLocationId: secondLocationId, stockOnHand: 3 },
                        ] as any,
                    },
                ],
            });
            const orderId = await placeOrder('T_6', 5);
            let variant = await getStock('T_6');
            expect(levelAt(variant, defaultLocationId)).toMatchObject({ stockOnHand: 2, stockAllocated: 2 });
            expect(levelAt(variant, secondLocationId)).toMatchObject({ stockOnHand: 3, stockAllocated: 3 });

            await fulfillOrder(orderId, 2);
            await fulfillOrder(orderId, 3);

            variant = await getStock('T_6');
            expect(levelAt(variant, defaultLocationId)).toMatchObject({ stockOnHand: 0, stockAllocated: 0 });
            // Picking from Allocations only would have sold 2 more from the first location (a
            // no-op, nothing left there) and 1 from the second, leaving 2 allocated forever.
            expect(levelAt(variant, secondLocationId)).toMatchObject({ stockOnHand: 0, stockAllocated: 0 });
        });

        // #2908 — Cancelling a fulfilment puts back exactly what the Sale took, with the
        // tracked state of that Sale, even after trackInventory has changed.
        it('cancelling a fulfilment after a flag flip restores stock exactly, and re-fulfilment deducts it again', async () => {
            await adminClient.query(UPDATE_VARIANT, {
                input: [
                    {
                        id: 'T_7',
                        trackInventory: 'TRUE' as any,
                        stockLevels: [{ stockLocationId: defaultLocationId, stockOnHand: 10 }] as any,
                    },
                ],
            });
            const orderId = await placeOrder('T_7', 2);
            const fulfillmentId = await fulfillOrder(orderId);
            expect(levelAt(await getStock('T_7'), defaultLocationId)).toMatchObject({
                stockOnHand: 8,
                stockAllocated: 0,
            });

            await setVariantTracking('T_7', 'FALSE');
            const { transitionFulfillmentToState } = await adminClient.query(TRANSITION_FULFILLMENT, {
                id: fulfillmentId,
                state: 'Cancelled',
            });
            expect((transitionFulfillmentToState as any).state).toBe('Cancelled');
            expect(levelAt(await getStock('T_7'), defaultLocationId)).toMatchObject({
                stockOnHand: 10,
                stockAllocated: 2,
            });

            await fulfillOrder(orderId);
            // Re-allocating at the current (untracked) flag would leave stockOnHand at 10.
            expect(levelAt(await getStock('T_7'), defaultLocationId)).toMatchObject({
                stockOnHand: 8,
                stockAllocated: 0,
            });
        });

        // #2908 — before v4.0, each per-location Sale of a split line recorded the whole line
        // quantity. Cancelling such an Order must still put each location's units back there.
        it('cancels a split sale recorded before v4.0 back to the right locations', async () => {
            await adminClient.query(UPDATE_VARIANT, {
                input: [
                    {
                        id: 'T_6',
                        stockLevels: [
                            { stockLocationId: defaultLocationId, stockOnHand: 2 },
                            { stockLocationId: secondLocationId, stockOnHand: 3 },
                        ] as any,
                    },
                ],
            });
            const orderId = await placeOrder('T_6', 5);
            await fulfillOrder(orderId);
            const { order } = await adminClient.query(GET_ORDER, { id: orderId });
            const orderLineId = order!.lines[0].id.replace('T_', '');
            const raw = server.app.get(TransactionalConnection).rawConnection;
            const esc = (name: string) => raw.driver.escape(name);
            // Rewrite this line's Sales the way the pre-v4.0 code recorded them.
            await raw.query(
                `UPDATE ${esc('stock_movement')} SET ${esc('quantity')} = -5, ${esc('tracked')} = NULL
                 WHERE ${esc('orderLineId')} = ${orderLineId} AND ${esc('type')} = 'SALE'`,
            );

            await cancelOrder(orderId);

            const variant = await getStock('T_6');
            expect(levelAt(variant, defaultLocationId)).toMatchObject({ stockOnHand: 2, stockAllocated: 0 });
            expect(levelAt(variant, secondLocationId)).toMatchObject({ stockOnHand: 3, stockAllocated: 0 });
        });
    });
});
