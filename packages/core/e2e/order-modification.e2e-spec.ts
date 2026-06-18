/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
    ErrorCode,
    ErrorResult,
    GlobalFlag,
    HistoryEntryType,
    LanguageCode,
} from '@vendure/common/lib/generated-types';
import { omit } from '@vendure/common/lib/omit';
import { pick } from '@vendure/common/lib/pick';
import { summate } from '@vendure/common/lib/shared-utils';
import {
    defaultShippingCalculator,
    defaultShippingEligibilityChecker,
    freeShipping,
    mergeConfig,
    minimumOrderAmount,
    Order,
    OrderItemPriceCalculationStrategy,
    orderPercentageDiscount,
    PriceCalculationResult,
    productsPercentageDiscount,
    ProductVariant,
    RequestContext,
    ShippingCalculator,
} from '@vendure/core';
import { createErrorResultGuard, createTestEnvironment, ErrorResultGuard } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { manualFulfillmentHandler } from '../src/config/fulfillment/manual-fulfillment-handler';
import { orderFixedDiscount } from '../src/config/promotion/actions/order-fixed-discount-action';

import {
    failsToSettlePaymentMethod,
    testFailingPaymentMethod,
    testSuccessfulPaymentMethod,
} from './fixtures/test-payment-methods';
import {
    orderFragment,
    orderWithLinesFragment,
    orderWithModificationsFragment,
} from './graphql/fragments-admin';
import { graphql as adminGraphql, FragmentOf } from './graphql/graphql-admin';
import { graphql, VariablesOf } from './graphql/graphql-shop';
import {
    addManualPaymentToOrderDocument,
    adminTransitionToStateDocument,
    createFulfillmentDocument,
    createPromotionDocument,
    createShippingMethodDocument,
    deletePromotionDocument,
    getOrderDocument,
    getOrderHistoryDocument,
    getOrderWithCustomFieldsDocument,
    getOrderWithModificationsDocument,
    getProductVariantListDocument,
    getStockMovementDocument,
    modifyOrderDocument,
    updateChannelDocument,
    updateProductVariantsDocument,
} from './graphql/shared-definitions';
import {
    applyCouponCodeDocument,
    setShippingAddressDocument,
    setShippingMethodDocument,
    testOrderWithPaymentsFragment,
    transitionToStateDocument,
} from './graphql/shop-definitions';
import { addPaymentToOrder, proceedToArrangingPayment, sortById } from './utils/test-order-utils';

const addItemToOrderWithCustomFieldsDocument = graphql(`
    mutation AddItemToOrder(
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
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`);

// Local document with extended refund fields for testing
const modifyOrderForTestDocument = adminGraphql(`
    mutation ModifyOrderForTest($input: ModifyOrderInput!) {
        modifyOrder(input: $input) {
            ... on Order {
                id
                state
                subTotal
                subTotalWithTax
                shipping
                shippingWithTax
                total
                totalWithTax
                lines {
                    id
                    quantity
                    orderPlacedQuantity
                    linePrice
                    linePriceWithTax
                    unitPriceWithTax
                    discountedLinePriceWithTax
                    proratedLinePriceWithTax
                    proratedUnitPriceWithTax
                    discounts {
                        description
                        amountWithTax
                    }
                    productVariant {
                        id
                        name
                    }
                }
                surcharges {
                    id
                    description
                    sku
                    price
                    priceWithTax
                    taxRate
                }
                payments {
                    id
                    transactionId
                    amount
                    method
                    state
                    nextStates
                    metadata
                    refunds {
                        id
                        total
                        reason
                        state
                        paymentId
                    }
                }
                modifications {
                    id
                    note
                    priceChange
                    isSettled
                    lines {
                        orderLineId
                        quantity
                    }
                    surcharges {
                        id
                    }
                    payment {
                        id
                        state
                        amount
                        method
                    }
                    refund {
                        id
                        state
                        total
                        paymentId
                    }
                }
                promotions {
                    id
                    name
                    couponCode
                }
                discounts {
                    description
                    adjustmentSource
                    amount
                    amountWithTax
                }
                shippingLines {
                    id
                    discountedPriceWithTax
                    shippingMethod {
                        id
                        name
                    }
                }
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`);

export class TestOrderItemPriceCalculationStrategy implements OrderItemPriceCalculationStrategy {
    calculateUnitPrice(
        ctx: RequestContext,
        productVariant: ProductVariant,
        orderLineCustomFields: { [key: string]: any },
        order: Order,
    ): PriceCalculationResult | Promise<PriceCalculationResult> {
        if (orderLineCustomFields.color === 'hotpink') {
            return {
                price: 1337,
                priceIncludesTax: true,
            };
        }
        return {
            price: productVariant.listPrice,
            priceIncludesTax: productVariant.listPriceIncludesTax,
        };
    }
}

const SHIPPING_GB = 500;
const SHIPPING_US = 1000;
const SHIPPING_OTHER = 750;
const testCalculator = new ShippingCalculator({
    code: 'test-calculator',
    description: [{ languageCode: LanguageCode.en, value: 'Has metadata' }],
    args: {
        surcharge: {
            type: 'int',
            defaultValue: 0,
        },
    },
    calculate: (ctx, order, args) => {
        let price: number;
        const surcharge = args.surcharge || 0;
        switch (order.shippingAddress.countryCode) {
            case 'GB':
                price = SHIPPING_GB + surcharge;
                break;
            case 'US':
                price = SHIPPING_US + surcharge;
                break;
            default:
                price = SHIPPING_OTHER + surcharge;
        }
        return {
            price,
            priceIncludesTax: true,
            taxRate: 20,
        };
    },
});

describe('Order modification', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            paymentOptions: {
                paymentMethodHandlers: [
                    testSuccessfulPaymentMethod,
                    failsToSettlePaymentMethod,
                    testFailingPaymentMethod,
                ],
            },
            orderOptions: {
                orderItemPriceCalculationStrategy: new TestOrderItemPriceCalculationStrategy(),
            },
            shippingOptions: {
                shippingCalculators: [defaultShippingCalculator, testCalculator],
            },
            customFields: {
                Order: [{ name: 'points', type: 'int', defaultValue: 0 }],
                OrderLine: [{ name: 'color', type: 'string', nullable: true }],
            },
        }),
    );

    let orderId: string;
    let testShippingMethodId: string;
    let testExpressShippingMethodId: string;

    type OrderFragment = FragmentOf<typeof orderFragment>;
    const orderGuard: ErrorResultGuard<OrderFragment> = createErrorResultGuard(input => !!input.id);

    type OrderWithModificationsFragment = FragmentOf<typeof orderWithModificationsFragment>;
    const orderWithModificationsGuard: ErrorResultGuard<OrderWithModificationsFragment> =
        createErrorResultGuard(input => !!input.id);

    // Type aliases for fragment types
    type OrderWithLinesFragment = FragmentOf<typeof orderWithLinesFragment>;
    type TestOrderWithPaymentsFragment = FragmentOf<typeof testOrderWithPaymentsFragment>;
    type AddItemInput = VariablesOf<typeof addItemToOrderWithCustomFieldsDocument> & { customFields?: any };

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
                        name: failsToSettlePaymentMethod.code,
                        handler: { code: failsToSettlePaymentMethod.code, arguments: [] },
                    },
                    {
                        name: testFailingPaymentMethod.code,
                        handler: { code: testFailingPaymentMethod.code, arguments: [] },
                    },
                ],
            },
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 3,
        });
        await adminClient.asSuperAdmin();

        await adminClient.query(updateProductVariantsDocument, {
            input: [
                {
                    id: 'T_1',
                    trackInventory: GlobalFlag.TRUE,
                },
                {
                    id: 'T_2',
                    trackInventory: GlobalFlag.TRUE,
                },
                {
                    id: 'T_3',
                    trackInventory: GlobalFlag.TRUE,
                },
            ],
        });

        const { createShippingMethod } = await adminClient.query(createShippingMethodDocument, {
            input: {
                code: 'new-method',
                fulfillmentHandler: manualFulfillmentHandler.code,
                checker: {
                    code: defaultShippingEligibilityChecker.code,
                    arguments: [
                        {
                            name: 'orderMinimum',
                            value: '0',
                        },
                    ],
                },
                calculator: {
                    code: testCalculator.code,
                    arguments: [],
                },
                translations: [{ languageCode: LanguageCode.en, name: 'test method', description: '' }],
            },
        });
        testShippingMethodId = createShippingMethod.id;

        const { createShippingMethod: shippingMethod2 } = await adminClient.query(
            createShippingMethodDocument,
            {
                input: {
                    code: 'new-method-express',
                    fulfillmentHandler: manualFulfillmentHandler.code,
                    checker: {
                        code: defaultShippingEligibilityChecker.code,
                        arguments: [
                            {
                                name: 'orderMinimum',
                                value: '0',
                            },
                        ],
                    },
                    calculator: {
                        code: testCalculator.code,
                        arguments: [
                            {
                                name: 'surcharge',
                                value: '500',
                            },
                        ],
                    },
                    translations: [
                        { languageCode: LanguageCode.en, name: 'test method express', description: '' },
                    ],
                },
            },
        );
        testExpressShippingMethodId = shippingMethod2.id;

        // create an order and check out
        await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
        await shopClient.query(addItemToOrderWithCustomFieldsDocument, {
            productVariantId: 'T_1',
            quantity: 1,
            customFields: {
                color: 'green',
            },
        });
        await shopClient.query(addItemToOrderWithCustomFieldsDocument, {
            productVariantId: 'T_4',
            quantity: 2,
        });
        await proceedToArrangingPayment(shopClient);
        const result = await addPaymentToOrder(shopClient, testSuccessfulPaymentMethod);
        orderGuard.assertSuccess(result);
        orderId = result.id;
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('modifyOrder returns error result when not in Modifying state', async () => {
        const { order } = await adminClient.query(getOrderDocument, {
            id: orderId,
        });
        const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
            input: {
                dryRun: false,
                orderId,
                adjustOrderLines: order!.lines.map(l => ({ orderLineId: l.id, quantity: 3 })),
            },
        });

        orderWithModificationsGuard.assertErrorResult(modifyOrder);
        expect(modifyOrder.errorCode).toBe(ErrorCode.ORDER_MODIFICATION_STATE_ERROR);
    });

    it('transition to Modifying state', async () => {
        const transitionOrderToState = await adminTransitionOrderToState(orderId, 'Modifying');
        orderGuard.assertSuccess(transitionOrderToState);

        expect(transitionOrderToState.state).toBe('Modifying');
    });

    describe('error cases', () => {
        it('no changes specified error', async () => {
            const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                input: {
                    dryRun: false,
                    orderId,
                },
            });

            orderWithModificationsGuard.assertErrorResult(modifyOrder);

            expect(modifyOrder.errorCode).toBe(ErrorCode.NO_CHANGES_SPECIFIED_ERROR);
        });

        it('no refund paymentId specified', async () => {
            const { order } = await adminClient.query(getOrderDocument, {
                id: orderId,
            });
            const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                input: {
                    dryRun: false,
                    orderId,
                    surcharges: [{ price: -500, priceIncludesTax: true, description: 'Discount' }],
                },
            });
            orderWithModificationsGuard.assertErrorResult(modifyOrder);

            expect(modifyOrder.errorCode).toBe(ErrorCode.REFUND_PAYMENT_ID_MISSING_ERROR);
            await assertOrderIsUnchanged(order!);
        });

        it('addItems negative quantity', async () => {
            const { order } = await adminClient.query(getOrderDocument, {
                id: orderId,
            });
            const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                input: {
                    dryRun: false,
                    orderId,
                    addItems: [{ productVariantId: 'T_3', quantity: -1 }],
                },
            });
            orderWithModificationsGuard.assertErrorResult(modifyOrder);

            expect(modifyOrder.errorCode).toBe(ErrorCode.NEGATIVE_QUANTITY_ERROR);
            await assertOrderIsUnchanged(order!);
        });

        it('adjustOrderLines negative quantity', async () => {
            const { order } = await adminClient.query(getOrderDocument, {
                id: orderId,
            });
            const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                input: {
                    dryRun: false,
                    orderId,
                    adjustOrderLines: [{ orderLineId: order!.lines[0].id, quantity: -1 }],
                },
            });
            orderWithModificationsGuard.assertErrorResult(modifyOrder);

            expect(modifyOrder.errorCode).toBe(ErrorCode.NEGATIVE_QUANTITY_ERROR);
            await assertOrderIsUnchanged(order!);
        });

        it('addItems insufficient stock', async () => {
            const { order } = await adminClient.query(getOrderDocument, {
                id: orderId,
            });
            const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                input: {
                    dryRun: false,
                    orderId,
                    addItems: [{ productVariantId: 'T_3', quantity: 500 }],
                },
            });
            orderWithModificationsGuard.assertErrorResult(modifyOrder);

            expect(modifyOrder.errorCode).toBe(ErrorCode.INSUFFICIENT_STOCK_ERROR);
            await assertOrderIsUnchanged(order!);
        });

        it('adjustOrderLines insufficient stock', async () => {
            const { order } = await adminClient.query(getOrderDocument, {
                id: orderId,
            });
            const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                input: {
                    dryRun: false,
                    orderId,
                    adjustOrderLines: [{ orderLineId: order!.lines[0].id, quantity: 500 }],
                },
            });
            orderWithModificationsGuard.assertErrorResult(modifyOrder);

            expect(modifyOrder.errorCode).toBe(ErrorCode.INSUFFICIENT_STOCK_ERROR);
            await assertOrderIsUnchanged(order!);
        });

        it('addItems order limit', async () => {
            const { order } = await adminClient.query(getOrderDocument, {
                id: orderId,
            });
            const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                input: {
                    dryRun: false,
                    orderId,
                    addItems: [{ productVariantId: 'T_4', quantity: 9999 }],
                },
            });
            orderWithModificationsGuard.assertErrorResult(modifyOrder);

            expect(modifyOrder.errorCode).toBe(ErrorCode.ORDER_LIMIT_ERROR);
            await assertOrderIsUnchanged(order!);
        });

        it('adjustOrderLines order limit', async () => {
            const { order } = await adminClient.query(getOrderDocument, {
                id: orderId,
            });
            const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                input: {
                    dryRun: false,
                    orderId,
                    adjustOrderLines: [{ orderLineId: order!.lines[1].id, quantity: 9999 }],
                },
            });
            orderWithModificationsGuard.assertErrorResult(modifyOrder);

            expect(modifyOrder.errorCode).toBe(ErrorCode.ORDER_LIMIT_ERROR);
            await assertOrderIsUnchanged(order!);
        });
    });

    describe('dry run', () => {
        it('addItems', async () => {
            const { order } = await adminClient.query(getOrderDocument, {
                id: orderId,
            });
            const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                input: {
                    dryRun: true,
                    orderId,
                    addItems: [{ productVariantId: 'T_5', quantity: 1 }],
                },
            });
            orderWithModificationsGuard.assertSuccess(modifyOrder);

            const expectedTotal = order!.totalWithTax + Math.round(14374 * 1.2); // price of variant T_5
            expect(modifyOrder.totalWithTax).toBe(expectedTotal);
            expect(modifyOrder.lines.length).toBe(order!.lines.length + 1);
            await assertOrderIsUnchanged(order!);
        });

        it('addItems with existing variant id increments existing OrderLine', async () => {
            const { order } = await adminClient.query(getOrderDocument, {
                id: orderId,
            });
            const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                input: {
                    dryRun: true,
                    orderId,
                    addItems: [
                        { productVariantId: 'T_1', quantity: 1, customFields: { color: 'green' } } as any,
                    ],
                },
            });
            orderWithModificationsGuard.assertSuccess(modifyOrder);

            const lineT1 = modifyOrder.lines.find(l => l.productVariant.id === 'T_1');
            expect(modifyOrder.lines.length).toBe(2);
            expect(lineT1?.quantity).toBe(2);
            await assertOrderIsUnchanged(order!);
        });

        it('addItems with existing variant id but different customFields adds new OrderLine', async () => {
            const { order } = await adminClient.query(getOrderDocument, {
                id: orderId,
            });
            const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                input: {
                    dryRun: true,
                    orderId,
                    addItems: [
                        { productVariantId: 'T_1', quantity: 1, customFields: { color: 'blue' } } as any,
                    ],
                },
            });
            orderWithModificationsGuard.assertSuccess(modifyOrder);

            const lineT1 = modifyOrder.lines.find(l => l.productVariant.id === 'T_1');
            expect(modifyOrder.lines.length).toBe(3);
            expect(
                modifyOrder.lines.map(l => ({ variantId: l.productVariant.id, quantity: l.quantity })),
            ).toEqual([
                { variantId: 'T_1', quantity: 1 },
                { variantId: 'T_4', quantity: 2 },
                { variantId: 'T_1', quantity: 1 },
            ]);
            await assertOrderIsUnchanged(order!);
        });

        it('adjustOrderLines up', async () => {
            const { order } = await adminClient.query(getOrderDocument, {
                id: orderId,
            });
            const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                input: {
                    dryRun: true,
                    orderId,
                    adjustOrderLines: [{ orderLineId: order!.lines[0].id, quantity: 3 }],
                },
            });
            orderWithModificationsGuard.assertSuccess(modifyOrder);

            const expectedTotal = order!.totalWithTax + order!.lines[0].unitPriceWithTax * 2;
            expect(modifyOrder.lines[0].quantity).toBe(3);
            expect(modifyOrder.totalWithTax).toBe(expectedTotal);
            await assertOrderIsUnchanged(order!);
        });

        it('adjustOrderLines down', async () => {
            const { order } = await adminClient.query(getOrderDocument, {
                id: orderId,
            });
            const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                input: {
                    dryRun: true,
                    orderId,
                    adjustOrderLines: [{ orderLineId: order!.lines[1].id, quantity: 1 }],
                },
            });
            orderWithModificationsGuard.assertSuccess(modifyOrder);

            const expectedTotal = order!.totalWithTax - order!.lines[1].unitPriceWithTax;
            expect(modifyOrder.lines[1].quantity).toBe(1);
            expect(modifyOrder.totalWithTax).toBe(expectedTotal);
            await assertOrderIsUnchanged(order!);
        });

        it('adjustOrderLines to zero', async () => {
            const { order } = await adminClient.query(getOrderDocument, {
                id: orderId,
            });
            const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                input: {
                    dryRun: true,
                    orderId,
                    adjustOrderLines: [{ orderLineId: order!.lines[0].id, quantity: 0 }],
                },
            });
            orderWithModificationsGuard.assertSuccess(modifyOrder);

            const expectedTotal =
                order!.totalWithTax - order!.lines[0].unitPriceWithTax * order!.lines[0].quantity;
            expect(modifyOrder.totalWithTax).toBe(expectedTotal);
            expect(modifyOrder.lines[0].quantity).toBe(0);
            await assertOrderIsUnchanged(order!);
        });

        it('surcharge positive', async () => {
            const { order } = await adminClient.query(getOrderDocument, {
                id: orderId,
            });
            const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                input: {
                    dryRun: true,
                    orderId,
                    surcharges: [
                        {
                            description: 'extra fee',
                            sku: '123',
                            price: 300,
                            priceIncludesTax: true,
                            taxRate: 20,
                            taxDescription: 'VAT',
                        },
                    ],
                },
            });
            orderWithModificationsGuard.assertSuccess(modifyOrder);

            const expectedTotal = order!.totalWithTax + 300;
            expect(modifyOrder.totalWithTax).toBe(expectedTotal);
            expect(modifyOrder.surcharges.map(s => omit(s, ['id']))).toEqual([
                {
                    description: 'extra fee',
                    sku: '123',
                    price: 250,
                    priceWithTax: 300,
                    taxRate: 20,
                },
            ]);
            await assertOrderIsUnchanged(order!);
        });

        it('surcharge negative', async () => {
            const { order } = await adminClient.query(getOrderDocument, {
                id: orderId,
            });
            const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                input: {
                    dryRun: true,
                    orderId,
                    surcharges: [
                        {
                            description: 'special discount',
                            sku: '123',
                            price: -300,
                            priceIncludesTax: true,
                            taxRate: 20,
                            taxDescription: 'VAT',
                        },
                    ],
                },
            });
            orderWithModificationsGuard.assertSuccess(modifyOrder);

            const expectedTotal = order!.totalWithTax + -300;
            expect(modifyOrder.totalWithTax).toBe(expectedTotal);
            expect(modifyOrder.surcharges.map(s => omit(s, ['id']))).toEqual([
                {
                    description: 'special discount',
                    sku: '123',
                    price: -250,
                    priceWithTax: -300,
                    taxRate: 20,
                },
            ]);
            await assertOrderIsUnchanged(order!);
        });

        it('the configured OrderItemPriceCalculationStrategy is applied', async () => {
            const { order } = await adminClient.query(getOrderDocument, {
                id: orderId,
            });
            const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                input: {
                    dryRun: true,
                    orderId,
                    adjustOrderLines: [
                        {
                            orderLineId: order!.lines[1].id,
                            quantity: 1,
                            customFields: { color: 'hotpink' },
                        } as any,
                    ],
                },
            });
            orderWithModificationsGuard.assertSuccess(modifyOrder);

            const expectedTotal = order!.totalWithTax - order!.lines[1].unitPriceWithTax;
            expect(modifyOrder.lines[1].quantity).toBe(1);
            expect(modifyOrder.lines[1].linePriceWithTax).toBe(1337);
            await assertOrderIsUnchanged(order!);
        });

        it('changing shipping method', async () => {
            const { order } = await adminClient.query(getOrderDocument, {
                id: orderId,
            });
            const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                input: {
                    dryRun: true,
                    orderId,
                    shippingMethodIds: [testExpressShippingMethodId],
                },
            });
            orderWithModificationsGuard.assertSuccess(modifyOrder);

            const expectedTotal = order!.totalWithTax + 500;
            expect(modifyOrder.totalWithTax).toBe(expectedTotal);
            expect(modifyOrder.shippingLines).toEqual([
                {
                    id: 'T_1',
                    discountedPriceWithTax: 1500,
                    shippingMethod: {
                        id: testExpressShippingMethodId,
                        name: 'test method express',
                    },
                },
            ]);
            await assertOrderIsUnchanged(order!);
        });

        it('does not add a history entry', async () => {
            const { order } = await adminClient.query(getOrderDocument, {
                id: orderId,
            });
            const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                input: {
                    dryRun: true,
                    orderId,
                    addItems: [{ productVariantId: 'T_5', quantity: 1 }],
                },
            });
            orderWithModificationsGuard.assertSuccess(modifyOrder);

            const { order: history } = await adminClient.query(getOrderHistoryDocument, {
                id: orderId,
                options: { filter: { type: { eq: HistoryEntryType.ORDER_MODIFIED } } },
            });
            if (!history) {
                throw new Error('History not found');
            }
            orderGuard.assertSuccess(history);

            expect(history.history.totalItems).toBe(0);
        });
    });

    describe('wet run', () => {
        async function assertModifiedOrderIsPersisted(order: OrderWithModificationsFragment) {
            const { order: order2 } = await adminClient.query(getOrderDocument, {
                id: order.id,
            });
            expect(order2!.totalWithTax).toBe(order.totalWithTax);
            expect(order2!.lines.length).toBe(order.lines.length);
            expect(order2!.surcharges.length).toBe(order.surcharges.length);
            expect(order2!.payments!.length).toBe(order.payments!.length);
            expect(order2!.payments!.map(p => pick(p, ['id', 'amount', 'method']))).toEqual(
                order.payments!.map(p => pick(p, ['id', 'amount', 'method'])),
            );
        }

        it('addItems', async () => {
            const order = await createOrderAndTransitionToModifyingState([
                {
                    productVariantId: 'T_1',
                    quantity: 1,
                },
            ]);
            const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                input: {
                    dryRun: false,
                    orderId: order.id,
                    addItems: [{ productVariantId: 'T_5', quantity: 1 }],
                },
            });
            orderWithModificationsGuard.assertSuccess(modifyOrder);

            const priceDelta = Math.round(14374 * 1.2); // price of variant T_5
            const expectedTotal = order.totalWithTax + priceDelta;
            expect(modifyOrder.totalWithTax).toBe(expectedTotal);
            expect(modifyOrder.lines.length).toBe(order.lines.length + 1);
            expect(modifyOrder.modifications.length).toBe(1);
            expect(modifyOrder.modifications[0].priceChange).toBe(priceDelta);
            expect(modifyOrder.modifications[0].lines.length).toBe(1);
            expect(modifyOrder.modifications[0].lines).toEqual([
                { orderLineId: modifyOrder.lines[1].id, quantity: 1 },
            ]);

            await assertModifiedOrderIsPersisted(modifyOrder);
        });

        it('adjustOrderLines up', async () => {
            const order = await createOrderAndTransitionToModifyingState([
                {
                    productVariantId: 'T_1',
                    quantity: 1,
                },
            ]);
            const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                input: {
                    dryRun: false,
                    orderId: order.id,
                    adjustOrderLines: [{ orderLineId: order.lines[0].id, quantity: 2 }],
                },
            });
            orderWithModificationsGuard.assertSuccess(modifyOrder);

            const priceDelta = order.lines[0].unitPriceWithTax;
            const expectedTotal = order.totalWithTax + priceDelta;
            expect(modifyOrder.totalWithTax).toBe(expectedTotal);
            expect(modifyOrder.lines[0].quantity).toBe(2);
            expect(modifyOrder.modifications.length).toBe(1);
            expect(modifyOrder.modifications[0].priceChange).toBe(priceDelta);
            expect(modifyOrder.modifications[0].lines.length).toBe(1);
            expect(modifyOrder.lines[0].id).toEqual(modifyOrder.modifications[0].lines[0].orderLineId);
            await assertModifiedOrderIsPersisted(modifyOrder);
        });

        it('adjustOrderLines down', async () => {
            const order = await createOrderAndTransitionToModifyingState([
                {
                    productVariantId: 'T_1',
                    quantity: 2,
                },
            ]);
            const { modifyOrder } = await adminClient.query(modifyOrderForTestDocument, {
                input: {
                    dryRun: false,
                    orderId: order.id,
                    adjustOrderLines: [{ orderLineId: order.lines[0].id, quantity: 1 }],
                    refund: { paymentId: order.payments![0].id },
                },
            });
            orderWithModificationsGuard.assertSuccess(modifyOrder);

            const priceDelta = -order.lines[0].unitPriceWithTax;
            const expectedTotal = order.totalWithTax + priceDelta;
            expect(modifyOrder.totalWithTax).toBe(expectedTotal);
            expect(modifyOrder.lines[0].quantity).toBe(1);
            expect(modifyOrder.payments?.length).toBe(1);
            expect(modifyOrder.payments?.[0].refunds.length).toBe(1);
            expect(modifyOrder.payments?.[0].refunds[0]).toEqual({
                id: 'T_1',
                state: 'Pending',
                total: -priceDelta,
                paymentId: modifyOrder.payments?.[0].id,
                reason: null,
            });
            expect(modifyOrder.modifications.length).toBe(1);
            expect(modifyOrder.modifications[0].priceChange).toBe(priceDelta);
            expect(modifyOrder.modifications[0].surcharges).toEqual(modifyOrder.surcharges.map(pick(['id'])));
            expect(modifyOrder.modifications[0].lines.length).toBe(1);
            expect(modifyOrder.lines[0].id).toEqual(modifyOrder.modifications[0].lines[0].orderLineId);
            await assertModifiedOrderIsPersisted(modifyOrder);
        });

        it('adjustOrderLines with changed customField value', async () => {
            const order = await createOrderAndTransitionToModifyingState([
                {
                    productVariantId: 'T_1',
                    quantity: 1,
                    customFields: {
                        color: 'green',
                    } as any,
                },
            ]);
            const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                input: {
                    dryRun: false,
                    orderId: order.id,
                    adjustOrderLines: [
                        {
                            orderLineId: order.lines[0].id,
                            quantity: 1,
                            customFields: { color: 'black' },
                        } as any,
                    ],
                },
            });
            orderWithModificationsGuard.assertSuccess(modifyOrder);
            expect(modifyOrder.lines.length).toBe(1);

            const { order: orderWithLines } = await adminClient.query(getOrderWithCustomFieldsDocument, {
                id: order.id,
            });
            if (!orderWithLines) {
                throw new Error('Order with lines not found');
            }
            expect(orderWithLines.lines[0]).toEqual({
                id: order.lines[0].id,
                customFields: { color: 'black' },
            });
        });

        it('adjustOrderLines handles quantity correctly', async () => {
            await adminClient.query(updateProductVariantsDocument, {
                input: [
                    {
                        id: 'T_6',
                        stockOnHand: 1,
                        trackInventory: GlobalFlag.TRUE,
                    },
                ],
            });
            const order = await createOrderAndTransitionToModifyingState([
                {
                    productVariantId: 'T_6',
                    quantity: 1,
                },
            ]);
            const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                input: {
                    dryRun: false,
                    orderId: order.id,
                    adjustOrderLines: [
                        {
                            orderLineId: order.lines[0].id,
                            quantity: 1,
                        },
                    ],
                    updateShippingAddress: {
                        fullName: 'Jim',
                    },
                },
            });
            orderWithModificationsGuard.assertSuccess(modifyOrder);
        });

        it('surcharge positive', async () => {
            const order = await createOrderAndTransitionToModifyingState([
                {
                    productVariantId: 'T_1',
                    quantity: 1,
                },
            ]);
            const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                input: {
                    dryRun: false,
                    orderId: order.id,
                    surcharges: [
                        {
                            description: 'extra fee',
                            sku: '123',
                            price: 300,
                            priceIncludesTax: true,
                            taxRate: 20,
                            taxDescription: 'VAT',
                        },
                    ],
                },
            });
            orderWithModificationsGuard.assertSuccess(modifyOrder);

            const priceDelta = 300;
            const expectedTotal = order.totalWithTax + priceDelta;
            expect(modifyOrder.totalWithTax).toBe(expectedTotal);
            expect(modifyOrder.surcharges.map(s => omit(s, ['id']))).toEqual([
                {
                    description: 'extra fee',
                    sku: '123',
                    price: 250,
                    priceWithTax: 300,
                    taxRate: 20,
                },
            ]);
            expect(modifyOrder.modifications.length).toBe(1);
            expect(modifyOrder.modifications[0].priceChange).toBe(priceDelta);
            expect(modifyOrder.modifications[0].surcharges).toEqual(modifyOrder.surcharges.map(pick(['id'])));
            await assertModifiedOrderIsPersisted(modifyOrder);
        });

        it('surcharge negative', async () => {
            const order = await createOrderAndTransitionToModifyingState([
                {
                    productVariantId: 'T_1',
                    quantity: 1,
                },
            ]);
            const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                input: {
                    dryRun: false,
                    orderId: order.id,
                    surcharges: [
                        {
                            description: 'special discount',
                            sku: '123',
                            price: -300,
                            priceIncludesTax: true,
                            taxRate: 20,
                            taxDescription: 'VAT',
                        },
                    ],
                    refund: {
                        paymentId: order.payments![0].id,
                    },
                },
            });
            orderWithModificationsGuard.assertSuccess(modifyOrder);

            const expectedTotal = order.totalWithTax + -300;
            expect(modifyOrder.totalWithTax).toBe(expectedTotal);
            expect(modifyOrder.surcharges.map(s => omit(s, ['id']))).toEqual([
                {
                    description: 'special discount',
                    sku: '123',
                    price: -250,
                    priceWithTax: -300,
                    taxRate: 20,
                },
            ]);
            expect(modifyOrder.modifications.length).toBe(1);
            expect(modifyOrder.modifications[0].priceChange).toBe(-300);
            await assertModifiedOrderIsPersisted(modifyOrder);
        });

        it('update updateShippingAddress, recalculate shipping', async () => {
            const order = await createOrderAndTransitionToModifyingState([
                {
                    productVariantId: 'T_1',
                    quantity: 1,
                },
            ]);

            const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                input: {
                    dryRun: false,
                    orderId: order.id,
                    updateShippingAddress: {
                        countryCode: 'US',
                    },
                    options: {
                        recalculateShipping: true,
                    },
                },
            });
            orderWithModificationsGuard.assertSuccess(modifyOrder);

            const priceDelta = SHIPPING_US - SHIPPING_OTHER;
            const expectedTotal = order.totalWithTax + priceDelta;
            expect(modifyOrder.totalWithTax).toBe(expectedTotal);
            expect(modifyOrder.shippingAddress?.countryCode).toBe('US');
            expect(modifyOrder.modifications.length).toBe(1);
            expect(modifyOrder.modifications[0].priceChange).toBe(priceDelta);
            await assertModifiedOrderIsPersisted(modifyOrder);
        });

        it('update updateShippingAddress, do not recalculate shipping', async () => {
            const order = await createOrderAndTransitionToModifyingState([
                {
                    productVariantId: 'T_1',
                    quantity: 1,
                },
            ]);

            const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                input: {
                    dryRun: false,
                    orderId: order.id,
                    updateShippingAddress: {
                        countryCode: 'US',
                    },
                    options: {
                        recalculateShipping: false,
                    },
                },
            });
            orderWithModificationsGuard.assertSuccess(modifyOrder);

            const priceDelta = 0;
            const expectedTotal = order.totalWithTax + priceDelta;
            expect(modifyOrder.totalWithTax).toBe(expectedTotal);
            expect(modifyOrder.shippingAddress?.countryCode).toBe('US');
            expect(modifyOrder.modifications.length).toBe(1);
            expect(modifyOrder.modifications[0].priceChange).toBe(priceDelta);
            await assertModifiedOrderIsPersisted(modifyOrder);
        });

        it('update Order customFields', async () => {
            const order = await createOrderAndTransitionToModifyingState([
                {
                    productVariantId: 'T_1',
                    quantity: 1,
                },
            ]);
            const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                input: {
                    dryRun: false,
                    orderId: order.id,
                    customFields: {
                        points: 42,
                    },
                } as any,
            });
            orderWithModificationsGuard.assertSuccess(modifyOrder);

            const { order: orderWithCustomFields } = await adminClient.query(
                getOrderWithCustomFieldsDocument,
                {
                    id: order.id,
                },
            );
            if (!orderWithCustomFields) {
                throw new Error('Order with custom fields not found');
            }
            expect(orderWithCustomFields.customFields).toEqual({
                points: 42,
            });
        });

        it('adds a history entry', async () => {
            const { order } = await adminClient.query(getOrderDocument, {
                id: orderId,
            });
            const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                input: {
                    dryRun: false,
                    orderId: order!.id,
                    addItems: [{ productVariantId: 'T_5', quantity: 1 }],
                },
            });
            orderWithModificationsGuard.assertSuccess(modifyOrder);

            const { order: history } = await adminClient.query(getOrderHistoryDocument, {
                id: orderId,
                options: { filter: { type: { eq: HistoryEntryType.ORDER_MODIFIED } } },
            });
            if (!history) {
                throw new Error('History not found');
            }
            orderGuard.assertSuccess(history);

            expect(history.history.totalItems).toBe(1);
            expect(history.history.items[0].data).toEqual({
                modificationId: modifyOrder.modifications[0].id,
            });
        });
    });

    describe('additional payment handling', () => {
        let orderId2: string;

        beforeAll(async () => {
            const order = await createOrderAndTransitionToModifyingState([
                {
                    productVariantId: 'T_1',
                    quantity: 1,
                },
            ]);
            const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                input: {
                    dryRun: false,
                    orderId: order.id,
                    surcharges: [
                        {
                            description: 'extra fee',
                            sku: '123',
                            price: 300,
                            priceIncludesTax: true,
                            taxRate: 20,
                            taxDescription: 'VAT',
                        },
                    ],
                },
            });
            orderWithModificationsGuard.assertSuccess(modifyOrder);
            orderId2 = modifyOrder.id;
        });

        it('cannot transition back to original state if no payment is set', async () => {
            const transitionOrderToState = await adminTransitionOrderToState(orderId2, 'PaymentSettled');
            orderGuard.assertErrorResult(transitionOrderToState);
            expect(transitionOrderToState.errorCode).toBe(ErrorCode.ORDER_STATE_TRANSITION_ERROR);
            expect((transitionOrderToState as any).transitionError).toBe(
                'Can only transition to the "ArrangingAdditionalPayment" state',
            );
        });

        it('can transition to ArrangingAdditionalPayment state', async () => {
            const transitionOrderToState = await adminTransitionOrderToState(
                orderId2,
                'ArrangingAdditionalPayment',
            );
            orderGuard.assertSuccess(transitionOrderToState);
            expect(transitionOrderToState.state).toBe('ArrangingAdditionalPayment');
        });

        it('cannot transition from ArrangingAdditionalPayment when total not covered by Payments', async () => {
            const transitionOrderToState = await adminTransitionOrderToState(orderId2, 'PaymentSettled');
            orderGuard.assertErrorResult(transitionOrderToState);
            expect(transitionOrderToState.errorCode).toBe(ErrorCode.ORDER_STATE_TRANSITION_ERROR);
            expect((transitionOrderToState as any).transitionError).toBe(
                'Cannot transition away from "ArrangingAdditionalPayment" unless Order total is covered by Payments',
            );
        });

        it('addManualPaymentToOrder', async () => {
            const { addManualPaymentToOrder } = await adminClient.query(addManualPaymentToOrderDocument, {
                input: {
                    orderId: orderId2,
                    method: 'test',
                    transactionId: 'ABC123',
                    metadata: {
                        foo: 'bar',
                    },
                },
            });
            orderWithModificationsGuard.assertSuccess(addManualPaymentToOrder);

            expect(addManualPaymentToOrder.payments?.length).toBe(2);
            expect(omit(addManualPaymentToOrder.payments![1], ['id'])).toEqual({
                transactionId: 'ABC123',
                state: 'Settled',
                amount: 300,
                method: 'test',
                nextStates: ['Cancelled'],
                metadata: {
                    foo: 'bar',
                },
                refunds: [],
            });
            expect(addManualPaymentToOrder.modifications[0].isSettled).toBe(true);
            expect(addManualPaymentToOrder.modifications[0].payment?.id).toBe(
                addManualPaymentToOrder.payments![1].id,
            );
        });

        it('transition back to original state', async () => {
            const transitionOrderToState = await adminTransitionOrderToState(orderId2, 'PaymentSettled');
            orderGuard.assertSuccess(transitionOrderToState);

            expect(transitionOrderToState.state).toBe('PaymentSettled');
        });
    });

    describe('refund handling', () => {
        let orderId3: string;

        beforeAll(async () => {
            const order = await createOrderAndTransitionToModifyingState([
                {
                    productVariantId: 'T_1',
                    quantity: 1,
                },
            ]);
            const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                input: {
                    dryRun: false,
                    orderId: order.id,
                    surcharges: [
                        {
                            description: 'discount',
                            sku: '123',
                            price: -300,
                            priceIncludesTax: true,
                            taxRate: 20,
                            taxDescription: 'VAT',
                        },
                    ],
                    refund: {
                        paymentId: order.payments![0].id,
                        reason: 'discount',
                    },
                },
            });
            orderWithModificationsGuard.assertSuccess(modifyOrder);
            orderId3 = modifyOrder.id;
        });

        it('modification is settled', async () => {
            const { order } = await adminClient.query(getOrderWithModificationsDocument, { id: orderId3 });

            expect(order?.modifications.length).toBe(1);
            expect(order?.modifications[0].isSettled).toBe(true);
        });

        it('cannot transition to ArrangingAdditionalPayment state if no payment is needed', async () => {
            const transitionOrderToState = await adminTransitionOrderToState(
                orderId3,
                'ArrangingAdditionalPayment',
            );
            orderGuard.assertErrorResult(transitionOrderToState);
            expect(transitionOrderToState.errorCode).toBe(ErrorCode.ORDER_STATE_TRANSITION_ERROR);
            expect((transitionOrderToState as any).transitionError).toBe(
                'Cannot transition Order to the "ArrangingAdditionalPayment" state as no additional payments are needed',
            );
        });

        it('can transition to original state', async () => {
            const transitionOrderToState = await adminTransitionOrderToState(orderId3, 'PaymentSettled');
            orderGuard.assertSuccess(transitionOrderToState);
            expect(transitionOrderToState.state).toBe('PaymentSettled');

            const { order } = await adminClient.query(getOrderDocument, {
                id: orderId3,
            });
            if (!order) {
                throw new Error('Order not found');
            }
            expect(order.payments![0].refunds.length).toBe(1);
            expect(order.payments![0].refunds[0].total).toBe(300);
            expect(order.payments![0].refunds[0].reason).toBe('discount');
        });
    });

    // https://github.com/vendurehq/vendure/issues/1753
    describe('refunds for multiple payments', () => {
        let orderId2: string;
        let orderLineId: string;
        let additionalPaymentId: string;

        beforeAll(async () => {
            await adminClient.query(createPromotionDocument, {
                input: {
                    couponCode: '5OFF',
                    enabled: true,
                    conditions: [],
                    actions: [
                        {
                            code: orderFixedDiscount.code,
                            arguments: [{ name: 'discount', value: '500' }],
                        },
                    ],
                    translations: [{ languageCode: LanguageCode.en, name: '$5 off' }],
                },
            });
            await shopClient.asUserWithCredentials('trevor_donnelly96@hotmail.com', 'test');
            await shopClient.query(addItemToOrderWithCustomFieldsDocument, {
                productVariantId: 'T_5',
                quantity: 1,
            } as any);
            await proceedToArrangingPayment(shopClient);
            const order = await addPaymentToOrder(shopClient, testSuccessfulPaymentMethod);
            orderGuard.assertSuccess(order);
            orderLineId = order.lines[0].id;
            orderId2 = order.id;

            const transitionOrderToState = await adminTransitionOrderToState(orderId2, 'Modifying');
            orderGuard.assertSuccess(transitionOrderToState);
            const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                input: {
                    dryRun: false,
                    orderId: orderId2,
                    adjustOrderLines: [{ orderLineId, quantity: 2 }],
                },
            });
            orderWithModificationsGuard.assertSuccess(modifyOrder);

            await adminTransitionOrderToState(orderId2, 'ArrangingAdditionalPayment');

            const { addManualPaymentToOrder } = await adminClient.query(addManualPaymentToOrderDocument, {
                input: {
                    orderId: orderId2,
                    method: 'test',
                    transactionId: 'ABC123',
                    metadata: {
                        foo: 'bar',
                    },
                },
            });
            orderWithModificationsGuard.assertSuccess(addManualPaymentToOrder);
            additionalPaymentId = addManualPaymentToOrder.payments![1].id!;

            const transitionOrderToState2 = await adminTransitionOrderToState(orderId2, 'PaymentSettled');
            orderGuard.assertSuccess(transitionOrderToState2);

            expect(transitionOrderToState2.state).toBe('PaymentSettled');
        });

        it('apply couponCode to create first refund', async () => {
            const transitionOrderToState = await adminTransitionOrderToState(orderId2, 'Modifying');
            orderGuard.assertSuccess(transitionOrderToState);
            const { modifyOrder } = await adminClient.query(modifyOrderForTestDocument, {
                input: {
                    dryRun: false,
                    orderId: orderId2,
                    couponCodes: ['5OFF'],
                    refund: {
                        paymentId: additionalPaymentId,
                        reason: 'test',
                    },
                },
            });
            orderWithModificationsGuard.assertSuccess(modifyOrder);

            expect(modifyOrder.payments?.length).toBe(2);
            expect(modifyOrder?.payments?.find(p => p.id === additionalPaymentId)?.refunds).toEqual([
                {
                    id: 'T_4',
                    paymentId: additionalPaymentId,
                    state: 'Pending',
                    total: 600,
                    reason: 'test',
                },
            ]);
            expect(modifyOrder.totalWithTax).toBe(getOrderPaymentsTotalWithRefunds(modifyOrder));
        });

        it('reduce quantity to create second refund', async () => {
            const { modifyOrder } = await adminClient.query(modifyOrderForTestDocument, {
                input: {
                    dryRun: false,
                    orderId: orderId2,
                    adjustOrderLines: [{ orderLineId, quantity: 1 }],
                    refund: {
                        paymentId: additionalPaymentId,
                        reason: 'test 2',
                    },
                },
            });
            orderWithModificationsGuard.assertSuccess(modifyOrder);

            expect(
                modifyOrder?.payments?.find(p => p.id === additionalPaymentId)?.refunds.sort(sortById),
            ).toEqual([
                {
                    id: 'T_4',
                    paymentId: additionalPaymentId,
                    state: 'Pending',
                    total: 600,
                    reason: 'test',
                },
                {
                    id: 'T_5',
                    paymentId: additionalPaymentId,
                    state: 'Pending',
                    total: 16649,
                    reason: 'test 2',
                },
            ]);
            // Note: During the big refactor of the OrderItem entity, the "total" value in the following
            // assertion was changed from `300` to `600`. This is due to a change in the way we calculate
            // refunds on pro-rated discounts. Previously, the pro-ration was not recalculated prior to
            // the refund being calculated, so the individual OrderItem had only 1/2 the full order discount
            // applied to it (300). Now, the pro-ration is applied to the single remaining item and therefore the
            // entire discount of 600 gets moved over to the remaining item.
            expect(modifyOrder?.payments?.find(p => p.id !== additionalPaymentId)?.refunds).toEqual([
                {
                    id: 'T_6',
                    paymentId: 'T_15',
                    state: 'Pending',
                    total: 600,
                    reason: 'test 2',
                },
            ]);
            expect(modifyOrder.totalWithTax).toBe(getOrderPaymentsTotalWithRefunds(modifyOrder));
        });
    });

    // https://github.com/vendurehq/vendure/issues/688 - 4th point
    it('correct additional payment when discounts applied', async () => {
        await adminClient.query(createPromotionDocument, {
            input: {
                couponCode: '5OFF',
                enabled: true,
                conditions: [],
                actions: [
                    {
                        code: orderFixedDiscount.code,
                        arguments: [{ name: 'discount', value: '500' }],
                    },
                ],
                translations: [{ languageCode: LanguageCode.en, name: '$5 off' }],
            },
        });

        await shopClient.asUserWithCredentials('trevor_donnelly96@hotmail.com', 'test');
        await shopClient.query(addItemToOrderWithCustomFieldsDocument, {
            productVariantId: 'T_1',
            quantity: 1,
        } as any);
        await shopClient.query(applyCouponCodeDocument, {
            couponCode: '5OFF',
        });
        await proceedToArrangingPayment(shopClient);
        const order = await addPaymentToOrder(shopClient, testSuccessfulPaymentMethod);
        orderGuard.assertSuccess(order);

        const originalTotalWithTax = order.totalWithTax;
        const surcharge = 300;

        const transitionOrderToState = await adminTransitionOrderToState(order.id, 'Modifying');
        orderGuard.assertSuccess(transitionOrderToState);

        expect(transitionOrderToState.state).toBe('Modifying');

        const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
            input: {
                dryRun: false,
                orderId: order.id,
                surcharges: [
                    {
                        description: 'extra fee',
                        sku: '123',
                        price: surcharge,
                        priceIncludesTax: true,
                        taxRate: 20,
                        taxDescription: 'VAT',
                    },
                ],
            },
        });
        orderWithModificationsGuard.assertSuccess(modifyOrder);

        expect(modifyOrder.totalWithTax).toBe(originalTotalWithTax + surcharge);
    });

    // https://github.com/vendurehq/vendure/issues/872
    describe('correct price calculations when prices include tax', () => {
        async function modifyOrderLineQuantity(order: TestOrderWithPaymentsFragment) {
            const transitionOrderToState = await adminTransitionOrderToState(order.id, 'Modifying');
            orderGuard.assertSuccess(transitionOrderToState);

            expect(transitionOrderToState.state).toBe('Modifying');

            const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                input: {
                    dryRun: true,
                    orderId: order.id,
                    adjustOrderLines: [{ orderLineId: order.lines[0].id, quantity: 2 }],
                },
            });
            orderWithModificationsGuard.assertSuccess(modifyOrder);
            return modifyOrder;
        }

        beforeAll(async () => {
            await adminClient.query(updateChannelDocument, {
                input: {
                    id: 'T_1',
                    pricesIncludeTax: true,
                },
            });
        });

        it('without promotion', async () => {
            await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
            await shopClient.query(addItemToOrderWithCustomFieldsDocument, {
                productVariantId: 'T_1',
                quantity: 1,
            } as any);
            await proceedToArrangingPayment(shopClient);
            const order = await addPaymentToOrder(shopClient, testSuccessfulPaymentMethod);
            orderGuard.assertSuccess(order);

            const modifyOrder = await modifyOrderLineQuantity(order);
            expect(modifyOrder.lines[0].linePriceWithTax).toBe(order.lines[0].linePriceWithTax * 2);
        });

        it('with promotion', async () => {
            await adminClient.query(createPromotionDocument, {
                input: {
                    couponCode: 'HALF',
                    enabled: true,
                    conditions: [],
                    actions: [
                        {
                            code: productsPercentageDiscount.code,
                            arguments: [
                                { name: 'discount', value: '50' },
                                { name: 'productVariantIds', value: JSON.stringify(['T_1']) },
                            ],
                        },
                    ],
                    translations: [{ languageCode: LanguageCode.en, name: 'half price' }],
                },
            });
            await shopClient.asUserWithCredentials('trevor_donnelly96@hotmail.com', 'test');
            await shopClient.query(addItemToOrderWithCustomFieldsDocument, {
                productVariantId: 'T_1',
                quantity: 1,
            } as any);
            await shopClient.query(applyCouponCodeDocument, {
                couponCode: 'HALF',
            });
            await proceedToArrangingPayment(shopClient);
            const order = await addPaymentToOrder(shopClient, testSuccessfulPaymentMethod);
            orderGuard.assertSuccess(order);

            const modifyOrder = await modifyOrderLineQuantity(order);

            expect(modifyOrder.lines[0].discountedLinePriceWithTax).toBe(
                modifyOrder.lines[0].linePriceWithTax / 2,
            );
            expect(modifyOrder.lines[0].linePriceWithTax).toBe(order.lines[0].linePriceWithTax * 2);
        });
    });

    describe('refund handling when promotions are active on order', () => {
        // https://github.com/vendurehq/vendure/issues/890
        it('refunds correct amount when order-level promotion applied', async () => {
            await adminClient.query(createPromotionDocument, {
                input: {
                    couponCode: '5OFF2',
                    enabled: true,
                    conditions: [],
                    actions: [
                        {
                            code: orderFixedDiscount.code,
                            arguments: [{ name: 'discount', value: '500' }],
                        },
                    ],
                    translations: [{ languageCode: LanguageCode.en, name: '$5 off' }],
                },
            });

            await shopClient.asUserWithCredentials('trevor_donnelly96@hotmail.com', 'test');
            await shopClient.query(addItemToOrderWithCustomFieldsDocument, {
                productVariantId: 'T_1',
                quantity: 2,
            } as any);
            await shopClient.query(applyCouponCodeDocument, {
                couponCode: '5OFF2',
            });
            await proceedToArrangingPayment(shopClient);
            const order = await addPaymentToOrder(shopClient, testSuccessfulPaymentMethod);
            orderGuard.assertSuccess(order);

            const originalTotalWithTax = order.totalWithTax;
            const transitionOrderToState = await adminTransitionOrderToState(order.id, 'Modifying');
            orderGuard.assertSuccess(transitionOrderToState);

            expect(transitionOrderToState.state).toBe('Modifying');

            const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                input: {
                    dryRun: false,
                    orderId: order.id,
                    adjustOrderLines: [{ orderLineId: order.lines[0].id, quantity: 1 }],
                    refund: {
                        paymentId: order.payments![0].id,
                        reason: 'requested',
                    },
                },
            });
            orderWithModificationsGuard.assertSuccess(modifyOrder);

            expect(modifyOrder.totalWithTax).toBe(
                originalTotalWithTax - order.lines[0].proratedUnitPriceWithTax,
            );
            expect(modifyOrder.payments![0].refunds[0].total).toBe(order.lines[0].proratedUnitPriceWithTax);
            expect(modifyOrder.totalWithTax).toBe(getOrderPaymentsTotalWithRefunds(modifyOrder));
        });

        // https://github.com/vendurehq/vendure/issues/1865
        describe('issue 1865', () => {
            const promoDiscount = 5000;
            let promoId: string;
            let orderId2: string;
            beforeAll(async () => {
                const { createPromotion } = await adminClient.query(createPromotionDocument, {
                    input: {
                        enabled: true,
                        conditions: [
                            {
                                code: minimumOrderAmount.code,
                                arguments: [
                                    { name: 'amount', value: '10000' },
                                    { name: 'taxInclusive', value: 'true' },
                                ],
                            },
                        ],
                        actions: [
                            {
                                code: orderFixedDiscount.code,
                                arguments: [{ name: 'discount', value: JSON.stringify(promoDiscount) }],
                            },
                        ],
                        translations: [{ languageCode: LanguageCode.en, name: '50 off orders over 100' }],
                    },
                });
                promoId = (createPromotion as any).id;
            });

            afterAll(async () => {
                await adminClient.query(deletePromotionDocument, {
                    id: promoId,
                });
            });

            it('refund handling when order-level promotion becomes invalid on modification', async () => {
                const { productVariants } = await adminClient.query(getProductVariantListDocument, {
                    options: {
                        filter: {
                            name: { contains: 'football' },
                        },
                    },
                });
                const football = productVariants.items[0];

                await shopClient.query(addItemToOrderWithCustomFieldsDocument, {
                    productVariantId: football.id,
                    quantity: 2,
                } as any);
                await proceedToArrangingPayment(shopClient);
                const order = await addPaymentToOrder(shopClient, testSuccessfulPaymentMethod);
                orderGuard.assertSuccess(order);
                orderId2 = order.id;

                expect(order.discounts.length).toBe(1);
                expect(order.discounts[0].amountWithTax).toBe(-promoDiscount);
                const shippingPrice = order.shippingWithTax;
                const expectedTotal = football.priceWithTax * 2 + shippingPrice - promoDiscount;
                expect(order.totalWithTax).toBe(expectedTotal);

                const originalTotalWithTax = order.totalWithTax;

                const transitionOrderToState = await adminTransitionOrderToState(order.id, 'Modifying');
                orderGuard.assertSuccess(transitionOrderToState);

                expect(transitionOrderToState.state).toBe('Modifying');

                const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                    input: {
                        dryRun: false,
                        orderId: order.id,
                        adjustOrderLines: [{ orderLineId: order.lines[0].id, quantity: 1 }],
                        refund: {
                            paymentId: order.payments![0].id,
                            reason: 'requested',
                        },
                    },
                });
                orderWithModificationsGuard.assertSuccess(modifyOrder);

                const expectedNewTotal = order.lines[0].unitPriceWithTax + shippingPrice;
                expect(modifyOrder.totalWithTax).toBe(expectedNewTotal);
                expect(modifyOrder.payments![0].refunds[0].total).toBe(expectedTotal - expectedNewTotal);
                expect(modifyOrder.totalWithTax).toBe(getOrderPaymentsTotalWithRefunds(modifyOrder));
            });

            it('transition back to original state', async () => {
                const transitionOrderToState2 = await adminTransitionOrderToState(orderId2, 'PaymentSettled');
                orderGuard.assertSuccess(transitionOrderToState2);
                expect(transitionOrderToState2.state).toBe('PaymentSettled');
            });

            it('order no longer has promotions', async () => {
                const { order } = await adminClient.query(getOrderWithModificationsDocument, {
                    id: orderId2,
                });

                expect(order?.promotions).toEqual([]);
            });

            it('order no longer has discounts', async () => {
                const { order } = await adminClient.query(getOrderWithModificationsDocument, {
                    id: orderId2,
                });

                expect(order?.discounts).toEqual([]);
            });
        });
    });

    // https://github.com/vendurehq/vendure/issues/1197
    describe('refund on shipping when change made to shippingAddress', () => {
        let order: OrderWithModificationsFragment;
        beforeAll(async () => {
            const createdOrder = await createOrderAndTransitionToModifyingState([
                {
                    productVariantId: 'T_1',
                    quantity: 1,
                },
            ]);
            const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                input: {
                    dryRun: false,
                    orderId: createdOrder.id,
                    updateShippingAddress: {
                        countryCode: 'GB',
                    },
                    refund: {
                        paymentId: createdOrder.payments![0].id,
                        reason: 'discount',
                    },
                },
            });
            orderWithModificationsGuard.assertSuccess(modifyOrder);
            order = modifyOrder;
        });

        it('creates a Refund with the correct amount', () => {
            expect(order.payments?.[0].refunds[0].total).toBe(SHIPPING_OTHER - SHIPPING_GB);
        });

        it('allows transition to PaymentSettled', async () => {
            const transitionOrderToState = await adminTransitionOrderToState(order.id, 'PaymentSettled');

            orderGuard.assertSuccess(transitionOrderToState);

            expect(transitionOrderToState.state).toBe('PaymentSettled');
        });
    });

    // https://github.com/vendurehq/vendure/issues/1210
    describe('updating stock levels', () => {
        async function getVariant(id: 'T_1' | 'T_2' | 'T_3') {
            const { product } = await adminClient.query(getStockMovementDocument, {
                id: 'T_1',
            });
            return product!.variants.find(v => v.id === id)!;
        }

        let orderId4: string;
        let orderId5: string;

        it('updates stock when increasing quantity before fulfillment', async () => {
            const variant1 = await getVariant('T_2');
            expect(variant1.stockOnHand).toBe(100);
            expect(variant1.stockAllocated).toBe(0);

            const order = await createOrderAndTransitionToModifyingState([
                {
                    productVariantId: 'T_2',
                    quantity: 1,
                },
            ]);
            orderId4 = order.id;

            const variant2 = await getVariant('T_2');
            expect(variant2.stockOnHand).toBe(100);
            expect(variant2.stockAllocated).toBe(1);

            const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                input: {
                    dryRun: false,
                    orderId: order.id,
                    adjustOrderLines: [{ orderLineId: order.lines[0].id, quantity: 2 }],
                },
            });
            orderWithModificationsGuard.assertSuccess(modifyOrder);

            const variant3 = await getVariant('T_2');
            expect(variant3.stockOnHand).toBe(100);
            expect(variant3.stockAllocated).toBe(2);
        });

        it('updates stock when increasing quantity after fulfillment', async () => {
            const result = await adminTransitionOrderToState(orderId4, 'ArrangingAdditionalPayment');
            orderGuard.assertSuccess(result);
            expect(result.state).toBe('ArrangingAdditionalPayment');
            const { order } = await adminClient.query(getOrderDocument, {
                id: orderId4,
            });
            const { addManualPaymentToOrder } = await adminClient.query(addManualPaymentToOrderDocument, {
                input: {
                    orderId: orderId4,
                    method: 'test',
                    transactionId: 'ABC123',
                    metadata: {
                        foo: 'bar',
                    },
                },
            });
            orderWithModificationsGuard.assertSuccess(addManualPaymentToOrder);
            await adminTransitionOrderToState(orderId4, 'PaymentSettled');
            await adminClient.query(createFulfillmentDocument, {
                input: {
                    lines: order?.lines.map(l => ({ orderLineId: l.id, quantity: l.quantity })) ?? [],
                    handler: {
                        code: manualFulfillmentHandler.code,
                        arguments: [
                            { name: 'method', value: 'test method' },
                            { name: 'trackingCode', value: 'ABC123' },
                        ],
                    },
                },
            });

            const variant1 = await getVariant('T_2');
            expect(variant1.stockOnHand).toBe(98);
            expect(variant1.stockAllocated).toBe(0);

            await adminTransitionOrderToState(orderId4, 'Modifying');
            const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                input: {
                    dryRun: false,
                    orderId: order!.id,
                    adjustOrderLines: [{ orderLineId: order!.lines[0].id, quantity: 3 }],
                },
            });
            orderWithModificationsGuard.assertSuccess(modifyOrder);

            const variant2 = await getVariant('T_2');
            expect(variant2.stockOnHand).toBe(98);
            expect(variant2.stockAllocated).toBe(1);

            const { order: order2 } = await adminClient.query(getOrderDocument, {
                id: orderId4,
            });
        });

        it('updates stock when adding item before fulfillment', async () => {
            const variant1 = await getVariant('T_3');
            expect(variant1.stockOnHand).toBe(100);
            expect(variant1.stockAllocated).toBe(0);

            const order = await createOrderAndTransitionToModifyingState([
                {
                    productVariantId: 'T_2',
                    quantity: 1,
                },
            ]);
            orderId5 = order.id;

            const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                input: {
                    dryRun: false,
                    orderId: order.id,
                    addItems: [{ productVariantId: 'T_3', quantity: 1 }],
                },
            });
            orderWithModificationsGuard.assertSuccess(modifyOrder);

            const variant2 = await getVariant('T_3');
            expect(variant2.stockOnHand).toBe(100);
            expect(variant2.stockAllocated).toBe(1);

            const result = await adminTransitionOrderToState(orderId5, 'ArrangingAdditionalPayment');
            orderGuard.assertSuccess(result);
            expect(result.state).toBe('ArrangingAdditionalPayment');
            const { addManualPaymentToOrder } = await adminClient.query(addManualPaymentToOrderDocument, {
                input: {
                    orderId: orderId5,
                    method: 'test',
                    transactionId: 'manual-extra-payment',
                    metadata: {
                        foo: 'bar',
                    },
                },
            });
            orderWithModificationsGuard.assertSuccess(addManualPaymentToOrder);
            const result2 = await adminTransitionOrderToState(orderId5, 'PaymentSettled');
            orderGuard.assertSuccess(result2);
            const result3 = await adminTransitionOrderToState(orderId5, 'Modifying');
            orderGuard.assertSuccess(result3);
        });

        it('updates stock when removing item before fulfillment', async () => {
            const variant1 = await getVariant('T_3');
            expect(variant1.stockOnHand).toBe(100);
            expect(variant1.stockAllocated).toBe(1);

            const { order } = await adminClient.query(getOrderDocument, {
                id: orderId5,
            });

            const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                input: {
                    dryRun: false,
                    orderId: orderId5,
                    adjustOrderLines: [
                        {
                            orderLineId: order!.lines.find(l => l.productVariant.id === 'T_3')!.id,
                            quantity: 0,
                        },
                    ],
                    refund: {
                        paymentId: order!.payments![0].id,
                    },
                },
            });
            orderWithModificationsGuard.assertSuccess(modifyOrder);

            const variant2 = await getVariant('T_3');
            expect(variant2.stockOnHand).toBe(100);
            expect(variant2.stockAllocated).toBe(0);
        });

        it('updates stock when removing item after fulfillment', async () => {
            const variant1 = await getVariant('T_3');
            expect(variant1.stockOnHand).toBe(100);
            expect(variant1.stockAllocated).toBe(0);

            const order = await createOrderAndCheckout([
                {
                    productVariantId: 'T_3',
                    quantity: 1,
                },
            ]);
            const { addFulfillmentToOrder } = await adminClient.query(createFulfillmentDocument, {
                input: {
                    lines: order?.lines.map(l => ({ orderLineId: l.id, quantity: l.quantity })) ?? [],
                    handler: {
                        code: manualFulfillmentHandler.code,
                        arguments: [
                            { name: 'method', value: 'test method' },
                            { name: 'trackingCode', value: 'ABC123' },
                        ],
                    },
                },
            });
            orderGuard.assertSuccess(addFulfillmentToOrder);

            const variant2 = await getVariant('T_3');
            expect(variant2.stockOnHand).toBe(99);
            expect(variant2.stockAllocated).toBe(0);

            await adminTransitionOrderToState(order.id, 'Modifying');
            const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                input: {
                    dryRun: false,
                    orderId: order.id,
                    adjustOrderLines: [
                        {
                            orderLineId: order.lines.find(l => l.productVariant.id === 'T_3')!.id,
                            quantity: 0,
                        },
                    ],
                    refund: {
                        paymentId: order.payments![0].id,
                    },
                },
            });

            const variant3 = await getVariant('T_3');
            expect(variant3.stockOnHand).toBe(100);
            expect(variant3.stockAllocated).toBe(0);
        });
    });

    describe('couponCode handling', () => {
        const CODE_50PC_OFF = '50PC';
        const CODE_FREE_SHIPPING = 'FREESHIP';
        let order: TestOrderWithPaymentsFragment;
        beforeAll(async () => {
            await adminClient.query(createPromotionDocument, {
                input: {
                    couponCode: CODE_50PC_OFF,
                    enabled: true,
                    conditions: [],
                    actions: [
                        {
                            code: orderPercentageDiscount.code,
                            arguments: [{ name: 'discount', value: '50' }],
                        },
                    ],
                    translations: [{ languageCode: LanguageCode.en, name: '50% off' }],
                },
            });
            await adminClient.query(createPromotionDocument, {
                input: {
                    couponCode: CODE_FREE_SHIPPING,
                    enabled: true,
                    conditions: [],
                    actions: [{ code: freeShipping.code, arguments: [] }],
                    translations: [{ languageCode: LanguageCode.en, name: 'Free shipping' }],
                },
            });

            // create an order and check out
            await shopClient.asUserWithCredentials('trevor_donnelly96@hotmail.com', 'test');
            await shopClient.query(addItemToOrderWithCustomFieldsDocument, {
                productVariantId: 'T_1',
                quantity: 1,
                customFields: {
                    color: 'green',
                },
            } as any);
            await shopClient.query(addItemToOrderWithCustomFieldsDocument, {
                productVariantId: 'T_4',
                quantity: 2,
            });
            await proceedToArrangingPayment(shopClient);
            const result = await addPaymentToOrder(shopClient, testSuccessfulPaymentMethod);
            orderGuard.assertSuccess(result);
            order = result;
            const result2 = await adminTransitionOrderToState(order.id, 'Modifying');
            orderGuard.assertSuccess(result2);
            expect(result2.state).toBe('Modifying');
        });

        it('invalid coupon code returns ErrorResult', async () => {
            const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                input: {
                    dryRun: false,
                    orderId: order.id,
                    couponCodes: ['BAD_CODE'],
                },
            });
            orderWithModificationsGuard.assertErrorResult(modifyOrder);
            expect(modifyOrder.message).toBe('Coupon code "BAD_CODE" is not valid');
        });

        it('valid coupon code applies Promotion', async () => {
            const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                input: {
                    dryRun: false,
                    orderId: order.id,
                    refund: {
                        paymentId: order.payments![0].id,
                    },
                    couponCodes: [CODE_50PC_OFF],
                },
            });
            orderWithModificationsGuard.assertSuccess(modifyOrder);
            expect(modifyOrder.subTotalWithTax).toBe(order.subTotalWithTax * 0.5);
        });

        it('adds order.discounts', async () => {
            const { order: orderWithModifications } = await adminClient.query(
                getOrderWithModificationsDocument,
                { id: order.id },
            );
            expect(orderWithModifications?.discounts.length).toBe(1);
            expect(orderWithModifications?.discounts[0].description).toBe('50% off');
        });

        it('adds order.promotions', async () => {
            const { order: orderWithModifications } = await adminClient.query(
                getOrderWithModificationsDocument,
                { id: order.id },
            );
            expect(orderWithModifications?.promotions.length).toBe(1);
            expect(orderWithModifications?.promotions[0].name).toBe('50% off');
        });

        it('creates correct refund amount', async () => {
            const { order: orderWithModifications } = await adminClient.query(
                getOrderWithModificationsDocument,
                { id: order.id },
            );
            if (!orderWithModifications) {
                throw new Error('Order with modifications not found');
            }
            expect(orderWithModifications.payments![0].refunds.length).toBe(1);
            expect(orderWithModifications.totalWithTax).toBe(
                getOrderPaymentsTotalWithRefunds(orderWithModifications),
            );
            expect(orderWithModifications.payments![0].refunds[0].total).toBe(
                order.totalWithTax - orderWithModifications.totalWithTax,
            );
        });

        it('creates history entry for applying couponCode', async () => {
            const { order: history } = await adminClient.query(getOrderHistoryDocument, {
                id: order.id,
                options: { filter: { type: { eq: HistoryEntryType.ORDER_COUPON_APPLIED } } },
            });
            if (!history) {
                throw new Error('History not found');
            }
            orderGuard.assertSuccess(history);

            expect(history.history.items.length).toBe(1);
            expect(pick(history.history.items[0]!, ['type', 'data'])).toEqual({
                type: HistoryEntryType.ORDER_COUPON_APPLIED,
                data: { couponCode: CODE_50PC_OFF, promotionId: 'T_6' },
            });
        });

        it('removes coupon code', async () => {
            const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                input: {
                    dryRun: false,
                    orderId: order.id,
                    couponCodes: [],
                },
            });
            orderWithModificationsGuard.assertSuccess(modifyOrder);
            expect(modifyOrder.subTotalWithTax).toBe(order.subTotalWithTax);
        });

        it('removes order.discounts', async () => {
            const { order: orderWithModifications } = await adminClient.query(
                getOrderWithModificationsDocument,
                { id: order.id },
            );
            expect(orderWithModifications?.discounts.length).toBe(0);
        });

        it('removes order.promotions', async () => {
            const { order: orderWithModifications } = await adminClient.query(
                getOrderWithModificationsDocument,
                { id: order.id },
            );
            expect(orderWithModifications?.promotions.length).toBe(0);
        });

        it('creates history entry for removing couponCode', async () => {
            const { order: history } = await adminClient.query(getOrderHistoryDocument, {
                id: order.id,
                options: { filter: { type: { eq: HistoryEntryType.ORDER_COUPON_REMOVED } } },
            });

            if (!history) {
                throw new Error('History not found');
            }
            orderGuard.assertSuccess(history);

            expect(history.history.items.length).toBe(1);
            expect(pick(history.history.items[0]!, ['type', 'data'])).toEqual({
                type: HistoryEntryType.ORDER_COUPON_REMOVED,
                data: { couponCode: CODE_50PC_OFF },
            });
        });

        it('correct refund for free shipping couponCode', async () => {
            await shopClient.query(addItemToOrderWithCustomFieldsDocument, {
                productVariantId: 'T_1',
                quantity: 1,
            } as any);
            await proceedToArrangingPayment(shopClient);
            const result = await addPaymentToOrder(shopClient, testSuccessfulPaymentMethod);
            orderWithModificationsGuard.assertSuccess(result);
            const order2 = result;
            const shippingWithTax = order2.shippingWithTax;
            const result2 = await adminTransitionOrderToState(order2.id, 'Modifying');
            orderGuard.assertSuccess(result2);
            expect(result2.state).toBe('Modifying');

            const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                input: {
                    dryRun: false,
                    orderId: order2.id,
                    refund: {
                        paymentId: order2.payments![0].id,
                    },
                    couponCodes: [CODE_FREE_SHIPPING],
                },
            });
            orderWithModificationsGuard.assertSuccess(modifyOrder);
            expect(modifyOrder.shippingWithTax).toBe(0);
            expect(modifyOrder.totalWithTax).toBe(getOrderPaymentsTotalWithRefunds(modifyOrder));
            expect(modifyOrder.payments![0].refunds[0].total).toBe(shippingWithTax);
        });

        it('adjustOrderLines empty quantity with discounts', async () => {
            const PercentDiscount50Percent = '50PERCENT';
            await adminClient.query(createPromotionDocument, {
                input: {
                    enabled: true,
                    couponCode: PercentDiscount50Percent,
                    conditions: [
                        {
                            code: 'minimum_order_amount',
                            arguments: [
                                { name: 'amount', value: '0' },
                                { name: 'taxInclusive', value: 'false' },
                            ],
                        },
                    ],
                    actions: [
                        {
                            code: orderPercentageDiscount.code,
                            arguments: [{ name: 'discount', value: '50' }],
                        },
                    ],
                    translations: [{ languageCode: LanguageCode.en, name: 'half price' }],
                },
            });
            await shopClient.asUserWithCredentials('trevor_donnelly96@hotmail.com', 'test');
            await shopClient.query(addItemToOrderWithCustomFieldsDocument, {
                productVariantId: 'T_1',
                quantity: 1,
            } as any);
            await shopClient.query(addItemToOrderWithCustomFieldsDocument, {
                productVariantId: 'T_2',
                quantity: 1,
            } as any);

            await proceedToArrangingPayment(shopClient);
            const paidOrder = await addPaymentToOrder(shopClient, testSuccessfulPaymentMethod);
            orderGuard.assertSuccess(paidOrder);

            const transitionOrderToState = await adminTransitionOrderToState(paidOrder.id, 'Modifying');
            orderGuard.assertSuccess(transitionOrderToState);

            expect(transitionOrderToState.state).toBe('Modifying');

            // modify order should not throw an error when setting quantity to 0 for a order line
            const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                input: {
                    dryRun: true,
                    orderId: order.id,
                    couponCodes: [PercentDiscount50Percent],
                    adjustOrderLines: [{ orderLineId: order.lines[0].id, quantity: 0 }],
                },
            });

            orderWithModificationsGuard.assertSuccess(modifyOrder);
            expect(modifyOrder.id).toBeDefined();

            // ensure correct adjustments applied
            // The first line should have a linePrice of 0 because it has zero quantity
            expect(modifyOrder.lines[0].linePriceWithTax).toBe(0);
            expect(modifyOrder.lines[0].proratedLinePriceWithTax).toBe(0);
            // The second line should have the proratedLinePriceWithTax discounted per the promotion
            expect(modifyOrder.lines[1].proratedLinePriceWithTax).toBe(
                modifyOrder.lines[1].discountedLinePriceWithTax / 2,
            );
        });
    });

    describe('payment handling with multiple modifications  ', () => {
        let orderId3: string;

        it('should handle manual payment after multiple modifications', async () => {
            // 1. Create an order
            const order = await createOrderAndTransitionToModifyingState([
                {
                    productVariantId: 'T_1',
                    quantity: 1,
                },
            ]);

            // 2. First modification - add an item
            const { modifyOrder: firstModification } = await adminClient.query(modifyOrderDocument, {
                input: {
                    dryRun: false,
                    orderId: order.id,
                    addItems: [{ productVariantId: 'T_2', quantity: 1 }],
                },
            });
            orderGuard.assertSuccess(firstModification);

            // 3. Second modification - add another item
            const { modifyOrder: secondModification } = await adminClient.query(modifyOrderDocument, {
                input: {
                    dryRun: false,
                    orderId: order.id,
                    addItems: [{ productVariantId: 'T_3', quantity: 1 }],
                },
            });
            orderGuard.assertSuccess(secondModification);

            // 4. Transition to ArrangingAdditionalPayment state
            const transitionResult = await adminTransitionOrderToState(
                order.id,
                'ArrangingAdditionalPayment',
            );
            orderGuard.assertSuccess(transitionResult);
            expect(transitionResult.state).toBe('ArrangingAdditionalPayment');

            // 5. Add manual payment - this should currently fail due to a bug
            const { addManualPaymentToOrder } = await adminClient.query(addManualPaymentToOrderDocument, {
                input: {
                    orderId: order.id,
                    method: 'test',
                    transactionId: 'MULTI_MOD_123',
                    metadata: {
                        test: 'multiple modifications',
                    },
                },
            });

            // This should fail due to the bug, but we expect it to succeed after the fix
            orderWithModificationsGuard.assertSuccess(addManualPaymentToOrder);

            // Verify the payment was added correctly
            expect(addManualPaymentToOrder.payments?.length).toBe(2);
            const manualPayment = addManualPaymentToOrder.payments?.find(
                p => p.transactionId === 'MULTI_MOD_123',
            );
            expect(manualPayment).toEqual({
                id: expect.any(String),
                transactionId: 'MULTI_MOD_123',
                state: 'Settled',
                amount: expect.any(Number),
                method: 'test',
                nextStates: ['Cancelled'],
                metadata: {
                    test: 'multiple modifications',
                },
                refunds: [],
            });
            orderWithModificationsGuard.assertSuccess(addManualPaymentToOrder);

            // Verify the modifications are properly settled
            expect(addManualPaymentToOrder.modifications.length).toBe(2);
            expect(addManualPaymentToOrder.modifications[0].isSettled).toBe(true);
            expect(addManualPaymentToOrder.modifications[1].isSettled).toBe(true);
        });
    });

    async function adminTransitionOrderToState(id: string, state: string) {
        const result = await adminClient.query(adminTransitionToStateDocument, {
            id,
            state,
        });
        return result.transitionOrderToState as OrderFragment | ErrorResult;
    }

    async function assertOrderIsUnchanged(order: OrderWithLinesFragment) {
        const { order: order2 } = await adminClient.query(getOrderDocument, {
            id: order.id,
        });
        expect(order2!.totalWithTax).toBe(order.totalWithTax);
        expect(order2!.lines.length).toBe(order.lines.length);
        expect(order2!.surcharges.length).toBe(order.surcharges.length);
        expect(order2!.totalQuantity).toBe(order.totalQuantity);
    }

    async function createOrderAndCheckout(items: AddItemInput[]) {
        await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
        for (const itemInput of items) {
            await shopClient.query(addItemToOrderWithCustomFieldsDocument, itemInput);
        }

        await shopClient.query(setShippingAddressDocument, {
            input: {
                fullName: 'name',
                streetLine1: '12 the street',
                city: 'foo',
                postalCode: '123456',
                countryCode: 'AT',
            },
        });

        await shopClient.query(setShippingMethodDocument, {
            id: [testShippingMethodId],
        });

        await shopClient.query(transitionToStateDocument, {
            state: 'ArrangingPayment',
        });

        const order = await addPaymentToOrder(shopClient, testSuccessfulPaymentMethod);
        orderGuard.assertSuccess(order);
        return order;
    }

    async function createOrderAndTransitionToModifyingState(
        items: AddItemInput[],
    ): Promise<TestOrderWithPaymentsFragment> {
        const order = await createOrderAndCheckout(items);
        await adminTransitionOrderToState(order.id, 'Modifying');
        return order;
    }

    function getOrderPaymentsTotalWithRefunds(_order: OrderWithModificationsFragment) {
        return _order.payments?.reduce((sum, p) => sum + p.amount - summate(p?.refunds, 'total'), 0) ?? 0;
    }
});
