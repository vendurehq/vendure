/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { PaymentInput } from '@vendure/common/lib/generated-shop-types';
import {
    type CreateAddressInput,
    ErrorCode,
    GlobalFlag,
    LanguageCode,
    StockMovementType,
} from '@vendure/common/lib/generated-types';
import { pick } from '@vendure/common/lib/pick';
import {
    DefaultOrderPlacedStrategy,
    EventBus,
    manualFulfillmentHandler,
    mergeConfig,
    type Order,
    type OrderState,
    PaymentMethodHandler,
    type RequestContext,
    RequestContextService,
    StockMovementService,
    StockShortfallEvent,
    TransactionalConnection,
} from '@vendure/core';
import {
    createErrorResultGuard,
    createTestEnvironment,
    type ErrorResultGuard,
    SimpleGraphQLClient,
} from '@vendure/testing';
import path from 'path';
import { firstValueFrom, timeout } from 'rxjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { testSuccessfulPaymentMethod, twoStagePaymentMethod } from './fixtures/test-payment-methods';
import { fulfillmentFragment, variantWithStockFragment } from './graphql/fragments-admin';
import { FragmentOf, graphql } from './graphql/graphql-admin';
import { graphql as graphqlShop } from './graphql/graphql-shop';
import {
    cancelOrderDocument,
    createFulfillmentDocument,
    getOrderDocument,
    getStockMovementByTypeDocument,
    getStockMovementDocument,
    settlePaymentDocument,
    updateGlobalSettingsDocument,
    updateProductVariantsDocument,
} from './graphql/shared-definitions';
import {
    addItemToOrderDocument,
    addPaymentDocument,
    adjustItemQuantityDocument,
    getActiveOrderDocument,
    getEligibleShippingMethodsDocument,
    getProductWithStockLevelDocument,
    removeAllOrderLinesDocument,
    setShippingAddressDocument,
    setShippingMethodDocument,
    testOrderFragment,
    testOrderWithPaymentsFragment,
    transitionToStateDocument,
    updatedOrderFragment,
} from './graphql/shop-definitions';
import { assertThrowsWithMessage } from './utils/assert-throws-with-message';
import { addPaymentToOrder, proceedToArrangingPayment } from './utils/test-order-utils';

type VariantWithStockFragment = FragmentOf<typeof variantWithStockFragment>;
type FulfillmentFragment = FragmentOf<typeof fulfillmentFragment>;
type UpdatedOrderFragment = FragmentOf<typeof updatedOrderFragment>;
type TestOrderFragment = FragmentOf<typeof testOrderFragment>;
type TestOrderWithPaymentsFragment = FragmentOf<typeof testOrderWithPaymentsFragment>;

class TestOrderPlacedStrategy extends DefaultOrderPlacedStrategy {
    shouldSetAsPlaced(
        ctx: RequestContext,
        fromState: OrderState,
        toState: OrderState,
        order: Order,
    ): boolean {
        if ((order.customFields as any).test1557) {
            // This branch is used in testing https://github.com/vendurehq/vendure/issues/1557
            // i.e. it will cause the Order to be set to `active: false` but without creating any
            // Allocations for the OrderLines.
            if (fromState === 'AddingItems' && toState === 'ArrangingPayment') {
                return true;
            }
            return false;
        }
        return super.shouldSetAsPlaced(ctx, fromState, toState, order);
    }
}

/**
 * Settles immediately, but holds the settlement transaction open briefly. When several
 * orders settle concurrently, this ensures they have all started their settlement
 * transactions (and taken their DB snapshots) before the first one commits, which is
 * the timing needed to exercise the allocation re-check under concurrency.
 */
const delayedSettlePaymentMethod = new PaymentMethodHandler({
    code: 'delayed-settle-payment-method',
    description: [{ languageCode: LanguageCode.en, value: 'Delayed settle payment method' }],
    args: {},
    createPayment: async (ctx, order, amount) => {
        await new Promise(resolve => setTimeout(resolve, 250));
        return {
            amount,
            state: 'Settled' as const,
            transactionId: 'delayed-12345',
        };
    },
    settlePayment: () => ({
        success: true,
    }),
});

describe('Stock control', () => {
    const testEnvConfig = mergeConfig(testConfig(), {
        paymentOptions: {
            paymentMethodHandlers: [
                testSuccessfulPaymentMethod,
                twoStagePaymentMethod,
                delayedSettlePaymentMethod,
            ],
        },
        orderOptions: {
            orderPlacedStrategy: new TestOrderPlacedStrategy(),
        },
        customFields: {
            Order: [
                {
                    name: 'test1557',
                    type: 'boolean',
                    defaultValue: false,
                },
            ],
            OrderLine: [{ name: 'customization', type: 'string', nullable: true }],
        },
    });
    const { server, adminClient, shopClient } = createTestEnvironment(testEnvConfig);

    const orderGuard: ErrorResultGuard<
        UpdatedOrderFragment | TestOrderFragment | TestOrderWithPaymentsFragment
    > = createErrorResultGuard(input => !!input.lines);

    const fulfillmentGuard: ErrorResultGuard<FulfillmentFragment> = createErrorResultGuard(
        input => !!input.state,
    );

    async function getProductWithStockMovement(productId: string) {
        const { product } = await adminClient.query(getStockMovementDocument, {
            id: productId,
        });
        return product;
    }

    async function getProductWithStockMovementByType(productId: string, type: StockMovementType) {
        const { product } = await adminClient.query(getStockMovementByTypeDocument, { id: productId, type });
        return product;
    }

    async function setFirstEligibleShippingMethod() {
        const { eligibleShippingMethods } = await shopClient.query(getEligibleShippingMethodsDocument);
        await shopClient.query(setShippingMethodDocument, {
            id: [eligibleShippingMethods[0].id],
        });
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
                    {
                        name: twoStagePaymentMethod.code,
                        handler: { code: twoStagePaymentMethod.code, arguments: [] },
                    },
                    {
                        name: delayedSettlePaymentMethod.code,
                        handler: { code: delayedSettlePaymentMethod.code, arguments: [] },
                    },
                ],
            },
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-stock-control.csv'),
            customerCount: 3,
        });
        await adminClient.asSuperAdmin();

        await adminClient.query(updateGlobalSettingsDocument, {
            input: {
                trackInventory: false,
            },
        });
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    describe('stock adjustments', () => {
        let variants: VariantWithStockFragment[];

        it('stockMovements are initially empty', async () => {
            const { product } = await adminClient.query(getStockMovementDocument, {
                id: 'T_1',
            });

            variants = product!.variants;
            for (const variant of variants) {
                expect(variant.stockMovements.items).toEqual([]);
                expect(variant.stockMovements.totalItems).toEqual(0);
            }
        });

        it('updating ProductVariant with same stockOnHand does not create a StockMovement', async () => {
            const { updateProductVariants } = await adminClient.query(updateStockOnHandDocument, {
                input: [
                    {
                        id: variants[0].id,
                        stockOnHand: variants[0].stockOnHand,
                    },
                ],
            });

            expect(updateProductVariants[0]!.stockMovements.items).toEqual([]);
            expect(updateProductVariants[0]!.stockMovements.totalItems).toEqual(0);
        });

        it('increasing stockOnHand creates a StockMovement with correct quantity', async () => {
            const { updateProductVariants } = await adminClient.query(updateStockOnHandDocument, {
                input: [
                    {
                        id: variants[0].id,
                        stockOnHand: variants[0].stockOnHand + 5,
                    },
                ],
            });

            expect(updateProductVariants[0]!.stockOnHand).toBe(5);
            expect(updateProductVariants[0]!.stockMovements.totalItems).toEqual(1);
            expect(updateProductVariants[0]!.stockMovements.items[0].type).toBe(StockMovementType.ADJUSTMENT);
            expect(updateProductVariants[0]!.stockMovements.items[0].quantity).toBe(5);
        });

        it('decreasing stockOnHand creates a StockMovement with correct quantity', async () => {
            const { updateProductVariants } = await adminClient.query(updateStockOnHandDocument, {
                input: [
                    {
                        id: variants[0].id,
                        stockOnHand: variants[0].stockOnHand + 5 - 2,
                    },
                ],
            });

            expect(updateProductVariants[0]!.stockOnHand).toBe(3);
            expect(updateProductVariants[0]!.stockMovements.totalItems).toEqual(2);
            expect(updateProductVariants[0]!.stockMovements.items[1].type).toBe(StockMovementType.ADJUSTMENT);
            expect(updateProductVariants[0]!.stockMovements.items[1].quantity).toBe(-2);
        });

        it(
            'attempting to set stockOnHand below saleable stock level throws',
            assertThrowsWithMessage(async () => {
                const result = await adminClient.query(updateStockOnHandDocument, {
                    input: [
                        {
                            id: variants[0].id,
                            stockOnHand: -1,
                        },
                    ],
                });
            }, 'stockOnHand cannot be a negative value'),
        );
    });

    describe('sales', () => {
        let orderId: string;

        beforeAll(async () => {
            const product = await getProductWithStockMovement('T_2');
            const [variant1, variant2, variant3] = product!.variants;

            await adminClient.query(updateStockOnHandDocument, {
                input: [
                    {
                        id: variant1.id,
                        stockOnHand: 5,
                        trackInventory: GlobalFlag.FALSE,
                    },
                    {
                        id: variant2.id,
                        stockOnHand: 5,
                        trackInventory: GlobalFlag.TRUE,
                    },
                    {
                        id: variant3.id,
                        stockOnHand: 5,
                        trackInventory: GlobalFlag.INHERIT,
                    },
                ],
            });

            // Add items to order and check out
            await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
            await shopClient.query(addItemToOrderDocument, {
                productVariantId: variant1.id,
                quantity: 2,
            });
            await shopClient.query(addItemToOrderDocument, {
                productVariantId: variant2.id,
                quantity: 3,
            });
            await shopClient.query(addItemToOrderDocument, {
                productVariantId: variant3.id,
                quantity: 4,
            });
            await shopClient.query(setShippingAddressDocument, {
                input: {
                    streetLine1: '1 Test Street',
                    countryCode: 'GB',
                } as CreateAddressInput,
            });
            await setFirstEligibleShippingMethod();
            await shopClient.query(transitionToStateDocument, {
                state: 'ArrangingPayment' as OrderState,
            });
        });

        it('creates an Allocation when order completed', async () => {
            const { addPaymentToOrder: order } = await shopClient.query(addPaymentDocument, {
                input: {
                    method: testSuccessfulPaymentMethod.code,
                    metadata: {},
                } as PaymentInput,
            });
            orderGuard.assertSuccess(order);
            expect(order).not.toBeNull();
            orderId = order.id;

            const product = await getProductWithStockMovement('T_2');
            const [variant1, variant2, variant3] = product!.variants;

            expect(variant1.stockMovements.totalItems).toBe(2);
            expect(variant1.stockMovements.items[1].type).toBe(StockMovementType.ALLOCATION);
            expect(variant1.stockMovements.items[1].quantity).toBe(2);

            expect(variant2.stockMovements.totalItems).toBe(2);
            expect(variant2.stockMovements.items[1].type).toBe(StockMovementType.ALLOCATION);
            expect(variant2.stockMovements.items[1].quantity).toBe(3);

            expect(variant3.stockMovements.totalItems).toBe(2);
            expect(variant3.stockMovements.items[1].type).toBe(StockMovementType.ALLOCATION);
            expect(variant3.stockMovements.items[1].quantity).toBe(4);
        });

        it('returns all stockMovements filtered by type', async () => {
            const product = await getProductWithStockMovementByType('T_2', StockMovementType.ALLOCATION);
            const [variant1, variant2, variant3] = product!.variants;

            expect(variant1.stockMovements.totalItems).toBe(1);
            expect(variant1.stockMovements.items[0].type).toBe(StockMovementType.ALLOCATION);
            expect(variant1.stockMovements.items[0].quantity).toBe(2);

            expect(variant2.stockMovements.totalItems).toBe(1);
            expect(variant2.stockMovements.items[0].type).toBe(StockMovementType.ALLOCATION);
            expect(variant2.stockMovements.items[0].quantity).toBe(3);

            expect(variant3.stockMovements.totalItems).toBe(1);
            expect(variant3.stockMovements.items[0].type).toBe(StockMovementType.ALLOCATION);
            expect(variant3.stockMovements.items[0].quantity).toBe(4);
        });

        it('stockAllocated is updated according to trackInventory setting', async () => {
            const product = await getProductWithStockMovement('T_2');
            const [variant1, variant2, variant3] = product!.variants;

            // stockOnHand not changed yet
            expect(variant1.stockOnHand).toBe(5);
            expect(variant2.stockOnHand).toBe(5);
            expect(variant3.stockOnHand).toBe(5);

            expect(variant1.stockAllocated).toBe(0); // untracked inventory
            expect(variant2.stockAllocated).toBe(3); // tracked inventory
            expect(variant3.stockAllocated).toBe(0); // inherited untracked inventory
        });

        it('creates a Release on cancelling an allocated order item and updates stockAllocated', async () => {
            const { order } = await adminClient.query(getOrderDocument, {
                id: orderId,
            });

            await adminClient.query(cancelOrderDocument, {
                input: {
                    orderId: order!.id,
                    lines: [
                        {
                            orderLineId: order!.lines.find(l => l.quantity === 3)!.id,
                            quantity: 1,
                        },
                    ],
                    reason: 'Not needed',
                },
            });

            const product = await getProductWithStockMovement('T_2');
            const [_, variant2, __] = product!.variants;

            expect(variant2.stockMovements.totalItems).toBe(3);
            expect(variant2.stockMovements.items[2].type).toBe(StockMovementType.RELEASE);
            expect(variant2.stockMovements.items[2].quantity).toBe(1);

            expect(variant2.stockAllocated).toBe(2);
        });

        it('creates a Sale on Fulfillment creation', async () => {
            const { order } = await adminClient.query(getOrderDocument, {
                id: orderId,
            });

            await adminClient.query(createFulfillmentDocument, {
                input: {
                    lines:
                        order?.lines.map(l => ({
                            orderLineId: l.id,
                            quantity: l.quantity,
                        })) ?? [],
                    handler: {
                        code: manualFulfillmentHandler.code,
                        arguments: [
                            { name: 'method', value: 'test method' },
                            { name: 'trackingCode', value: 'ABC123' },
                        ],
                    },
                },
            });

            const product = await getProductWithStockMovement('T_2');
            const [variant1, variant2, variant3] = product!.variants;
            expect(variant1.stockMovements.totalItems).toBe(3);
            expect(variant1.stockMovements.items[2].type).toBe(StockMovementType.SALE);
            expect(variant1.stockMovements.items[2].quantity).toBe(-2);

            // 4 rather than 3 since a Release was created in the previous test
            expect(variant2.stockMovements.totalItems).toBe(4);
            expect(variant2.stockMovements.items[3].type).toBe(StockMovementType.SALE);
            expect(variant2.stockMovements.items[3].quantity).toBe(-2);

            expect(variant3.stockMovements.totalItems).toBe(3);
            expect(variant3.stockMovements.items[2].type).toBe(StockMovementType.SALE);
            expect(variant3.stockMovements.items[2].quantity).toBe(-4);
        });

        it('updates stockOnHand and stockAllocated when Sales are created', async () => {
            const product = await getProductWithStockMovement('T_2');
            const [variant1, variant2, variant3] = product!.variants;

            expect(variant1.stockOnHand).toBe(5); // untracked inventory
            expect(variant2.stockOnHand).toBe(3); // tracked inventory
            expect(variant3.stockOnHand).toBe(5); // inherited untracked inventory

            expect(variant1.stockAllocated).toBe(0); // untracked inventory
            expect(variant2.stockAllocated).toBe(0); // tracked inventory
            expect(variant3.stockAllocated).toBe(0); // inherited untracked inventory
        });

        it('creates Cancellations when cancelling items which are part of a Fulfillment', async () => {
            const { order } = await adminClient.query(getOrderDocument, {
                id: orderId,
            });

            await adminClient.query(cancelOrderDocument, {
                input: {
                    orderId: order!.id,
                    lines: order!.lines.map(l => ({
                        orderLineId: l.id,
                        quantity: l.quantity,
                    })),
                    reason: 'Faulty',
                },
            });

            const product = await getProductWithStockMovement('T_2');
            const [variant1, variant2, variant3] = product!.variants;

            expect(variant1.stockMovements.totalItems).toBe(4);
            expect(variant1.stockMovements.items[3].type).toBe(StockMovementType.CANCELLATION);
            expect(variant1.stockMovements.items[3].quantity).toBe(2);

            expect(variant2.stockMovements.totalItems).toBe(5);
            expect(variant2.stockMovements.items[4].type).toBe(StockMovementType.CANCELLATION);
            expect(variant2.stockMovements.items[4].quantity).toBe(2);

            expect(variant3.stockMovements.totalItems).toBe(4);
            expect(variant3.stockMovements.items[3].type).toBe(StockMovementType.CANCELLATION);
            expect(variant3.stockMovements.items[3].quantity).toBe(4);
        });

        // https://github.com/vendurehq/vendure/issues/1198
        it('creates Cancellations & adjusts stock when cancelling a Fulfillment', async () => {
            async function getTrackedVariant() {
                const result = await getProductWithStockMovement('T_2');
                return result!.variants[1];
            }

            const trackedVariant1 = await getTrackedVariant();

            expect(trackedVariant1.stockOnHand).toBe(5);

            // Add items to order and check out
            await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
            await shopClient.query(addItemToOrderDocument, {
                productVariantId: trackedVariant1.id,
                quantity: 1,
            });
            await shopClient.query(setShippingAddressDocument, {
                input: {
                    streetLine1: '1 Test Street',
                    countryCode: 'GB',
                } as CreateAddressInput,
            });
            await setFirstEligibleShippingMethod();
            await shopClient.query(transitionToStateDocument, {
                state: 'ArrangingPayment' as OrderState,
            });
            const { addPaymentToOrder: order } = await shopClient.query(addPaymentDocument, {
                input: {
                    method: testSuccessfulPaymentMethod.code,
                    metadata: {},
                } as PaymentInput,
            });
            orderGuard.assertSuccess(order);
            expect(order).not.toBeNull();

            const trackedVariant2 = await getTrackedVariant();
            expect(trackedVariant2.stockOnHand).toBe(5);
            expect(trackedVariant2.stockAllocated).toBe(1);

            const linesInput =
                order?.lines
                    .filter(l => l.productVariant.id === trackedVariant2.id)
                    .map(l => ({ orderLineId: l.id, quantity: l.quantity })) ?? [];

            const { addFulfillmentToOrder } = await adminClient.query(createFulfillmentDocument, {
                input: {
                    lines: linesInput,
                    handler: {
                        code: manualFulfillmentHandler.code,
                        arguments: [
                            { name: 'method', value: 'test method' },
                            { name: 'trackingCode', value: 'ABC123' },
                        ],
                    },
                },
            });

            const trackedVariant3 = await getTrackedVariant();

            expect(trackedVariant3.stockOnHand).toBe(4);
            expect(trackedVariant3.stockAllocated).toBe(0);

            fulfillmentGuard.assertSuccess(addFulfillmentToOrder);
            const { transitionFulfillmentToState } = await adminClient.query(
                transitionFulfillmentToStateDocument,
                {
                    state: 'Cancelled',
                    id: addFulfillmentToOrder.id,
                },
            );

            const trackedVariant4 = await getTrackedVariant();

            expect(trackedVariant4.stockOnHand).toBe(5);
            expect(trackedVariant4.stockAllocated).toBe(1);
            expect(trackedVariant4.stockMovements.items.map(pick(['quantity', 'type']))).toEqual([
                { quantity: 5, type: 'ADJUSTMENT' },
                { quantity: 3, type: 'ALLOCATION' },
                { quantity: 1, type: 'RELEASE' },
                { quantity: -2, type: 'SALE' },
                { quantity: 2, type: 'CANCELLATION' },
                { quantity: 1, type: 'ALLOCATION' },
                { quantity: -1, type: 'SALE' },
                // This is the cancellation & allocation we are testing for
                { quantity: 1, type: 'CANCELLATION' },
                { quantity: 1, type: 'ALLOCATION' },
            ]);

            const { cancelOrder } = await adminClient.query(cancelOrderDocument, {
                input: {
                    orderId: order.id,
                    reason: 'Not needed',
                },
            });
            orderGuard.assertSuccess(cancelOrder);

            const trackedVariant5 = await getTrackedVariant();
            expect(trackedVariant5.stockOnHand).toBe(5);
            expect(trackedVariant5.stockAllocated).toBe(0);
        });
    });

    describe('saleable stock level', () => {
        let order: TestOrderWithPaymentsFragment;

        beforeAll(async () => {
            await adminClient.query(updateGlobalSettingsDocument, {
                input: {
                    trackInventory: true,
                    outOfStockThreshold: -5,
                },
            });

            await adminClient.query(updateProductVariantsDocument, {
                input: [
                    {
                        id: 'T_1',
                        stockOnHand: 3,
                        outOfStockThreshold: 0,
                        trackInventory: GlobalFlag.TRUE,
                        useGlobalOutOfStockThreshold: false,
                    },
                    {
                        id: 'T_2',
                        stockOnHand: 3,
                        outOfStockThreshold: 0,
                        trackInventory: GlobalFlag.FALSE,
                        useGlobalOutOfStockThreshold: false,
                    },
                    {
                        id: 'T_3',
                        stockOnHand: 3,
                        outOfStockThreshold: 2,
                        trackInventory: GlobalFlag.TRUE,
                        useGlobalOutOfStockThreshold: false,
                    },
                    {
                        id: 'T_4',
                        stockOnHand: 3,
                        outOfStockThreshold: 0,
                        trackInventory: GlobalFlag.TRUE,
                        useGlobalOutOfStockThreshold: true,
                    },
                    {
                        id: 'T_5',
                        stockOnHand: 0,
                        outOfStockThreshold: 0,
                        trackInventory: GlobalFlag.TRUE,
                        useGlobalOutOfStockThreshold: false,
                    },
                ],
            });

            await shopClient.asUserWithCredentials('trevor_donnelly96@hotmail.com', 'test');
        });

        it('stockLevel uses DefaultStockDisplayStrategy', async () => {
            const { product } = await shopClient.query(getProductWithStockLevelDocument, {
                id: 'T_2',
            });

            expect(product?.variants.map(v => v.stockLevel)).toEqual([
                'OUT_OF_STOCK',
                'IN_STOCK',
                'IN_STOCK',
            ]);
        });

        it('does not add an empty OrderLine if zero saleable stock', async () => {
            const variantId = 'T_5';
            const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
                productVariantId: variantId,
                quantity: 1,
            });

            orderGuard.assertErrorResult(addItemToOrder);

            expect(addItemToOrder.errorCode).toBe(ErrorCode.INSUFFICIENT_STOCK_ERROR);
            expect(addItemToOrder.message).toBe('No items were added to the order due to insufficient stock');
            expect((addItemToOrder as any).quantityAvailable).toBe(0);
            expect((addItemToOrder as any).order.lines.length).toBe(0);
        });

        it('returns InsufficientStockError when tracking inventory & adding too many at once', async () => {
            const variantId = 'T_1';
            const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
                productVariantId: variantId,
                quantity: 5,
            });

            orderGuard.assertErrorResult(addItemToOrder);

            expect(addItemToOrder.errorCode).toBe(ErrorCode.INSUFFICIENT_STOCK_ERROR);
            expect(addItemToOrder.message).toBe(
                'Only 3 items were added to the order due to insufficient stock',
            );
            expect((addItemToOrder as any).quantityAvailable).toBe(3);
            // Still adds as many as available to the Order
            expect((addItemToOrder as any).order.lines[0].productVariant.id).toBe(variantId);
            expect((addItemToOrder as any).order.lines[0].quantity).toBe(3);

            const product = await getProductWithStockMovement('T_1');
            const variant = product!.variants[0];

            expect(variant.id).toBe(variantId);
            expect(variant.stockAllocated).toBe(0);
            expect(variant.stockOnHand).toBe(3);
        });

        it('does not return error when not tracking inventory', async () => {
            const variantId = 'T_2';
            const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
                productVariantId: variantId,
                quantity: 5,
            });

            orderGuard.assertSuccess(addItemToOrder);

            expect(addItemToOrder.lines.length).toBe(2);
            expect(addItemToOrder.lines[1].productVariant.id).toBe(variantId);
            expect(addItemToOrder.lines[1].quantity).toBe(5);

            const product = await getProductWithStockMovement('T_1');
            const variant = product!.variants[1];

            expect(variant.id).toBe(variantId);
            expect(variant.stockAllocated).toBe(0);
            expect(variant.stockOnHand).toBe(3);
        });

        it('returns InsufficientStockError for positive threshold', async () => {
            const variantId = 'T_3';
            const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
                productVariantId: variantId,
                quantity: 2,
            });

            orderGuard.assertErrorResult(addItemToOrder);

            expect(addItemToOrder.errorCode).toBe(ErrorCode.INSUFFICIENT_STOCK_ERROR);
            expect(addItemToOrder.message).toBe(
                'Only 1 item was added to the order due to insufficient stock',
            );
            expect((addItemToOrder as any).quantityAvailable).toBe(1);
            // Still adds as many as available to the Order
            expect((addItemToOrder as any).order.lines.length).toBe(3);
            expect((addItemToOrder as any).order.lines[2].productVariant.id).toBe(variantId);
            expect((addItemToOrder as any).order.lines[2].quantity).toBe(1);

            const product = await getProductWithStockMovement('T_1');
            const variant = product!.variants[2];

            expect(variant.id).toBe(variantId);
            expect(variant.stockAllocated).toBe(0);
            expect(variant.stockOnHand).toBe(3);
        });

        it('negative threshold allows backorder', async () => {
            const variantId = 'T_4';
            const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
                productVariantId: variantId,
                quantity: 8,
            });

            orderGuard.assertSuccess(addItemToOrder);

            expect(addItemToOrder.lines.length).toBe(4);
            expect(addItemToOrder.lines[3].productVariant.id).toBe(variantId);
            expect(addItemToOrder.lines[3].quantity).toBe(8);

            const product = await getProductWithStockMovement('T_1');
            const variant = product!.variants[3];

            expect(variant.id).toBe(variantId);
            expect(variant.stockAllocated).toBe(0);
            expect(variant.stockOnHand).toBe(3);
        });

        it('allocates stock', async () => {
            await proceedToArrangingPayment(shopClient);
            const result = await addPaymentToOrder(shopClient, twoStagePaymentMethod);
            orderGuard.assertSuccess(result);
            order = result;

            const product = await getProductWithStockMovement('T_1');
            const [variant1, variant2, variant3, variant4] = product!.variants;

            expect(variant1.stockAllocated).toBe(3);
            expect(variant1.stockOnHand).toBe(3);

            expect(variant2.stockAllocated).toBe(0); // inventory not tracked
            expect(variant2.stockOnHand).toBe(3);

            expect(variant3.stockAllocated).toBe(1);
            expect(variant3.stockOnHand).toBe(3);

            expect(variant4.stockAllocated).toBe(8);
            expect(variant4.stockOnHand).toBe(3);
        });

        it('does not re-allocate stock when transitioning Payment from Authorized -> Settled', async () => {
            await adminClient.query(settlePaymentDocument, {
                id: order.id,
            });

            const product = await getProductWithStockMovement('T_1');
            const [variant1, variant2, variant3, variant4] = product!.variants;

            expect(variant1.stockAllocated).toBe(3);
            expect(variant1.stockOnHand).toBe(3);

            expect(variant2.stockAllocated).toBe(0); // inventory not tracked
            expect(variant2.stockOnHand).toBe(3);

            expect(variant3.stockAllocated).toBe(1);
            expect(variant3.stockOnHand).toBe(3);

            expect(variant4.stockAllocated).toBe(8);
            expect(variant4.stockOnHand).toBe(3);
        });

        it('addFulfillmentToOrder returns ErrorResult when insufficient stock on hand', async () => {
            const { addFulfillmentToOrder } = await adminClient.query(createFulfillmentDocument, {
                input: {
                    lines: order.lines.map(l => ({
                        orderLineId: l.id,
                        quantity: l.quantity,
                    })),
                    handler: {
                        code: manualFulfillmentHandler.code,
                        arguments: [
                            { name: 'method', value: 'test method' },
                            { name: 'trackingCode', value: 'ABC123' },
                        ],
                    },
                },
            });

            fulfillmentGuard.assertErrorResult(addFulfillmentToOrder);

            expect(addFulfillmentToOrder.errorCode).toBe(ErrorCode.INSUFFICIENT_STOCK_ON_HAND_ERROR);
            expect(addFulfillmentToOrder.message).toBe(
                'Cannot create a Fulfillment as "Laptop 15 inch 16GB" has insufficient stockOnHand (3)',
            );
        });

        it('addFulfillmentToOrder succeeds when there is sufficient stockOnHand', async () => {
            const { addFulfillmentToOrder } = await adminClient.query(createFulfillmentDocument, {
                input: {
                    lines: order.lines
                        .filter(l => l.productVariant.id === 'T_1')
                        .map(l => ({ orderLineId: l.id, quantity: l.quantity })),
                    handler: {
                        code: manualFulfillmentHandler.code,
                        arguments: [
                            { name: 'method', value: 'test method' },
                            { name: 'trackingCode', value: 'ABC123' },
                        ],
                    },
                },
            });

            fulfillmentGuard.assertSuccess(addFulfillmentToOrder);

            const product = await getProductWithStockMovement('T_1');
            const variant = product!.variants[0];

            expect(variant.stockOnHand).toBe(0);
            expect(variant.stockAllocated).toBe(0);
        });

        it('addFulfillmentToOrder succeeds when inventory is not being tracked', async () => {
            const { addFulfillmentToOrder } = await adminClient.query(createFulfillmentDocument, {
                input: {
                    lines: order.lines
                        .filter(l => l.productVariant.id === 'T_2')
                        .map(l => ({ orderLineId: l.id, quantity: l.quantity })),
                    handler: {
                        code: manualFulfillmentHandler.code,
                        arguments: [
                            { name: 'method', value: 'test method' },
                            { name: 'trackingCode', value: 'ABC123' },
                        ],
                    },
                },
            });

            fulfillmentGuard.assertSuccess(addFulfillmentToOrder);

            const product = await getProductWithStockMovement('T_1');
            const variant = product!.variants[1];

            expect(variant.stockOnHand).toBe(3);
            expect(variant.stockAllocated).toBe(0);
        });

        it('addFulfillmentToOrder succeeds when making a partial Fulfillment with quantity equal to stockOnHand', async () => {
            const { addFulfillmentToOrder } = await adminClient.query(createFulfillmentDocument, {
                input: {
                    lines: order.lines
                        .filter(l => l.productVariant.id === 'T_4')
                        .map(l => ({ orderLineId: l.id, quantity: 3 })), // we know there are only 3 on hand
                    handler: {
                        code: manualFulfillmentHandler.code,
                        arguments: [
                            { name: 'method', value: 'test method' },
                            { name: 'trackingCode', value: 'ABC123' },
                        ],
                    },
                },
            });

            fulfillmentGuard.assertSuccess(addFulfillmentToOrder);

            const product = await getProductWithStockMovement('T_1');
            const variant = product!.variants[3];

            expect(variant.stockOnHand).toBe(0);
            expect(variant.stockAllocated).toBe(5);
        });

        it('fulfillment can be created after adjusting stockOnHand to be sufficient', async () => {
            const { updateProductVariants } = await adminClient.query(updateProductVariantsDocument, {
                input: [
                    {
                        id: 'T_4',
                        stockOnHand: 10,
                    },
                ],
            });

            expect(updateProductVariants[0]!.stockOnHand).toBe(10);

            const { addFulfillmentToOrder } = await adminClient.query(createFulfillmentDocument, {
                input: {
                    lines: order.lines
                        .filter(l => l.productVariant.id === 'T_4')
                        .map(l => ({ orderLineId: l.id, quantity: 5 })),
                    handler: {
                        code: manualFulfillmentHandler.code,
                        arguments: [
                            { name: 'method', value: 'test method' },
                            { name: 'trackingCode', value: 'ABC123' },
                        ],
                    },
                },
            });

            fulfillmentGuard.assertSuccess(addFulfillmentToOrder);

            const product = await getProductWithStockMovement('T_1');
            const variant = product!.variants[3];

            expect(variant.stockOnHand).toBe(5);
            expect(variant.stockAllocated).toBe(0);
        });

        describe('adjusting stockOnHand with negative outOfStockThreshold', () => {
            const variant1Id = 'T_1';
            beforeAll(async () => {
                await adminClient.query(updateProductVariantsDocument, {
                    input: [
                        {
                            id: variant1Id,
                            stockOnHand: 0,
                            outOfStockThreshold: -20,
                            trackInventory: GlobalFlag.TRUE,
                            useGlobalOutOfStockThreshold: false,
                        },
                    ],
                });
            });

            it(
                'attempting to set stockOnHand below outOfStockThreshold throws',
                assertThrowsWithMessage(async () => {
                    const result = await adminClient.query(updateStockOnHandDocument, {
                        input: [
                            {
                                id: variant1Id,
                                stockOnHand: -21,
                            },
                        ],
                    });
                }, 'stockOnHand cannot be a negative value'),
            );

            it('can set negative stockOnHand that is not less than outOfStockThreshold', async () => {
                const result = await adminClient.query(updateStockOnHandDocument, {
                    input: [
                        {
                            id: variant1Id,
                            stockOnHand: -10,
                        },
                    ],
                });
                expect(result.updateProductVariants[0]!.stockOnHand).toBe(-10);
            });
        });

        describe('edge cases', () => {
            const variant5Id = 'T_5';
            const variant6Id = 'T_6';
            const variant7Id = 'T_7';

            beforeAll(async () => {
                // First place an order which creates a backorder (excess of allocated units)
                await adminClient.query(updateProductVariantsDocument, {
                    input: [
                        {
                            id: variant5Id,
                            stockOnHand: 5,
                            outOfStockThreshold: -20,
                            trackInventory: GlobalFlag.TRUE,
                            useGlobalOutOfStockThreshold: false,
                        },
                        {
                            id: variant6Id,
                            stockOnHand: 3,
                            outOfStockThreshold: 0,
                            trackInventory: GlobalFlag.TRUE,
                            useGlobalOutOfStockThreshold: false,
                        },
                        {
                            id: variant7Id,
                            stockOnHand: 3,
                            outOfStockThreshold: 0,
                            trackInventory: GlobalFlag.TRUE,
                            useGlobalOutOfStockThreshold: false,
                        },
                    ],
                });
                await shopClient.asUserWithCredentials('trevor_donnelly96@hotmail.com', 'test');
                const { addItemToOrder: add1 } = await shopClient.query(addItemToOrderDocument, {
                    productVariantId: variant5Id,
                    quantity: 25,
                });
                orderGuard.assertSuccess(add1);
                await proceedToArrangingPayment(shopClient);
                await addPaymentToOrder(shopClient, testSuccessfulPaymentMethod);
            });

            it('zero saleable stock', async () => {
                await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
                // The saleable stock level is now 0 (25 allocated, 5 on hand, -20 threshold)
                const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
                    productVariantId: variant5Id,
                    quantity: 1,
                });
                orderGuard.assertErrorResult(addItemToOrder);

                expect(addItemToOrder.errorCode).toBe(ErrorCode.INSUFFICIENT_STOCK_ERROR);
                expect(addItemToOrder.message).toBe(
                    'No items were added to the order due to insufficient stock',
                );
            });

            it('negative saleable stock', async () => {
                await adminClient.query(updateProductVariantsDocument, {
                    input: [
                        {
                            id: variant5Id,
                            outOfStockThreshold: -10,
                        },
                    ],
                });
                // The saleable stock level is now -10 (25 allocated, 5 on hand, -10 threshold)
                await shopClient.asUserWithCredentials('marques.sawayn@hotmail.com', 'test');
                const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
                    productVariantId: variant5Id,
                    quantity: 1,
                });
                orderGuard.assertErrorResult(addItemToOrder);

                expect(addItemToOrder.errorCode).toBe(ErrorCode.INSUFFICIENT_STOCK_ERROR);
                expect(addItemToOrder.message).toBe(
                    'No items were added to the order due to insufficient stock',
                );
            });

            // https://github.com/vendurehq/vendure/issues/691
            it('returns InsufficientStockError when tracking inventory & adding too many individually', async () => {
                await shopClient.asAnonymousUser();
                const { addItemToOrder: add1 } = await shopClient.query(addItemToOrderDocument, {
                    productVariantId: variant6Id,
                    quantity: 3,
                });

                orderGuard.assertSuccess(add1);

                const { addItemToOrder: add2 } = await shopClient.query(addItemToOrderDocument, {
                    productVariantId: variant6Id,
                    quantity: 1,
                });

                orderGuard.assertErrorResult(add2);

                expect(add2.errorCode).toBe(ErrorCode.INSUFFICIENT_STOCK_ERROR);
                expect(add2.message).toBe('No items were added to the order due to insufficient stock');
                expect((add2 as any).quantityAvailable).toBe(0);
                // Still adds as many as available to the Order
                expect((add2 as any).order.lines[0].productVariant.id).toBe(variant6Id);
                expect((add2 as any).order.lines[0].quantity).toBe(3);
            });

            // https://github.com/vendurehq/vendure/issues/1273
            it('adjustOrderLine when saleable stock changes to zero', async () => {
                await adminClient.query(updateProductVariantsDocument, {
                    input: [
                        {
                            id: variant7Id,
                            stockOnHand: 10,
                        },
                    ],
                });

                await shopClient.asAnonymousUser();
                const { addItemToOrder: add1 } = await shopClient.query(addItemToOrderDocument, {
                    productVariantId: variant7Id,
                    quantity: 1,
                });
                orderGuard.assertSuccess(add1);
                expect(add1.lines.length).toBe(1);

                await adminClient.query(updateProductVariantsDocument, {
                    input: [
                        {
                            id: variant7Id,
                            stockOnHand: 0,
                        },
                    ],
                });

                const { adjustOrderLine: add2 } = await shopClient.query(adjustItemQuantityDocument, {
                    orderLineId: add1.lines[0].id,
                    quantity: 2,
                });
                orderGuard.assertErrorResult(add2);

                expect(add2.errorCode).toBe(ErrorCode.INSUFFICIENT_STOCK_ERROR);

                const { activeOrder } = await shopClient.query(getActiveOrderDocument);
                expect(activeOrder!.lines.length).toBe(0);
            });

            // https://github.com/vendurehq/vendure/issues/1557
            it('cancelling an Order only creates Releases for OrderItems that have actually been allocated', async () => {
                const product = await getProductWithStockMovement('T_2');
                const variant6 = product!.variants.find(v => v.id === variant6Id);
                expect(variant6!.stockOnHand).toBe(3);
                expect(variant6!.stockAllocated).toBe(0);

                await shopClient.asUserWithCredentials('trevor_donnelly96@hotmail.com', 'test');
                const { addItemToOrder: add1 } = await shopClient.query(addItemToOrderDocument, {
                    productVariantId: variant6!.id,
                    quantity: 1,
                });
                orderGuard.assertSuccess(add1);

                // Set this flag so that our custom OrderPlacedStrategy uses the special logic
                // designed to test this scenario.
                await shopClient.query(updateOrderCustomFieldsDocument, {
                    input: { customFields: { test1557: true } },
                });

                await shopClient.query(setShippingAddressDocument, {
                    input: {
                        streetLine1: '1 Test Street',
                        countryCode: 'GB',
                    } as CreateAddressInput,
                });
                await setFirstEligibleShippingMethod();
                const { transitionOrderToState } = await shopClient.query(transitionToStateDocument, {
                    state: 'ArrangingPayment',
                });
                orderGuard.assertSuccess(transitionOrderToState as any);
                const transitionedOrder = transitionOrderToState as TestOrderFragment;
                expect(transitionedOrder.state).toBe('ArrangingPayment');
                expect(transitionedOrder.active).toBe(false);

                const product2 = await getProductWithStockMovement('T_2');
                const variant6_2 = product2!.variants.find(v => v.id === variant6Id);
                expect(variant6_2!.stockOnHand).toBe(3);
                expect(variant6_2!.stockAllocated).toBe(0);

                const { cancelOrder } = await adminClient.query(cancelOrderDocument, {
                    input: {
                        orderId: transitionedOrder.id,
                        lines: transitionedOrder.lines.map(l => ({
                            orderLineId: l.id,
                            quantity: l.quantity,
                        })),
                        reason: 'Cancelled by test',
                    },
                });
                orderGuard.assertSuccess(cancelOrder);

                const product3 = await getProductWithStockMovement('T_2');
                const variant6_3 = product3!.variants.find(v => v.id === variant6Id);
                expect(variant6_3!.stockOnHand).toBe(3);
                expect(variant6_3!.stockAllocated).toBe(0);
            });
        });
    });

    // https://github.com/vendurehq/vendure/issues/1028
    describe('OrderLines with same variant but different custom fields', () => {
        let orderId: string;

        const addItemToOrderWithCustomFieldsDocument = graphqlShop(`
            mutation AddItemToOrderWithCustomFields(
                $productVariantId: ID!
                $quantity: Int!
                $customFields: OrderLineCustomFieldsInput
            ) {
                addItemToOrder(
                    productVariantId: $productVariantId
                    quantity: $quantity
                    customFields: $customFields
                ) {
                    ... on Order {
                        id
                        lines {
                            id
                        }
                    }
                    ... on ErrorResult {
                        errorCode
                        message
                    }
                }
            }
        `);

        it('correctly allocates stock', async () => {
            await shopClient.asUserWithCredentials('trevor_donnelly96@hotmail.com', 'test');

            const product = await getProductWithStockMovement('T_2');
            const [variant1, variant2, variant3] = product!.variants;

            expect(variant2.stockAllocated).toBe(0);

            await shopClient.query(addItemToOrderWithCustomFieldsDocument, {
                productVariantId: variant2.id,
                quantity: 1,
                customFields: {
                    customization: 'foo',
                } as any,
            });
            const { addItemToOrder } = await shopClient.query(addItemToOrderWithCustomFieldsDocument, {
                productVariantId: variant2.id,
                quantity: 1,
                customFields: {
                    customization: 'bar',
                } as any,
            });

            orderGuard.assertSuccess(addItemToOrder);
            orderId = addItemToOrder.id;
            // Assert that separate order lines have been created
            expect(addItemToOrder.lines.length).toBe(2);

            await shopClient.query(setShippingAddressDocument, {
                input: {
                    streetLine1: '1 Test Street',
                    countryCode: 'GB',
                } as CreateAddressInput,
            });
            await setFirstEligibleShippingMethod();
            await shopClient.query(transitionToStateDocument, {
                state: 'ArrangingPayment',
            });
            const { addPaymentToOrder: order } = await shopClient.query(addPaymentDocument, {
                input: {
                    method: testSuccessfulPaymentMethod.code,
                    metadata: {},
                } as PaymentInput,
            });
            orderGuard.assertSuccess(order);

            const product2 = await getProductWithStockMovement('T_2');
            const [variant1_2, variant2_2, variant3_2] = product2!.variants;

            expect(variant2_2.stockAllocated).toBe(2);
        });

        it('correctly creates Sales', async () => {
            const product = await getProductWithStockMovement('T_2');
            const [variant1, variant2, variant3] = product!.variants;

            expect(variant2.stockOnHand).toBe(3);

            const { order } = await adminClient.query(getOrderDocument, {
                id: orderId,
            });

            await adminClient.query(createFulfillmentDocument, {
                input: {
                    lines:
                        order!.lines.map(l => ({
                            orderLineId: l.id,
                            quantity: l.quantity,
                        })) ?? [],
                    handler: {
                        code: manualFulfillmentHandler.code,
                        arguments: [
                            { name: 'method', value: 'test method' },
                            { name: 'trackingCode', value: 'ABC123' },
                        ],
                    },
                },
            });

            const product2 = await getProductWithStockMovement('T_2');
            const [variant1_2, variant2_2, variant3_2] = product2!.variants;

            expect(variant2_2.stockAllocated).toBe(0);
            expect(variant2_2.stockOnHand).toBe(1);
        });
    });

    // OSS-94: stockAllocated and stockOnHand must never go negative
    describe('stock values never go negative (clamped writes)', () => {
        // Use product T_2 (Curvy Monitor) variant[2] (32 inch, id T_7).
        // The allocation describe above uses variants[0] and variants[1]; variants[2]
        // is untracked (inherited global=false) and otherwise untouched — safe to reset.
        let trackedVariantId: string;

        beforeAll(async () => {
            const { product } = await adminClient.query(getStockMovementDocument, {
                id: 'T_2',
            });
            trackedVariantId = product!.variants[2].id;
            await adminClient.query(updateStockOnHandDocument, {
                input: [
                    {
                        id: trackedVariantId,
                        stockOnHand: 3,
                        trackInventory: GlobalFlag.TRUE,
                    },
                ],
            });
        });

        it('stockAllocated stays >= 0 after allocate → release cycle', async () => {
            // Allocate 3 by completing an order
            await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
            await shopClient.query(addItemToOrderDocument, {
                productVariantId: trackedVariantId,
                quantity: 3,
            });
            await proceedToArrangingPayment(shopClient);
            const order = await addPaymentToOrder(shopClient, testSuccessfulPaymentMethod);
            orderGuard.assertSuccess(order);

            // After allocation, stockAllocated should be 3
            const productAfterAlloc = await getProductWithStockMovement('T_2');
            const variantAfterAlloc = productAfterAlloc!.variants[2];
            expect(variantAfterAlloc.stockAllocated).toBe(3);

            // Cancel all lines — triggers Release, decrementing stockAllocated by 3
            await adminClient.query(cancelOrderDocument, {
                input: {
                    orderId: order.id,
                    lines: order.lines.map(l => ({
                        orderLineId: l.id,
                        quantity: l.quantity,
                    })),
                    reason: 'Test',
                },
            });

            const productAfterCancel = await getProductWithStockMovement('T_2');
            const variantAfterCancel = productAfterCancel!.variants[2];
            // stockAllocated must be exactly 0: started at 3, one Release of 3 → 0
            expect(variantAfterCancel.stockAllocated).toBe(0);
        });

        it('stockOnHand stays >= 0 after fulfill → cancel cycle', async () => {
            // Reset stock
            await adminClient.query(updateStockOnHandDocument, {
                input: [
                    {
                        id: trackedVariantId,
                        stockOnHand: 2,
                        trackInventory: GlobalFlag.TRUE,
                    },
                ],
            });

            // Complete an order (alloc=2)
            await shopClient.asUserWithCredentials('marques.sawayn@hotmail.com', 'test');
            await shopClient.query(addItemToOrderDocument, {
                productVariantId: trackedVariantId,
                quantity: 2,
            });
            await proceedToArrangingPayment(shopClient);
            const order = await addPaymentToOrder(shopClient, testSuccessfulPaymentMethod);
            orderGuard.assertSuccess(order);

            // Fulfill (sale: stockAllocated -= 2, stockOnHand -= 2)
            await adminClient.query(createFulfillmentDocument, {
                input: {
                    lines: order.lines.map(l => ({
                        orderLineId: l.id,
                        quantity: l.quantity,
                    })),
                    handler: {
                        code: manualFulfillmentHandler.code,
                        arguments: [
                            { name: 'method', value: 'test' },
                            { name: 'trackingCode', value: '' },
                        ],
                    },
                },
            });

            const productAfterFulfill = await getProductWithStockMovement('T_2');
            const variantAfterFulfill = productAfterFulfill!.variants[2];
            // Sale deducts: stockAllocated 2→0, stockOnHand 2→0; clamp must not go negative
            expect(variantAfterFulfill.stockAllocated).toBe(0);
            expect(variantAfterFulfill.stockOnHand).toBe(0);
        });
    });

    // https://github.com/vendurehq/vendure/issues/1738
    describe('going out of stock after being added to order', () => {
        const variantId = 'T_1';

        beforeAll(async () => {
            const { updateProductVariants } = await adminClient.query(updateStockOnHandDocument, {
                input: [
                    {
                        id: variantId,
                        stockOnHand: 1,
                        trackInventory: GlobalFlag.TRUE,
                        useGlobalOutOfStockThreshold: false,
                        outOfStockThreshold: 0,
                    },
                ],
            });
        });

        it('prevents checkout if no saleable stock', async () => {
            // First customer adds to order
            await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
            const { addItemToOrder: add1 } = await shopClient.query(addItemToOrderDocument, {
                productVariantId: variantId,
                quantity: 1,
            });
            orderGuard.assertSuccess(add1);

            // Second customer adds to order
            await shopClient.asUserWithCredentials('marques.sawayn@hotmail.com', 'test');
            const { addItemToOrder: add2 } = await shopClient.query(addItemToOrderDocument, {
                productVariantId: variantId,
                quantity: 1,
            });
            orderGuard.assertSuccess(add2);

            // first customer can check out
            await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
            await proceedToArrangingPayment(shopClient);
            const result1 = await addPaymentToOrder(shopClient, testSuccessfulPaymentMethod);
            orderGuard.assertSuccess(result1);

            const product1 = await getProductWithStockMovement('T_1');
            const variant = product1!.variants.find(v => v.id === variantId);
            expect(variant!.stockOnHand).toBe(1);
            expect(variant!.stockAllocated).toBe(1);

            // second customer CANNOT check out
            await shopClient.asUserWithCredentials('marques.sawayn@hotmail.com', 'test');
            await shopClient.query(setShippingAddressDocument, {
                input: {
                    fullName: 'name',
                    streetLine1: '12 the street',
                    city: 'foo',
                    postalCode: '123456',
                    countryCode: 'US',
                },
            });

            const { eligibleShippingMethods } = await shopClient.query(getEligibleShippingMethodsDocument);
            const { setOrderShippingMethod } = await shopClient.query(setShippingMethodDocument, {
                id: [eligibleShippingMethods[1].id],
            });
            orderGuard.assertSuccess(setOrderShippingMethod as any);
            const { transitionOrderToState } = await shopClient.query(transitionToStateDocument, {
                state: 'ArrangingPayment',
            });
            expect(transitionOrderToState).not.toBeNull();
            expect((transitionOrderToState as any).transitionError).toBe(
                'Cannot transition Order to the "ArrangingPayment" state due to insufficient stock of Laptop 13 inch 8GB',
            );
        });
    });

    // OSS-94: lock re-check + shortfall detection at allocation
    describe('stock shortfall detection when stock depleted between checkout and settlement', () => {
        // T_3 = "Laptop 13 inch 16GB". Reset to 20 on hand, tracked, threshold=0.
        const variantId = 'T_3';

        beforeAll(async () => {
            await adminClient.query(updateProductVariantsDocument, {
                input: [
                    {
                        id: variantId,
                        stockOnHand: 20,
                        trackInventory: GlobalFlag.TRUE,
                        useGlobalOutOfStockThreshold: false,
                        outOfStockThreshold: 0,
                    },
                ],
            });
        });

        // #OSS-94 — concurrent settlement must not oversell; StockShortfallEvent must be published
        it('emits StockShortfallEvent and does not oversell when stock is depleted before settlement', async () => {
            const eventBus = server.app.get(EventBus);

            // Order A (trevor): add 5 items and reach ArrangingPayment.
            // Stock check passes because at least 5 units are available at this point.
            await shopClient.asUserWithCredentials('trevor_donnelly96@hotmail.com', 'test');
            const { addItemToOrder: addA } = await shopClient.query(addItemToOrderDocument, {
                productVariantId: variantId,
                quantity: 5,
            });
            orderGuard.assertSuccess(addA);
            await proceedToArrangingPayment(shopClient);

            // Order B (hayden): deplete all remaining saleable stock and settle.
            // InsufficientStockError is fine here — as many units as are available are still added to the cart.
            // This simulates the concurrent order that "wins" the stock between Order A's
            // ArrangingPayment check and its payment settlement.
            await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
            await shopClient.query(addItemToOrderDocument, {
                productVariantId: variantId,
                quantity: 100, // request more than available; gets capped to available units
            });
            await proceedToArrangingPayment(shopClient);
            const orderB = await addPaymentToOrder(shopClient, testSuccessfulPaymentMethod);
            orderGuard.assertSuccess(orderB);

            // Verify stock is now fully allocated (stockAllocated = stockOnHand), leaving 0 for Order A
            const productAfterB = await getProductWithStockMovement('T_1');
            const variantAfterB = productAfterB!.variants.find(v => v.id === variantId);
            expect(variantAfterB!.stockAllocated).toBe(variantAfterB!.stockOnHand);

            // Subscribe to StockShortfallEvent BEFORE Order A settles
            const shortfallEventPromise = firstValueFrom(
                eventBus.ofType(StockShortfallEvent).pipe(timeout(5000)),
            );

            // Order A (trevor): settle — stock is fully allocated by Order B, so allocation
            // must be capped at 0 (or whatever remains).
            await shopClient.asUserWithCredentials('trevor_donnelly96@hotmail.com', 'test');
            const orderA = await addPaymentToOrder(shopClient, testSuccessfulPaymentMethod);
            orderGuard.assertSuccess(orderA);

            // Assert no oversell: Order B took all 20; Order A gets 0 additional allocation.
            // stockOnHand stays 20 (only allocations changed, not sales); stockAllocated = 20.
            const productAfterA = await getProductWithStockMovement('T_1');
            const variantAfterA = productAfterA!.variants.find(v => v.id === variantId);
            expect(variantAfterA!.stockOnHand).toBe(20);
            expect(variantAfterA!.stockAllocated).toBe(20);

            // Assert StockShortfallEvent was published for Order A
            const shortfallEvent = await shortfallEventPromise;
            // order.id in the event is the raw DB id; orderA.id from GraphQL is prefixed ('T_N').
            // Verify they refer to the same record by checking the order code.
            expect(shortfallEvent.order.code).toBe(orderA.code);
            expect(shortfallEvent.shortfalls.length).toBeGreaterThan(0);
            expect(shortfallEvent.shortfalls[0].requested).toBe(5);
            // Order B allocated all 20 units; Order A's allocation delta is 0
            expect(shortfallEvent.shortfalls[0].allocated).toBe(0);
        });
    });

    // OSS-94: the allocation re-check must hold when settlements genuinely overlap,
    // not only when one settlement completes before the next begins.
    describe('truly concurrent settlement', () => {
        // sql.js executes all queries on a single connection, so transactions cannot
        // genuinely overlap there and the locking behaviour cannot be exercised.
        // The CI database matrix (postgres/mysql/mariadb) is where this test has meaning.
        const isRealDb = (process.env.DB ?? 'sqljs') !== 'sqljs';

        it.runIf(isRealDb)(
            'concurrent settlements never allocate more than stockOnHand',
            async () => {
                const variantId = 'T_4'; // Laptop 15 inch 16GB
                const quantityPerOrder = 5;
                const customers = [
                    'hayden.zieme12@hotmail.com',
                    'trevor_donnelly96@hotmail.com',
                    'marques.sawayn@hotmail.com',
                ];

                // Make exactly one order's worth of stock saleable, accounting for
                // any allocations left over from earlier tests.
                const product = await getProductWithStockMovement('T_1');
                const variant = product!.variants.find(v => v.id === variantId)!;
                const stockOnHand = variant.stockAllocated + quantityPerOrder;
                await adminClient.query(updateProductVariantsDocument, {
                    input: [
                        {
                            id: variantId,
                            stockOnHand,
                            trackInventory: GlobalFlag.TRUE,
                            useGlobalOutOfStockThreshold: false,
                            outOfStockThreshold: 0,
                        },
                    ],
                });

                // Each customer needs their own client, since a client holds a single
                // session. All of them reach ArrangingPayment: the stock check passes
                // for each because nothing is allocated until settlement.
                const clients: SimpleGraphQLClient[] = [];
                for (const emailAddress of customers) {
                    const client = new SimpleGraphQLClient(
                        testEnvConfig,
                        `http://localhost:${testEnvConfig.apiOptions.port}/${testEnvConfig.apiOptions.shopApiPath}`,
                    );
                    await client.asUserWithCredentials(emailAddress, 'test');
                    // These customers are reused across the suite, so an earlier test may have
                    // left this customer with an active order still in AddingItems that holds
                    // lines for other (now-depleted) variants. Transitioning to ArrangingPayment
                    // validates every line, so start from a clean order to keep this test hermetic.
                    await client.query(removeAllOrderLinesDocument);
                    const { addItemToOrder } = await client.query(addItemToOrderDocument, {
                        productVariantId: variantId,
                        quantity: quantityPerOrder,
                    });
                    orderGuard.assertSuccess(addItemToOrder);
                    const arrangingPaymentOrderId = await proceedToArrangingPayment(client);
                    expect(
                        arrangingPaymentOrderId,
                        `transition to ArrangingPayment failed for ${emailAddress}`,
                    ).toBeDefined();
                    clients.push(client);
                }

                // Settle all orders at once. The delayed payment handler keeps each
                // settlement transaction open long enough that they all take their DB
                // snapshots before the first one commits.
                const results = await Promise.all(
                    clients.map(client => addPaymentToOrder(client, delayedSettlePaymentMethod)),
                );
                for (const result of results) {
                    orderGuard.assertSuccess(result);
                }

                // Only quantityPerOrder units were saleable, so at most one order's
                // quantity may have been allocated on top of the pre-existing
                // allocations. Anything more is an oversell.
                const productAfter = await getProductWithStockMovement('T_1');
                const variantAfter = productAfter!.variants.find(v => v.id === variantId)!;
                expect(variantAfter.stockOnHand).toBe(stockOnHand);
                expect(variantAfter.stockAllocated).toBeLessThanOrEqual(variantAfter.stockOnHand);
            },
            60_000,
        );
    });

    // OSS-94: a StockShortfallEvent must reference the Order which the shortfalling
    // line belongs to. Fulfillments can span multiple Orders (Fulfillment.orders is
    // many-to-many), and default-fulfillment-process re-allocates a cancelled
    // fulfillment's lines in a single createAllocationsForOrderLines() call, so the
    // batch can mix lines of different Orders.
    describe('shortfall attribution with lines from multiple orders', () => {
        const rawId = (id: string) => id.replace(/^T_/, '');

        it('attributes each shortfall to the order that the line belongs to', async () => {
            const inStockVariantId = 'T_2'; // Laptop 15 inch 8GB
            const depletedVariantId = 'T_7'; // Curvy Monitor 32 inch

            const laptop = await getProductWithStockMovement('T_1');
            const inStockVariant = laptop!.variants.find(v => v.id === inStockVariantId)!;
            const monitor = await getProductWithStockMovement('T_2');
            const depletedVariant = monitor!.variants.find(v => v.id === depletedVariantId)!;
            await adminClient.query(updateProductVariantsDocument, {
                input: [
                    {
                        id: inStockVariantId,
                        stockOnHand: inStockVariant.stockAllocated + 10,
                        trackInventory: GlobalFlag.TRUE,
                        useGlobalOutOfStockThreshold: false,
                        outOfStockThreshold: 0,
                    },
                    {
                        id: depletedVariantId,
                        stockOnHand: depletedVariant.stockAllocated + 3,
                        trackInventory: GlobalFlag.TRUE,
                        useGlobalOutOfStockThreshold: false,
                        outOfStockThreshold: 0,
                    },
                ],
            });

            // Order A (hayden): a line which can be fully allocated
            await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
            const { addItemToOrder: orderA } = await shopClient.query(addItemToOrderDocument, {
                productVariantId: inStockVariantId,
                quantity: 1,
            });
            orderGuard.assertSuccess(orderA);

            // Order B (trevor): a line whose stock will be depleted before allocation
            await shopClient.asUserWithCredentials('trevor_donnelly96@hotmail.com', 'test');
            const { addItemToOrder: orderB } = await shopClient.query(addItemToOrderDocument, {
                productVariantId: depletedVariantId,
                quantity: 3,
            });
            orderGuard.assertSuccess(orderB);

            // Deplete order B's variant: all remaining stock is already allocated elsewhere
            await adminClient.query(updateProductVariantsDocument, {
                input: [
                    {
                        id: depletedVariantId,
                        stockOnHand: depletedVariant.stockAllocated,
                    },
                ],
            });

            const stockMovementService = server.app.get(StockMovementService);
            const requestContextService = server.app.get(RequestContextService);
            const connection = server.app.get(TransactionalConnection);
            const eventBus = server.app.get(EventBus);
            const ctx = await requestContextService.create({ apiType: 'admin' });

            const events: StockShortfallEvent[] = [];
            const subscription = eventBus.ofType(StockShortfallEvent).subscribe(e => events.push(e));
            try {
                // Reproduces what default-fulfillment-process does when a Fulfillment
                // spanning two Orders is cancelled: one re-allocation call with a
                // batch of lines from different Orders.
                await connection.withTransaction(ctx, txCtx =>
                    stockMovementService.createAllocationsForOrderLines(txCtx, [
                        { orderLineId: rawId(orderA.lines[0].id), quantity: 1 },
                        { orderLineId: rawId(orderB.lines[0].id), quantity: 3 },
                    ]),
                );
                // Events are published after the transaction commits
                await new Promise(resolve => setTimeout(resolve, 500));

                // The only shortfall is on Order B's line, so the event carrying that
                // shortfall must reference Order B.
                const shortfallEvent = events.find(e =>
                    e.shortfalls.some(s => String(s.orderLineId) === rawId(orderB.lines[0].id)),
                );
                expect(shortfallEvent).toBeDefined();
                expect(shortfallEvent!.order.code).toBe(orderB.code);
            } finally {
                subscription.unsubscribe();
            }
        });
    });

    // OSS-94: service methods must remain callable with a RequestContext that is not
    // bound to a transaction (job-queue processors and scripts do this). A pessimistic
    // lock outside a transaction makes TypeORM throw PessimisticLockTransactionRequiredError.
    describe('allocation outside a transaction', () => {
        it('createAllocationsForOrderLines works with a non-transactional context', async () => {
            const variantId = 'T_2'; // Laptop 15 inch 8GB
            const product = await getProductWithStockMovement('T_1');
            const variant = product!.variants.find(v => v.id === variantId)!;
            await adminClient.query(updateProductVariantsDocument, {
                input: [
                    {
                        id: variantId,
                        stockOnHand: variant.stockAllocated + 10,
                        trackInventory: GlobalFlag.TRUE,
                    },
                ],
            });

            await shopClient.asUserWithCredentials('marques.sawayn@hotmail.com', 'test');
            const { addItemToOrder: order } = await shopClient.query(addItemToOrderDocument, {
                productVariantId: variantId,
                quantity: 1,
            });
            orderGuard.assertSuccess(order);

            const stockMovementService = server.app.get(StockMovementService);
            const requestContextService = server.app.get(RequestContextService);
            const ctx = await requestContextService.create({ apiType: 'admin' });

            await expect(
                stockMovementService.createAllocationsForOrderLines(ctx, [
                    { orderLineId: order.lines[0].id.replace(/^T_/, ''), quantity: 1 },
                ]),
            ).resolves.toBeDefined();
        });
    });
});

const updateStockOnHandDocument = graphql(
    `
        mutation UpdateStock($input: [UpdateProductVariantInput!]!) {
            updateProductVariants(input: $input) {
                ...VariantWithStock
            }
        }
    `,
    [variantWithStockFragment],
);

export const transitionFulfillmentToStateDocument = graphql(`
    mutation TransitionFulfillmentToState($id: ID!, $state: String!) {
        transitionFulfillmentToState(id: $id, state: $state) {
            ... on Fulfillment {
                id
                state
                nextStates
                createdAt
            }
            ... on ErrorResult {
                errorCode
                message
            }
            ... on FulfillmentStateTransitionError {
                transitionError
            }
        }
    }
`);

export const updateOrderCustomFieldsDocument = graphqlShop(`
    mutation UpdateOrderCustomFields($input: UpdateOrderInput!) {
        setOrderCustomFields(input: $input) {
            ... on Order {
                id
            }
        }
    }
`);
