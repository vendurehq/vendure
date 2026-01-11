/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { omit } from '@vendure/common/lib/omit';
import { pick } from '@vendure/common/lib/pick';
import {
    CurrencyCode,
    defaultShippingCalculator,
    defaultShippingEligibilityChecker,
    manualFulfillmentHandler,
    mergeConfig,
} from '@vendure/core';
import {
    createErrorResultGuard,
    createTestEnvironment,
    ErrorResultGuard,
    SimpleGraphQLClient,
} from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import {
    failsToCancelPaymentMethod,
    failsToSettlePaymentMethod,
    onCancelPaymentSpy,
    onTransitionSpy,
    partialPaymentMethod,
    singleStageRefundablePaymentMethod,
    singleStageRefundFailingPaymentMethod,
    twoStagePaymentMethod,
} from './fixtures/test-payment-methods';
import { FULFILLMENT_FRAGMENT, PAYMENT_FRAGMENT } from './graphql/fragments';
import * as Codegen from './graphql/generated-e2e-admin-types';
import {
    AddManualPaymentDocument,
    CanceledOrderFragment,
    CreateFulfillmentDocument,
    ErrorCode,
    FulfillmentFragment,
    GetOrderDocument,
    GetOrderHistoryDocument,
    GlobalFlag,
    HistoryEntryType,
    LanguageCode,
    OrderLineInput,
    PaymentFragment,
    RefundFragment,
    RefundOrderDocument,
    SortOrder,
    StockMovementType,
    TransitFulfillmentDocument,
} from './graphql/generated-e2e-admin-types';
import * as CodegenShop from './graphql/generated-e2e-shop-types';
import {
    DeletionResult,
    TestOrderFragmentFragment,
    UpdatedOrderFragment,
} from './graphql/generated-e2e-shop-types';
import {
    ASSIGN_PRODUCTVARIANT_TO_CHANNEL,
    CANCEL_ORDER,
    CREATE_FULFILLMENT,
    CREATE_SHIPPING_METHOD,
    DELETE_PRODUCT,
    DELETE_SHIPPING_METHOD,
    GET_CUSTOMER_LIST,
    GET_ORDER,
    GET_ORDER_FULFILLMENTS,
    GET_ORDER_HISTORY,
    GET_ORDERS_LIST,
    GET_PRODUCT_WITH_VARIANTS,
    GET_STOCK_MOVEMENT,
    SETTLE_PAYMENT,
    TRANSIT_FULFILLMENT,
    UPDATE_CHANNEL,
    UPDATE_PRODUCT_VARIANTS,
} from './graphql/shared-definitions';
import {
    ADD_ITEM_TO_ORDER,
    ADD_MULTIPLE_ITEMS_TO_ORDER,
    ADD_PAYMENT,
    APPLY_COUPON_CODE,
    GET_ACTIVE_CUSTOMER_WITH_ORDERS_PRODUCT_PRICE,
    GET_ACTIVE_CUSTOMER_WITH_ORDERS_PRODUCT_SLUG,
    GET_ACTIVE_ORDER,
    GET_ORDER_BY_CODE_WITH_PAYMENTS,
    SET_CURRENCY_CODE_FOR_ORDER,
    SET_SHIPPING_ADDRESS,
    SET_SHIPPING_METHOD,
} from './graphql/shop-definitions';
import { assertThrowsWithMessage } from './utils/assert-throws-with-message';
import { addPaymentToOrder, proceedToArrangingPayment, sortById } from './utils/test-order-utils';

describe('Orders resolver', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            paymentOptions: {
                paymentMethodHandlers: [
                    twoStagePaymentMethod,
                    failsToSettlePaymentMethod,
                    singleStageRefundablePaymentMethod,
                    partialPaymentMethod,
                    singleStageRefundFailingPaymentMethod,
                    failsToCancelPaymentMethod,
                ],
            },
        }),
    );
    let customers: Codegen.GetCustomerListQuery['customers']['items'];
    const password = 'test';

    const orderGuard: ErrorResultGuard<
        TestOrderFragmentFragment | CanceledOrderFragment | UpdatedOrderFragment
    > = createErrorResultGuard(input => !!input.lines);
    const paymentGuard: ErrorResultGuard<PaymentFragment> = createErrorResultGuard(input => !!input.state);
    const fulfillmentGuard: ErrorResultGuard<FulfillmentFragment> = createErrorResultGuard(
        input => !!input.method,
    );
    const refundGuard: ErrorResultGuard<RefundFragment> = createErrorResultGuard(input => !!input.total);

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
                        name: failsToSettlePaymentMethod.code,
                        handler: { code: failsToSettlePaymentMethod.code, arguments: [] },
                    },
                    {
                        name: failsToCancelPaymentMethod.code,
                        handler: { code: failsToCancelPaymentMethod.code, arguments: [] },
                    },
                    {
                        name: singleStageRefundablePaymentMethod.code,
                        handler: { code: singleStageRefundablePaymentMethod.code, arguments: [] },
                    },
                    {
                        name: singleStageRefundFailingPaymentMethod.code,
                        handler: { code: singleStageRefundFailingPaymentMethod.code, arguments: [] },
                    },
                    {
                        name: partialPaymentMethod.code,
                        handler: { code: partialPaymentMethod.code, arguments: [] },
                    },
                ],
            },

            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 3,
        });
        await adminClient.asSuperAdmin();

        // Create a couple of orders to be queried
        const result = await adminClient.query<
            Codegen.GetCustomerListQuery,
            Codegen.GetCustomerListQueryVariables
        >(GET_CUSTOMER_LIST, {
            options: {
                take: 3,
            },
        });
        customers = result.customers.items;
        await shopClient.asUserWithCredentials(customers[0].emailAddress, password);
        await shopClient.query<
            CodegenShop.AddItemToOrderMutation,
            CodegenShop.AddItemToOrderMutationVariables
        >(ADD_ITEM_TO_ORDER, {
            productVariantId: 'T_1',
            quantity: 1,
        });
        await shopClient.query<
            CodegenShop.AddItemToOrderMutation,
            CodegenShop.AddItemToOrderMutationVariables
        >(ADD_ITEM_TO_ORDER, {
            productVariantId: 'T_2',
            quantity: 1,
        });
        await shopClient.asUserWithCredentials(customers[1].emailAddress, password);
        await shopClient.query<
            CodegenShop.AddItemToOrderMutation,
            CodegenShop.AddItemToOrderMutationVariables
        >(ADD_ITEM_TO_ORDER, {
            productVariantId: 'T_2',
            quantity: 1,
        });
        await shopClient.query<
            CodegenShop.AddItemToOrderMutation,
            CodegenShop.AddItemToOrderMutationVariables
        >(ADD_ITEM_TO_ORDER, {
            productVariantId: 'T_3',
            quantity: 3,
        });
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('order history initially contains Created -> AddingItems transition', async () => {
        const { order } = await adminClient.query<
            Codegen.GetOrderHistoryQuery,
            Codegen.GetOrderHistoryQueryVariables
        >(GET_ORDER_HISTORY, { id: 'T_1' });
        expect(order!.history.totalItems).toBe(1);
        expect(order!.history.items.map(pick(['type', 'data']))).toEqual([
            {
                type: HistoryEntryType.ORDER_STATE_TRANSITION,
                data: {
                    from: 'Created',
                    to: 'AddingItems',
                },
            },
        ]);
    });

    describe('querying', () => {
        it('orders', async () => {
            const result = await adminClient.query<Codegen.GetOrderListQuery>(GET_ORDERS_LIST);
            expect(result.orders.items.map(o => o.id).sort()).toEqual(['T_1', 'T_2']);
        });

        it('filtering by total', async () => {
            const result = await adminClient.query<
                Codegen.GetOrderListQuery,
                Codegen.GetOrderListQueryVariables
            >(GET_ORDERS_LIST, {
                options: {
                    filter: { total: { gt: 1000_00 } },
                },
            });
            expect(result.orders.items.map(o => o.id).sort()).toEqual(['T_1', 'T_2']);
        });

        it('filtering by total using boolean expression', async () => {
            const result = await adminClient.query<
                Codegen.GetOrderListQuery,
                Codegen.GetOrderListQueryVariables
            >(GET_ORDERS_LIST, {
                options: {
                    filter: {
                        _and: [{ total: { gt: 1000_00 } }],
                    },
                },
            });
            expect(result.orders.items.map(o => o.id).sort()).toEqual(['T_1', 'T_2']);
        });

        it('order', async () => {
            const result = await adminClient.query<Codegen.GetOrderQuery, Codegen.GetOrderQueryVariables>(
                GET_ORDER,
                {
                    id: 'T_2',
                },
            );
            expect(result.order!.id).toBe('T_2');
        });

        it('correctly resolves asset preview urls with edge-case query', async () => {
            // This came up as a strange edge-case where the AssetInterceptorPlugin was unable to
            // correctly transform the asset preview URL. It is not directly to do with Orders per se,
            // but manifested when attempting an order-related query.
            const result = await adminClient.query<Codegen.GetOrderQuery, Codegen.GetOrderQueryVariables>(
                gql(`
                    query OrderAssetEdgeCase($id: ID!) {
                        order(id: $id) {
                             lines {
                               id
                             }
                            ...OrderDetail
                        }
                    }

                    fragment OrderDetail on Order {
                        id
                        lines {
                            ...OrderLine
                        }
                    }

                    fragment OrderLine on OrderLine {
                        id
                        featuredAsset {
                            preview
                        }
                    }
                `),
                {
                    id: 'T_2',
                },
            );
            expect(result.order!.lines.length).toBe(2);
            expect(result.order!.lines.map(l => l.featuredAsset?.preview)).toEqual([
                'test-url/test-assets/derick-david-409858-unsplash__preview.jpg',
                'test-url/test-assets/derick-david-409858-unsplash__preview.jpg',
            ]);
        });

        it('order with calculated line properties', async () => {
            const result = await adminClient.query<Codegen.GetOrderQuery, Codegen.GetOrderQueryVariables>(
                gql`
                    query GetOrderWithLineCalculatedProps($id: ID!) {
                        order(id: $id) {
                            id
                            lines {
                                id
                                linePriceWithTax
                                quantity
                            }
                        }
                    }
                `,
                {
                    id: 'T_2',
                },
            );
            expect(result.order!.lines).toEqual([
                {
                    id: 'T_3',
                    linePriceWithTax: 167880,
                    quantity: 1,
                },
                {
                    id: 'T_4',
                    linePriceWithTax: 791640,
                    quantity: 3,
                },
            ]);
        });

        it('sort by total', async () => {
            const result = await adminClient.query<
                Codegen.GetOrderListQuery,
                Codegen.GetOrderListQueryVariables
            >(GET_ORDERS_LIST, {
                options: {
                    sort: {
                        total: SortOrder.DESC,
                    },
                    take: 10,
                },
            });
            expect(result.orders.items.map(o => pick(o, ['id', 'total']))).toEqual([
                { id: 'T_2', total: 799600 },
                { id: 'T_1', total: 269800 },
            ]);
        });

        it('sort by totalWithTax', async () => {
            const result = await adminClient.query<
                Codegen.GetOrderListQuery,
                Codegen.GetOrderListQueryVariables
            >(GET_ORDERS_LIST, {
                options: {
                    sort: {
                        totalWithTax: SortOrder.DESC,
                    },
                    take: 10,
                },
            });
            expect(result.orders.items.map(o => pick(o, ['id', 'totalWithTax']))).toEqual([
                { id: 'T_2', totalWithTax: 959520 },
                { id: 'T_1', totalWithTax: 323760 },
            ]);
        });

        it('sort by totalQuantity', async () => {
            const result = await adminClient.query<
                Codegen.GetOrderListQuery,
                Codegen.GetOrderListQueryVariables
            >(GET_ORDERS_LIST, {
                options: {
                    sort: {
                        totalQuantity: SortOrder.DESC,
                    },
                    take: 10,
                },
            });
            expect(result.orders.items.map(o => pick(o, ['id', 'totalQuantity']))).toEqual([
                { id: 'T_2', totalQuantity: 4 },
                { id: 'T_1', totalQuantity: 2 },
            ]);
        });

        it('sort by customerLastName', async () => {
            async function sortOrdersByLastName(sortOrder: SortOrder) {
                const { orders } = await adminClient.query<
                    Codegen.GetOrderListQuery,
                    Codegen.GetOrderListQueryVariables
                >(GET_ORDERS_LIST, {
                    options: {
                        sort: {
                            customerLastName: sortOrder,
                        },
                    },
                });
                return orders;
            }

            const result1 = await sortOrdersByLastName(SortOrder.ASC);
            expect(result1.totalItems).toEqual(2);
            expect(result1.items.map(order => order.customer?.lastName)).toEqual(['Donnelly', 'Zieme']);

            const result2 = await sortOrdersByLastName(SortOrder.DESC);
            expect(result2.totalItems).toEqual(2);
            expect(result2.items.map(order => order.customer?.lastName)).toEqual(['Zieme', 'Donnelly']);
        });

        it('filter by total', async () => {
            const result = await adminClient.query<
                Codegen.GetOrderListQuery,
                Codegen.GetOrderListQueryVariables
            >(GET_ORDERS_LIST, {
                options: {
                    filter: {
                        total: { gt: 323760 },
                    },
                    take: 10,
                },
            });
            expect(result.orders.items.map(o => pick(o, ['id', 'total']))).toEqual([
                { id: 'T_2', total: 799600 },
            ]);
        });

        it('filter by totalWithTax', async () => {
            const result = await adminClient.query<
                Codegen.GetOrderListQuery,
                Codegen.GetOrderListQueryVariables
            >(GET_ORDERS_LIST, {
                options: {
                    filter: {
                        totalWithTax: { gt: 323760 },
                    },
                    take: 10,
                },
            });
            expect(result.orders.items.map(o => pick(o, ['id', 'totalWithTax']))).toEqual([
                { id: 'T_2', totalWithTax: 959520 },
            ]);
        });

        it('filter by totalQuantity', async () => {
            const result = await adminClient.query<
                Codegen.GetOrderListQuery,
                Codegen.GetOrderListQueryVariables
            >(GET_ORDERS_LIST, {
                options: {
                    filter: {
                        totalQuantity: { eq: 4 },
                    },
                },
            });
            expect(result.orders.items.map(o => pick(o, ['id', 'totalQuantity']))).toEqual([
                { id: 'T_2', totalQuantity: 4 },
            ]);
        });

        it('filter by customerLastName', async () => {
            const result = await adminClient.query<
                Codegen.GetOrderListQuery,
                Codegen.GetOrderListQueryVariables
            >(GET_ORDERS_LIST, {
                options: {
                    filter: {
                        customerLastName: {
                            eq: customers[1].lastName,
                        },
                    },
                },
            });
            expect(result.orders.totalItems).toEqual(1);
            expect(result.orders.items[0].customer?.lastName).toEqual(customers[1].lastName);
        });
    });

    describe('payments', () => {
        let firstOrderCode: string;
        let firstOrderId: string;

        it('settlePayment fails', async () => {
            await shopClient.asUserWithCredentials(customers[0].emailAddress, password);
            await proceedToArrangingPayment(shopClient);
            const order = await addPaymentToOrder(shopClient, failsToSettlePaymentMethod);
            orderGuard.assertSuccess(order);

            expect(order.state).toBe('PaymentAuthorized');

            const payment = order.payments![0];
            const { settlePayment } = await adminClient.query<
                Codegen.SettlePaymentMutation,
                Codegen.SettlePaymentMutationVariables
            >(SETTLE_PAYMENT, {
                id: payment.id,
            });
            paymentGuard.assertErrorResult(settlePayment);

            expect(settlePayment.message).toBe('Settling the payment failed');
            expect(settlePayment.errorCode).toBe(ErrorCode.SETTLE_PAYMENT_ERROR);
            expect((settlePayment as any).paymentErrorMessage).toBe('Something went horribly wrong');

            const result = await adminClient.query<Codegen.GetOrderQuery, Codegen.GetOrderQueryVariables>(
                GET_ORDER,
                {
                    id: order.id,
                },
            );

            expect(result.order!.state).toBe('PaymentAuthorized');
            expect(result.order!.payments![0].state).toBe('Cancelled');
            firstOrderCode = order.code;
            firstOrderId = order.id;
        });

        it('public payment metadata available in Shop API', async () => {
            const { orderByCode } = await shopClient.query<
                CodegenShop.GetOrderByCodeWithPaymentsQuery,
                CodegenShop.GetOrderByCodeWithPaymentsQueryVariables
            >(GET_ORDER_BY_CODE_WITH_PAYMENTS, { code: firstOrderCode });

            expect(orderByCode?.payments?.[0].metadata).toEqual({
                public: {
                    publicCreatePaymentData: 'public',
                    publicSettlePaymentData: 'public',
                },
            });
        });

        it('public and private payment metadata available in Admin API', async () => {
            const { order } = await adminClient.query<
                Codegen.GetOrderWithPaymentsQuery,
                Codegen.GetOrderWithPaymentsQueryVariables
            >(GET_ORDER_WITH_PAYMENTS, { id: firstOrderId });

            expect(order?.payments?.[0].metadata).toEqual({
                privateCreatePaymentData: 'secret',
                privateSettlePaymentData: 'secret',
                public: {
                    publicCreatePaymentData: 'public',
                    publicSettlePaymentData: 'public',
                },
            });
        });

        it('settlePayment succeeds, onStateTransitionStart called', async () => {
            onTransitionSpy.mockClear();
            await shopClient.asUserWithCredentials(customers[1].emailAddress, password);
            await proceedToArrangingPayment(shopClient);
            const order = await addPaymentToOrder(shopClient, twoStagePaymentMethod);
            orderGuard.assertSuccess(order);

            expect(order.state).toBe('PaymentAuthorized');
            expect(onTransitionSpy).toHaveBeenCalledTimes(1);
            expect(onTransitionSpy.mock.calls[0][0]).toBe('Created');
            expect(onTransitionSpy.mock.calls[0][1]).toBe('Authorized');

            const payment = order.payments![0];
            const { settlePayment } = await adminClient.query<
                Codegen.SettlePaymentMutation,
                Codegen.SettlePaymentMutationVariables
            >(SETTLE_PAYMENT, {
                id: payment.id,
            });
            paymentGuard.assertSuccess(settlePayment);

            expect(settlePayment.id).toBe(payment.id);
            expect(settlePayment.state).toBe('Settled');
            // further metadata is combined into existing object
            expect(settlePayment.metadata).toEqual({
                moreData: 42,
                public: {
                    baz: 'quux',
                },
            });
            expect(onTransitionSpy).toHaveBeenCalledTimes(2);
            expect(onTransitionSpy.mock.calls[1][0]).toBe('Authorized');
            expect(onTransitionSpy.mock.calls[1][1]).toBe('Settled');

            const result = await adminClient.query<Codegen.GetOrderQuery, Codegen.GetOrderQueryVariables>(
                GET_ORDER,
                {
                    id: order.id,
                },
            );

            expect(result.order!.state).toBe('PaymentSettled');
            expect(result.order!.payments![0].state).toBe('Settled');
        });

        it('order history contains expected entries', async () => {
            const { order } = await adminClient.query<
                Codegen.GetOrderHistoryQuery,
                Codegen.GetOrderHistoryQueryVariables
            >(GET_ORDER_HISTORY, { id: 'T_2', options: { sort: { id: SortOrder.ASC } } });
            expect(order!.history.items.map(pick(['type', 'data']))).toEqual([
                {
                    type: HistoryEntryType.ORDER_STATE_TRANSITION,
                    data: {
                        from: 'Created',
                        to: 'AddingItems',
                    },
                },
                {
                    type: HistoryEntryType.ORDER_STATE_TRANSITION,
                    data: {
                        from: 'AddingItems',
                        to: 'ArrangingPayment',
                    },
                },
                {
                    type: HistoryEntryType.ORDER_PAYMENT_TRANSITION,
                    data: {
                        paymentId: 'T_2',
                        from: 'Created',
                        to: 'Authorized',
                    },
                },
                {
                    type: HistoryEntryType.ORDER_STATE_TRANSITION,
                    data: {
                        from: 'ArrangingPayment',
                        to: 'PaymentAuthorized',
                    },
                },
                {
                    type: HistoryEntryType.ORDER_PAYMENT_TRANSITION,
                    data: {
                        paymentId: 'T_2',
                        from: 'Authorized',
                        to: 'Settled',
                    },
                },
                {
                    type: HistoryEntryType.ORDER_STATE_TRANSITION,
                    data: {
                        from: 'PaymentAuthorized',
                        to: 'PaymentSettled',
                    },
                },
            ]);
        });

        it('filter by transactionId', async () => {
            const result = await adminClient.query<
                Codegen.GetOrderListQuery,
                Codegen.GetOrderListQueryVariables
            >(GET_ORDERS_LIST, {
                options: {
                    filter: {
                        transactionId: {
                            eq: '12345-' + firstOrderCode,
                        },
                    },
                },
            });
            expect(result.orders.totalItems).toEqual(1);
            expect(result.orders.items[0].code).toBe(firstOrderCode);
        });
    });

    describe('fulfillment', () => {
        const orderId = 'T_2';
        let f1Id: string;
        let f2Id: string;
        let f3Id: string;

        it('return error result if lines is empty', async () => {
            const { order } = await adminClient.query<Codegen.GetOrderQuery, Codegen.GetOrderQueryVariables>(
                GET_ORDER,
                {
                    id: orderId,
                },
            );
            expect(order!.state).toBe('PaymentSettled');
            const { addFulfillmentToOrder } = await adminClient.query<
                Codegen.CreateFulfillmentMutation,
                Codegen.CreateFulfillmentMutationVariables
            >(CREATE_FULFILLMENT, {
                input: {
                    lines: [],
                    handler: {
                        code: manualFulfillmentHandler.code,
                        arguments: [{ name: 'method', value: 'Test' }],
                    },
                },
            });
            fulfillmentGuard.assertErrorResult(addFulfillmentToOrder);

            expect(addFulfillmentToOrder.message).toBe('At least one OrderLine must be specified');
            expect(addFulfillmentToOrder.errorCode).toBe(ErrorCode.EMPTY_ORDER_LINE_SELECTION_ERROR);
        });

        it('returns error result if all quantities are zero', async () => {
            const { order } = await adminClient.query<Codegen.GetOrderQuery, Codegen.GetOrderQueryVariables>(
                GET_ORDER,
                {
                    id: orderId,
                },
            );
            expect(order!.state).toBe('PaymentSettled');
            const { addFulfillmentToOrder } = await adminClient.query<
                Codegen.CreateFulfillmentMutation,
                Codegen.CreateFulfillmentMutationVariables
            >(CREATE_FULFILLMENT, {
                input: {
                    lines: order!.lines.map(l => ({ orderLineId: l.id, quantity: 0 })),
                    handler: {
                        code: manualFulfillmentHandler.code,
                        arguments: [{ name: 'method', value: 'Test' }],
                    },
                },
            });
            fulfillmentGuard.assertErrorResult(addFulfillmentToOrder);

            expect(addFulfillmentToOrder.message).toBe('At least one OrderLine must be specified');
            expect(addFulfillmentToOrder.errorCode).toBe(ErrorCode.EMPTY_ORDER_LINE_SELECTION_ERROR);
        });

        it('creates the first fulfillment', async () => {
            const { order } = await adminClient.query<Codegen.GetOrderQuery, Codegen.GetOrderQueryVariables>(
                GET_ORDER,
                {
                    id: orderId,
                },
            );
            expect(order!.state).toBe('PaymentSettled');
            const lines = order!.lines;

            const { addFulfillmentToOrder } = await adminClient.query<
                Codegen.CreateFulfillmentMutation,
                Codegen.CreateFulfillmentMutationVariables
            >(CREATE_FULFILLMENT, {
                input: {
                    lines: [{ orderLineId: lines[0].id, quantity: lines[0].quantity }],
                    handler: {
                        code: manualFulfillmentHandler.code,
                        arguments: [
                            { name: 'method', value: 'Test1' },
                            { name: 'trackingCode', value: '111' },
                        ],
                    },
                },
            });
            fulfillmentGuard.assertSuccess(addFulfillmentToOrder);

            expect(addFulfillmentToOrder.id).toBe('T_1');
            expect(addFulfillmentToOrder.method).toBe('Test1');
            expect(addFulfillmentToOrder.trackingCode).toBe('111');
            expect(addFulfillmentToOrder.state).toBe('Pending');
            expect(addFulfillmentToOrder.lines).toEqual([
                { orderLineId: lines[0].id, quantity: lines[0].quantity },
            ]);
            f1Id = addFulfillmentToOrder.id;

            const result = await adminClient.query<Codegen.GetOrderQuery, Codegen.GetOrderQueryVariables>(
                GET_ORDER,
                {
                    id: orderId,
                },
            );

            expect(result.order!.fulfillments?.length).toBe(1);
            expect(result.order!.fulfillments![0]!.id).toBe(addFulfillmentToOrder.id);
            expect(result.order!.fulfillments![0]!.lines).toEqual([
                {
                    orderLineId: order?.lines[0].id,
                    quantity: order?.lines[0].quantity,
                },
            ]);
            expect(
                result.order!.fulfillments![0]!.lines.filter(l => l.orderLineId === lines[1].id).length,
            ).toBe(0);
        });

        it('creates the second fulfillment', async () => {
            const lines = await getUnfulfilledOrderLineInput(adminClient, orderId);

            const { addFulfillmentToOrder } = await adminClient.query<
                Codegen.CreateFulfillmentMutation,
                Codegen.CreateFulfillmentMutationVariables
            >(CREATE_FULFILLMENT, {
                input: {
                    lines,
                    handler: {
                        code: manualFulfillmentHandler.code,
                        arguments: [
                            { name: 'method', value: 'Test2' },
                            { name: 'trackingCode', value: '222' },
                        ],
                    },
                },
            });
            fulfillmentGuard.assertSuccess(addFulfillmentToOrder);

            expect(addFulfillmentToOrder.id).toBe('T_2');
            expect(addFulfillmentToOrder.method).toBe('Test2');
            expect(addFulfillmentToOrder.trackingCode).toBe('222');
            expect(addFulfillmentToOrder.state).toBe('Pending');
            f2Id = addFulfillmentToOrder.id;
        });

        it('cancels second fulfillment', async () => {
            const { transitionFulfillmentToState } = await adminClient.query<
                Codegen.TransitFulfillmentMutation,
                Codegen.TransitFulfillmentMutationVariables
            >(TRANSIT_FULFILLMENT, {
                id: f2Id,
                state: 'Cancelled',
            });
            fulfillmentGuard.assertSuccess(transitionFulfillmentToState);

            expect(transitionFulfillmentToState.id).toBe('T_2');
            expect(transitionFulfillmentToState.state).toBe('Cancelled');
        });

        it('order.fulfillments still lists second (cancelled) fulfillment', async () => {
            const { order } = await adminClient.query<
                Codegen.GetOrderFulfillmentsQuery,
                Codegen.GetOrderFulfillmentsQueryVariables
            >(GET_ORDER_FULFILLMENTS, {
                id: orderId,
            });

            expect(order?.fulfillments?.sort(sortById).map(pick(['id', 'state']))).toEqual([
                { id: f1Id, state: 'Pending' },
                { id: f2Id, state: 'Cancelled' },
            ]);
        });

        it('order.fulfillments.summary', async () => {
            const { order } = await adminClient.query<
                Codegen.GetOrderFulfillmentsQuery,
                Codegen.GetOrderFulfillmentsQueryVariables
            >(GET_ORDER_FULFILLMENTS, {
                id: orderId,
            });

            expect(order?.fulfillments?.sort(sortById).map(pick(['id', 'state', 'summary']))).toEqual([
                { id: f1Id, state: 'Pending', summary: [{ orderLine: { id: 'T_3' }, quantity: 1 }] },
                { id: f2Id, state: 'Cancelled', summary: [{ orderLine: { id: 'T_4' }, quantity: 3 }] },
            ]);
        });

        it('lines.fulfillments', async () => {
            const { order } = await adminClient.query<
                Codegen.GetOrderLineFulfillmentsQuery,
                Codegen.GetOrderLineFulfillmentsQueryVariables
            >(GET_ORDER_LINE_FULFILLMENTS, {
                id: orderId,
            });

            expect(order?.lines.find(l => l.id === 'T_3')!.fulfillmentLines).toEqual([
                { fulfillment: { id: f1Id, state: 'Pending' }, orderLineId: 'T_3', quantity: 1 },
            ]);
            // Cancelled Fulfillments do not appear in the line field
            expect(order?.lines.find(l => l.id === 'T_4')!.fulfillmentLines).toEqual([]);
        });

        it('creates third fulfillment with same items from second fulfillment', async () => {
            const lines = await getUnfulfilledOrderLineInput(adminClient, orderId);
            const { addFulfillmentToOrder } = await adminClient.query<
                Codegen.CreateFulfillmentMutation,
                Codegen.CreateFulfillmentMutationVariables
            >(CREATE_FULFILLMENT, {
                input: {
                    lines,
                    handler: {
                        code: manualFulfillmentHandler.code,
                        arguments: [
                            { name: 'method', value: 'Test3' },
                            { name: 'trackingCode', value: '333' },
                        ],
                    },
                },
            });
            fulfillmentGuard.assertSuccess(addFulfillmentToOrder);

            expect(addFulfillmentToOrder.id).toBe('T_3');
            expect(addFulfillmentToOrder.method).toBe('Test3');
            expect(addFulfillmentToOrder.trackingCode).toBe('333');
            expect(addFulfillmentToOrder.state).toBe('Pending');
            f3Id = addFulfillmentToOrder.id;
        });

        it('returns error result if an OrderItem already part of a Fulfillment', async () => {
            const { order } = await adminClient.query<Codegen.GetOrderQuery, Codegen.GetOrderQueryVariables>(
                GET_ORDER,
                {
                    id: orderId,
                },
            );
            const { addFulfillmentToOrder } = await adminClient.query<
                Codegen.CreateFulfillmentMutation,
                Codegen.CreateFulfillmentMutationVariables
            >(CREATE_FULFILLMENT, {
                input: {
                    lines: [
                        {
                            orderLineId: order!.lines[0].id,
                            quantity: 1,
                        },
                    ],
                    handler: {
                        code: manualFulfillmentHandler.code,
                        arguments: [{ name: 'method', value: 'Test' }],
                    },
                },
            });
            fulfillmentGuard.assertErrorResult(addFulfillmentToOrder);

            expect(addFulfillmentToOrder.message).toBe(
                'One or more OrderItems are already part of a Fulfillment',
            );
            expect(addFulfillmentToOrder.errorCode).toBe(ErrorCode.ITEMS_ALREADY_FULFILLED_ERROR);
        });

        it('transitions the first fulfillment from created to Shipped and automatically change the order state to PartiallyShipped', async () => {
            const { transitionFulfillmentToState } = await adminClient.query<
                Codegen.TransitFulfillmentMutation,
                Codegen.TransitFulfillmentMutationVariables
            >(TRANSIT_FULFILLMENT, {
                id: f1Id,
                state: 'Shipped',
            });
            fulfillmentGuard.assertSuccess(transitionFulfillmentToState);

            expect(transitionFulfillmentToState.id).toBe(f1Id);
            expect(transitionFulfillmentToState.state).toBe('Shipped');

            const { order } = await adminClient.query<Codegen.GetOrderQuery, Codegen.GetOrderQueryVariables>(
                GET_ORDER,
                {
                    id: orderId,
                },
            );
            expect(order?.state).toBe('PartiallyShipped');
        });

        it('transitions the third fulfillment from created to Shipped and automatically change the order state to Shipped', async () => {
            const { transitionFulfillmentToState } = await adminClient.query<
                Codegen.TransitFulfillmentMutation,
                Codegen.TransitFulfillmentMutationVariables
            >(TRANSIT_FULFILLMENT, {
                id: f3Id,
                state: 'Shipped',
            });
            fulfillmentGuard.assertSuccess(transitionFulfillmentToState);

            expect(transitionFulfillmentToState.id).toBe(f3Id);
            expect(transitionFulfillmentToState.state).toBe('Shipped');

            const { order } = await adminClient.query<Codegen.GetOrderQuery, Codegen.GetOrderQueryVariables>(
                GET_ORDER,
                {
                    id: orderId,
                },
            );
            expect(order?.state).toBe('Shipped');
        });

        it('transitions the first fulfillment from Shipped to Delivered and change the order state to PartiallyDelivered', async () => {
            const { transitionFulfillmentToState } = await adminClient.query<
                Codegen.TransitFulfillmentMutation,
                Codegen.TransitFulfillmentMutationVariables
            >(TRANSIT_FULFILLMENT, {
                id: f1Id,
                state: 'Delivered',
            });
            fulfillmentGuard.assertSuccess(transitionFulfillmentToState);

            expect(transitionFulfillmentToState.id).toBe(f1Id);
            expect(transitionFulfillmentToState.state).toBe('Delivered');

            const { order } = await adminClient.query<Codegen.GetOrderQuery, Codegen.GetOrderQueryVariables>(
                GET_ORDER,
                {
                    id: orderId,
                },
            );
            expect(order?.state).toBe('PartiallyDelivered');
        });

        it('transitions the third fulfillment from Shipped to Delivered and change the order state to Delivered', async () => {
            const { transitionFulfillmentToState } = await adminClient.query<
                Codegen.TransitFulfillmentMutation,
                Codegen.TransitFulfillmentMutationVariables
            >(TRANSIT_FULFILLMENT, {
                id: f3Id,
                state: 'Delivered',
            });
            fulfillmentGuard.assertSuccess(transitionFulfillmentToState);

            expect(transitionFulfillmentToState.id).toBe(f3Id);
            expect(transitionFulfillmentToState.state).toBe('Delivered');

            const { order } = await adminClient.query<Codegen.GetOrderQuery, Codegen.GetOrderQueryVariables>(
                GET_ORDER,
                {
                    id: orderId,
                },
            );
            expect(order?.state).toBe('Delivered');
        });

        it('order history contains expected entries', async () => {
            const { order } = await adminClient.query<
                Codegen.GetOrderHistoryQuery,
                Codegen.GetOrderHistoryQueryVariables
            >(GET_ORDER_HISTORY, {
                id: orderId,
                options: {
                    skip: 6,
                },
            });
            expect(order!.history.items.map(pick(['type', 'data']))).toEqual([
                {
                    data: {
                        fulfillmentId: f1Id,
                    },
                    type: HistoryEntryType.ORDER_FULFILLMENT,
                },
                {
                    data: {
                        from: 'Created',
                        fulfillmentId: f1Id,
                        to: 'Pending',
                    },
                    type: HistoryEntryType.ORDER_FULFILLMENT_TRANSITION,
                },
                {
                    data: {
                        fulfillmentId: f2Id,
                    },
                    type: HistoryEntryType.ORDER_FULFILLMENT,
                },
                {
                    data: {
                        from: 'Created',
                        fulfillmentId: f2Id,
                        to: 'Pending',
                    },
                    type: HistoryEntryType.ORDER_FULFILLMENT_TRANSITION,
                },
                {
                    data: {
                        from: 'Pending',
                        fulfillmentId: f2Id,
                        to: 'Cancelled',
                    },
                    type: HistoryEntryType.ORDER_FULFILLMENT_TRANSITION,
                },
                {
                    data: {
                        fulfillmentId: f3Id,
                    },
                    type: HistoryEntryType.ORDER_FULFILLMENT,
                },
                {
                    data: {
                        from: 'Created',
                        fulfillmentId: f3Id,
                        to: 'Pending',
                    },
                    type: HistoryEntryType.ORDER_FULFILLMENT_TRANSITION,
                },
                {
                    data: {
                        from: 'Pending',
                        fulfillmentId: f1Id,
                        to: 'Shipped',
                    },
                    type: HistoryEntryType.ORDER_FULFILLMENT_TRANSITION,
                },
                {
                    data: {
                        from: 'PaymentSettled',
                        to: 'PartiallyShipped',
                    },
                    type: HistoryEntryType.ORDER_STATE_TRANSITION,
                },
                {
                    data: {
                        from: 'Pending',
                        fulfillmentId: f3Id,
                        to: 'Shipped',
                    },
                    type: HistoryEntryType.ORDER_FULFILLMENT_TRANSITION,
                },
                {
                    data: {
                        from: 'PartiallyShipped',
                        to: 'Shipped',
                    },
                    type: HistoryEntryType.ORDER_STATE_TRANSITION,
                },
                {
                    data: {
                        from: 'Shipped',
                        fulfillmentId: f1Id,
                        to: 'Delivered',
                    },
                    type: HistoryEntryType.ORDER_FULFILLMENT_TRANSITION,
                },
                {
                    data: {
                        from: 'Shipped',
                        to: 'PartiallyDelivered',
                    },
                    type: HistoryEntryType.ORDER_STATE_TRANSITION,
                },
                {
                    data: {
                        from: 'Shipped',
                        fulfillmentId: f3Id,
                        to: 'Delivered',
                    },
                    type: HistoryEntryType.ORDER_FULFILLMENT_TRANSITION,
                },
                {
                    data: {
                        from: 'PartiallyDelivered',
                        to: 'Delivered',
                    },
                    type: HistoryEntryType.ORDER_STATE_TRANSITION,
                },
            ]);
        });

        it('order.fulfillments resolver for single order', async () => {
            const { order } = await adminClient.query<
                Codegen.GetOrderFulfillmentsQuery,
                Codegen.GetOrderFulfillmentsQueryVariables
            >(GET_ORDER_FULFILLMENTS, {
                id: orderId,
            });

            expect(
                order!.fulfillments?.sort(sortById).map(pick(['id', 'method', 'state', 'nextStates'])),
            ).toEqual([
                { id: f1Id, method: 'Test1', state: 'Delivered', nextStates: ['Cancelled'] },
                { id: f2Id, method: 'Test2', state: 'Cancelled', nextStates: [] },
                { id: f3Id, method: 'Test3', state: 'Delivered', nextStates: ['Cancelled'] },
            ]);
        });

        it('order.fulfillments resolver for order list', async () => {
            const { orders } =
                await adminClient.query<Codegen.GetOrderListFulfillmentsQuery>(GET_ORDER_LIST_FULFILLMENTS);

            expect(orders.items[0].fulfillments).toEqual([]);
            expect(orders.items[1].fulfillments?.sort(sortById)).toEqual([
                { id: f1Id, method: 'Test1', state: 'Delivered', nextStates: ['Cancelled'] },
                { id: f2Id, method: 'Test2', state: 'Cancelled', nextStates: [] },
                { id: f3Id, method: 'Test3', state: 'Delivered', nextStates: ['Cancelled'] },
            ]);
        });
    });

    describe('cancellation by orderId', () => {
        it('cancel from AddingItems state', async () => {
            const testOrder = await createTestOrder(
                adminClient,
                shopClient,
                customers[0].emailAddress,
                password,
            );
            const { order } = await adminClient.query<Codegen.GetOrderQuery, Codegen.GetOrderQueryVariables>(
                GET_ORDER,
                {
                    id: testOrder.orderId,
                },
            );
            expect(order!.state).toBe('AddingItems');
            const { cancelOrder } = await adminClient.query<
                Codegen.CancelOrderMutation,
                Codegen.CancelOrderMutationVariables
            >(CANCEL_ORDER, {
                input: {
                    orderId: testOrder.orderId,
                },
            });

            const { order: order2 } = await adminClient.query<
                Codegen.GetOrderQuery,
                Codegen.GetOrderQueryVariables
            >(GET_ORDER, {
                id: testOrder.orderId,
            });
            expect(order2!.state).toBe('Cancelled');
            expect(order2!.active).toBe(false);
            await assertNoStockMovementsCreated(testOrder.product!.id);
        });

        it('cancel from ArrangingPayment state', async () => {
            const testOrder = await createTestOrder(
                adminClient,
                shopClient,
                customers[0].emailAddress,
                password,
            );
            await proceedToArrangingPayment(shopClient);
            const { order } = await adminClient.query<Codegen.GetOrderQuery, Codegen.GetOrderQueryVariables>(
                GET_ORDER,
                {
                    id: testOrder.orderId,
                },
            );
            expect(order!.state).toBe('ArrangingPayment');
            await adminClient.query<Codegen.CancelOrderMutation, Codegen.CancelOrderMutationVariables>(
                CANCEL_ORDER,
                {
                    input: {
                        orderId: testOrder.orderId,
                    },
                },
            );

            const { order: order2 } = await adminClient.query<
                Codegen.GetOrderQuery,
                Codegen.GetOrderQueryVariables
            >(GET_ORDER, {
                id: testOrder.orderId,
            });
            expect(order2!.state).toBe('Cancelled');
            expect(order2!.active).toBe(false);

            await assertNoStockMovementsCreated(testOrder.product!.id);
        });

        it('cancel from PaymentAuthorized state with cancelShipping: true', async () => {
            const testOrder = await createTestOrder(
                adminClient,
                shopClient,
                customers[0].emailAddress,
                password,
            );
            await proceedToArrangingPayment(shopClient, 2);
            const order = await addPaymentToOrder(shopClient, failsToSettlePaymentMethod);
            orderGuard.assertSuccess(order);

            expect(order.state).toBe('PaymentAuthorized');

            const result1 = await adminClient.query<
                Codegen.GetStockMovementQuery,
                Codegen.GetStockMovementQueryVariables
            >(GET_STOCK_MOVEMENT, {
                id: 'T_3',
            });
            let variant1 = result1.product!.variants[0];
            expect(variant1.stockOnHand).toBe(100);
            expect(variant1.stockAllocated).toBe(2);
            expect(variant1.stockMovements.items.map(pick(['type', 'quantity']))).toEqual([
                { type: StockMovementType.ADJUSTMENT, quantity: 100 },
                { type: StockMovementType.ALLOCATION, quantity: 2 },
            ]);

            const { cancelOrder } = await adminClient.query<
                Codegen.CancelOrderMutation,
                Codegen.CancelOrderMutationVariables
            >(CANCEL_ORDER, {
                input: {
                    orderId: testOrder.orderId,
                    cancelShipping: true,
                },
            });
            orderGuard.assertSuccess(cancelOrder);

            expect(cancelOrder.lines.sort((a, b) => (a.id > b.id ? 1 : -1))).toEqual([
                { id: 'T_7', quantity: 0 },
            ]);
            const { order: order2 } = await adminClient.query<
                Codegen.GetOrderQuery,
                Codegen.GetOrderQueryVariables
            >(GET_ORDER, {
                id: testOrder.orderId,
            });
            expect(order2!.active).toBe(false);
            expect(order2!.state).toBe('Cancelled');
            expect(order2!.totalWithTax).toBe(0);
            expect(order2!.shippingWithTax).toBe(0);

            const result2 = await adminClient.query<
                Codegen.GetStockMovementQuery,
                Codegen.GetStockMovementQueryVariables
            >(GET_STOCK_MOVEMENT, {
                id: 'T_3',
            });
            variant1 = result2.product!.variants[0];
            expect(variant1.stockOnHand).toBe(100);
            expect(variant1.stockAllocated).toBe(0);
            expect(variant1.stockMovements.items.map(pick(['type', 'quantity']))).toEqual([
                { type: StockMovementType.ADJUSTMENT, quantity: 100 },
                { type: StockMovementType.ALLOCATION, quantity: 2 },
                { type: StockMovementType.RELEASE, quantity: 2 },
            ]);
        });

        async function assertNoStockMovementsCreated(productId: string) {
            const result = await adminClient.query<
                Codegen.GetStockMovementQuery,
                Codegen.GetStockMovementQueryVariables
            >(GET_STOCK_MOVEMENT, {
                id: productId,
            });
            const variant2 = result.product!.variants[0];
            expect(variant2.stockOnHand).toBe(100);
            expect(variant2.stockMovements.items.map(pick(['type', 'quantity']))).toEqual([
                { type: StockMovementType.ADJUSTMENT, quantity: 100 },
            ]);
        }
    });

    describe('cancellation by OrderLine', () => {
        let orderId: string;
        let product: Codegen.GetProductWithVariantsQuery['product'];
        let productVariantId: string;

        beforeAll(async () => {
            const result = await createTestOrder(
                adminClient,
                shopClient,
                customers[0].emailAddress,
                password,
            );
            orderId = result.orderId;
            product = result.product;
            productVariantId = result.productVariantId;
        });

        it('cannot cancel from AddingItems state', async () => {
            const { order } = await adminClient.query<Codegen.GetOrderQuery, Codegen.GetOrderQueryVariables>(
                GET_ORDER,
                {
                    id: orderId,
                },
            );
            expect(order!.state).toBe('AddingItems');

            const { cancelOrder } = await adminClient.query<
                Codegen.CancelOrderMutation,
                Codegen.CancelOrderMutationVariables
            >(CANCEL_ORDER, {
                input: {
                    orderId,
                    lines: order!.lines.map(l => ({ orderLineId: l.id, quantity: 1 })),
                },
            });
            orderGuard.assertErrorResult(cancelOrder);

            expect(cancelOrder.message).toBe(
                'Cannot cancel OrderLines from an Order in the "AddingItems" state',
            );
            expect(cancelOrder.errorCode).toBe(ErrorCode.CANCEL_ACTIVE_ORDER_ERROR);
        });

        it('cannot cancel from ArrangingPayment state', async () => {
            await proceedToArrangingPayment(shopClient, 2);
            const { order } = await adminClient.query<Codegen.GetOrderQuery, Codegen.GetOrderQueryVariables>(
                GET_ORDER,
                {
                    id: orderId,
                },
            );
            expect(order!.state).toBe('ArrangingPayment');
            const { cancelOrder } = await adminClient.query<
                Codegen.CancelOrderMutation,
                Codegen.CancelOrderMutationVariables
            >(CANCEL_ORDER, {
                input: {
                    orderId,
                    lines: order!.lines.map(l => ({ orderLineId: l.id, quantity: 1 })),
                },
            });
            orderGuard.assertErrorResult(cancelOrder);

            expect(cancelOrder.message).toBe(
                'Cannot cancel OrderLines from an Order in the "ArrangingPayment" state',
            );
            expect(cancelOrder.errorCode).toBe(ErrorCode.CANCEL_ACTIVE_ORDER_ERROR);
        });

        it('returns error result if lines are empty', async () => {
            const order = await addPaymentToOrder(shopClient, twoStagePaymentMethod);
            orderGuard.assertSuccess(order);

            expect(order.state).toBe('PaymentAuthorized');

            const { cancelOrder } = await adminClient.query<
                Codegen.CancelOrderMutation,
                Codegen.CancelOrderMutationVariables
            >(CANCEL_ORDER, {
                input: {
                    orderId,
                    lines: [],
                },
            });
            orderGuard.assertErrorResult(cancelOrder);

            expect(cancelOrder.message).toBe('At least one OrderLine must be specified');
            expect(cancelOrder.errorCode).toBe(ErrorCode.EMPTY_ORDER_LINE_SELECTION_ERROR);
        });

        it('returns error result if all quantities zero', async () => {
            const { order } = await adminClient.query<Codegen.GetOrderQuery, Codegen.GetOrderQueryVariables>(
                GET_ORDER,
                {
                    id: orderId,
                },
            );
            const { cancelOrder } = await adminClient.query<
                Codegen.CancelOrderMutation,
                Codegen.CancelOrderMutationVariables
            >(CANCEL_ORDER, {
                input: {
                    orderId,
                    lines: order!.lines.map(l => ({ orderLineId: l.id, quantity: 0 })),
                },
            });
            orderGuard.assertErrorResult(cancelOrder);

            expect(cancelOrder.message).toBe('At least one OrderLine must be specified');
            expect(cancelOrder.errorCode).toBe(ErrorCode.EMPTY_ORDER_LINE_SELECTION_ERROR);
        });

        it('partial cancellation', async () => {
            const result1 = await adminClient.query<
                Codegen.GetStockMovementQuery,
                Codegen.GetStockMovementQueryVariables
            >(GET_STOCK_MOVEMENT, {
                id: product!.id,
            });
            const variant1 = result1.product!.variants[0];
            expect(variant1.stockOnHand).toBe(100);
            expect(variant1.stockAllocated).toBe(2);
            expect(variant1.stockMovements.items.map(pick(['type', 'quantity']))).toEqual([
                { type: StockMovementType.ADJUSTMENT, quantity: 100 },
                { type: StockMovementType.ALLOCATION, quantity: 2 },
                { type: StockMovementType.RELEASE, quantity: 2 },
                { type: StockMovementType.ALLOCATION, quantity: 2 },
            ]);

            const { order } = await adminClient.query<Codegen.GetOrderQuery, Codegen.GetOrderQueryVariables>(
                GET_ORDER,
                {
                    id: orderId,
                },
            );

            const { cancelOrder } = await adminClient.query<
                Codegen.CancelOrderMutation,
                Codegen.CancelOrderMutationVariables
            >(CANCEL_ORDER, {
                input: {
                    orderId,
                    lines: order!.lines.map(l => ({ orderLineId: l.id, quantity: 1 })),
                    reason: 'cancel reason 1',
                },
            });
            orderGuard.assertSuccess(cancelOrder);

            expect(cancelOrder.lines[0].quantity).toBe(1);

            const { order: order2 } = await adminClient.query<
                Codegen.GetOrderQuery,
                Codegen.GetOrderQueryVariables
            >(GET_ORDER, {
                id: orderId,
            });

            expect(order2!.state).toBe('PaymentAuthorized');
            expect(order2!.lines[0].quantity).toBe(1);

            const result2 = await adminClient.query<
                Codegen.GetStockMovementQuery,
                Codegen.GetStockMovementQueryVariables
            >(GET_STOCK_MOVEMENT, {
                id: product!.id,
            });
            const variant2 = result2.product!.variants[0];
            expect(variant2.stockOnHand).toBe(100);
            expect(variant2.stockAllocated).toBe(1);
            expect(variant2.stockMovements.items.map(pick(['type', 'quantity']))).toEqual([
                { type: StockMovementType.ADJUSTMENT, quantity: 100 },
                { type: StockMovementType.ALLOCATION, quantity: 2 },
                { type: StockMovementType.RELEASE, quantity: 2 },
                { type: StockMovementType.ALLOCATION, quantity: 2 },
                { type: StockMovementType.RELEASE, quantity: 1 },
            ]);
        });

        it('returns error result if attempting to cancel already cancelled item', async () => {
            const { order } = await adminClient.query<Codegen.GetOrderQuery, Codegen.GetOrderQueryVariables>(
                GET_ORDER,
                {
                    id: orderId,
                },
            );
            const { cancelOrder } = await adminClient.query<
                Codegen.CancelOrderMutation,
                Codegen.CancelOrderMutationVariables
            >(CANCEL_ORDER, {
                input: {
                    orderId,
                    lines: order!.lines.map(l => ({ orderLineId: l.id, quantity: 2 })),
                },
            });
            orderGuard.assertErrorResult(cancelOrder);

            expect(cancelOrder.message).toBe(
                'The specified quantity is greater than the available OrderItems',
            );
            expect(cancelOrder.errorCode).toBe(ErrorCode.QUANTITY_TOO_GREAT_ERROR);
        });

        it('complete cancellation', async () => {
            const { order } = await adminClient.query<Codegen.GetOrderQuery, Codegen.GetOrderQueryVariables>(
                GET_ORDER,
                {
                    id: orderId,
                },
            );
            await adminClient.query<Codegen.CancelOrderMutation, Codegen.CancelOrderMutationVariables>(
                CANCEL_ORDER,
                {
                    input: {
                        orderId,
                        lines: order!.lines.map(l => ({ orderLineId: l.id, quantity: 1 })),
                        reason: 'cancel reason 2',
                        cancelShipping: true,
                    },
                },
            );

            const { order: order2 } = await adminClient.query<
                Codegen.GetOrderQuery,
                Codegen.GetOrderQueryVariables
            >(GET_ORDER, {
                id: orderId,
            });
            expect(order2!.state).toBe('Cancelled');
            expect(order2!.shippingWithTax).toBe(0);
            expect(order2!.totalWithTax).toBe(0);

            const result = await adminClient.query<
                Codegen.GetStockMovementQuery,
                Codegen.GetStockMovementQueryVariables
            >(GET_STOCK_MOVEMENT, {
                id: product!.id,
            });
            const variant2 = result.product!.variants[0];
            expect(variant2.stockOnHand).toBe(100);
            expect(variant2.stockAllocated).toBe(0);
            expect(variant2.stockMovements.items.map(pick(['type', 'quantity']))).toEqual([
                { type: StockMovementType.ADJUSTMENT, quantity: 100 },
                { type: StockMovementType.ALLOCATION, quantity: 2 },
                { type: StockMovementType.RELEASE, quantity: 2 },
                { type: StockMovementType.ALLOCATION, quantity: 2 },
                { type: StockMovementType.RELEASE, quantity: 1 },
                { type: StockMovementType.RELEASE, quantity: 1 },
            ]);
        });

        it('cancelled OrderLine.unitPrice is not zero', async () => {
            const { order } = await adminClient.query<Codegen.GetOrderQuery, Codegen.GetOrderQueryVariables>(
                GET_ORDER,
                {
                    id: orderId,
                },
            );

            expect(order?.lines[0].unitPrice).not.toBe(0);
        });

        it('order history contains expected entries', async () => {
            const { order } = await adminClient.query<
                Codegen.GetOrderHistoryQuery,
                Codegen.GetOrderHistoryQueryVariables
            >(GET_ORDER_HISTORY, {
                id: orderId,
                options: {
                    skip: 0,
                },
            });
            expect(order!.history.items.map(pick(['type', 'data']))).toEqual([
                {
                    type: HistoryEntryType.ORDER_STATE_TRANSITION,
                    data: {
                        from: 'Created',
                        to: 'AddingItems',
                    },
                },
                {
                    type: HistoryEntryType.ORDER_STATE_TRANSITION,
                    data: {
                        from: 'AddingItems',
                        to: 'ArrangingPayment',
                    },
                },
                {
                    type: HistoryEntryType.ORDER_PAYMENT_TRANSITION,
                    data: {
                        paymentId: 'T_4',
                        from: 'Created',
                        to: 'Authorized',
                    },
                },
                {
                    type: HistoryEntryType.ORDER_STATE_TRANSITION,
                    data: {
                        from: 'ArrangingPayment',
                        to: 'PaymentAuthorized',
                    },
                },
                {
                    type: HistoryEntryType.ORDER_CANCELLATION,
                    data: {
                        lines: [{ orderLineId: 'T_8', quantity: 1 }],
                        reason: 'cancel reason 1',
                        shippingCancelled: false,
                    },
                },
                {
                    type: HistoryEntryType.ORDER_CANCELLATION,
                    data: {
                        lines: [{ orderLineId: 'T_8', quantity: 1 }],
                        reason: 'cancel reason 2',
                        shippingCancelled: true,
                    },
                },
                {
                    type: HistoryEntryType.ORDER_STATE_TRANSITION,
                    data: {
                        from: 'PaymentAuthorized',
                        to: 'Cancelled',
                    },
                },
            ]);
        });
    });

    describe('refunds', () => {
        let orderId: string;
        let paymentId: string;
        let refundId: string;

        beforeAll(async () => {
            const result = await createTestOrder(
                adminClient,
                shopClient,
                customers[0].emailAddress,
                password,
            );
            orderId = result.orderId;
        });

        it('cannot refund from PaymentAuthorized state', async () => {
            await proceedToArrangingPayment(shopClient);
            const order = await addPaymentToOrder(shopClient, twoStagePaymentMethod);
            orderGuard.assertSuccess(order);

            expect(order.state).toBe('PaymentAuthorized');
            paymentId = order.payments![0].id;

            const { refundOrder } = await adminClient.query<
                Codegen.RefundOrderMutation,
                Codegen.RefundOrderMutationVariables
            >(REFUND_ORDER, {
                input: {
                    lines: order.lines.map(l => ({ orderLineId: l.id, quantity: 1 })),
                    shipping: 0,
                    adjustment: 0,
                    paymentId,
                },
            });
            refundGuard.assertErrorResult(refundOrder);

            expect(refundOrder.message).toBe('Cannot refund an Order in the "PaymentAuthorized" state');
            expect(refundOrder.errorCode).toBe(ErrorCode.REFUND_ORDER_STATE_ERROR);
        });

        it('returns error result if no amount and no shipping', async () => {
            const { order } = await adminClient.query<Codegen.GetOrderQuery, Codegen.GetOrderQueryVariables>(
                GET_ORDER,
                {
                    id: orderId,
                },
            );
            const { settlePayment } = await adminClient.query<
                Codegen.SettlePaymentMutation,
                Codegen.SettlePaymentMutationVariables
            >(SETTLE_PAYMENT, {
                id: order!.payments![0].id,
            });
            paymentGuard.assertSuccess(settlePayment);

            expect(settlePayment.state).toBe('Settled');

            const { refundOrder } = await adminClient.query<
                Codegen.RefundOrderMutation,
                Codegen.RefundOrderMutationVariables
            >(REFUND_ORDER, {
                input: {
                    lines: order!.lines.map(l => ({ orderLineId: l.id, quantity: 0 })),
                    shipping: 0,
                    adjustment: 0,
                    paymentId,
                },
            });
            refundGuard.assertErrorResult(refundOrder);

            expect(refundOrder.message).toBe('Nothing to refund');
            expect(refundOrder.errorCode).toBe(ErrorCode.NOTHING_TO_REFUND_ERROR);
        });

        it(
            'throws if paymentId not valid',
            assertThrowsWithMessage(async () => {
                const { order } = await adminClient.query<
                    Codegen.GetOrderQuery,
                    Codegen.GetOrderQueryVariables
                >(GET_ORDER, {
                    id: orderId,
                });
                const { refundOrder } = await adminClient.query<
                    Codegen.RefundOrderMutation,
                    Codegen.RefundOrderMutationVariables
                >(REFUND_ORDER, {
                    input: {
                        lines: [],
                        shipping: 100,
                        adjustment: 0,
                        paymentId: 'T_999',
                    },
                });
            }, 'No Payment with the id "999" could be found'),
        );

        it('returns error result if payment and order lines do not belong to the same Order', async () => {
            const { order } = await adminClient.query<Codegen.GetOrderQuery, Codegen.GetOrderQueryVariables>(
                GET_ORDER,
                {
                    id: orderId,
                },
            );
            const { refundOrder } = await adminClient.query<
                Codegen.RefundOrderMutation,
                Codegen.RefundOrderMutationVariables
            >(REFUND_ORDER, {
                input: {
                    lines: order!.lines.map(l => ({ orderLineId: l.id, quantity: l.quantity })),
                    shipping: 100,
                    adjustment: 0,
                    paymentId: 'T_1',
                },
            });
            refundGuard.assertErrorResult(refundOrder);

            expect(refundOrder.message).toBe('The Payment and OrderLines do not belong to the same Order');
            expect(refundOrder.errorCode).toBe(ErrorCode.PAYMENT_ORDER_MISMATCH_ERROR);
        });

        it('creates a Refund to be manually settled', async () => {
            const { order } = await adminClient.query<Codegen.GetOrderQuery, Codegen.GetOrderQueryVariables>(
                GET_ORDER,
                {
                    id: orderId,
                },
            );
            const { refundOrder } = await adminClient.query<
                Codegen.RefundOrderMutation,
                Codegen.RefundOrderMutationVariables
            >(REFUND_ORDER, {
                input: {
                    lines: order!.lines.map(l => ({ orderLineId: l.id, quantity: l.quantity })),
                    shipping: order!.shippingWithTax,
                    adjustment: 0,
                    reason: 'foo',
                    paymentId,
                },
            });
            refundGuard.assertSuccess(refundOrder);

            expect(refundOrder.shipping).toBe(order!.shippingWithTax);
            expect(refundOrder.items).toBe(order!.subTotalWithTax);
            expect(refundOrder.total).toBe(order!.totalWithTax);
            expect(refundOrder.transactionId).toBe(null);
            expect(refundOrder.state).toBe('Pending');
            refundId = refundOrder.id;
        });

        it('manually settle a Refund', async () => {
            const { settleRefund } = await adminClient.query<
                Codegen.SettleRefundMutation,
                Codegen.SettleRefundMutationVariables
            >(SETTLE_REFUND, {
                input: {
                    id: refundId,
                    transactionId: 'aaabbb',
                },
            });
            refundGuard.assertSuccess(settleRefund);

            expect(settleRefund.state).toBe('Settled');
            expect(settleRefund.transactionId).toBe('aaabbb');
        });

        it('order history contains expected entries', async () => {
            const { order } = await adminClient.query<
                Codegen.GetOrderHistoryQuery,
                Codegen.GetOrderHistoryQueryVariables
            >(GET_ORDER_HISTORY, {
                id: orderId,
                options: {
                    skip: 0,
                },
            });
            expect(order!.history.items.sort(sortById).map(pick(['type', 'data']))).toEqual([
                {
                    type: HistoryEntryType.ORDER_STATE_TRANSITION,
                    data: {
                        from: 'Created',
                        to: 'AddingItems',
                    },
                },
                {
                    type: HistoryEntryType.ORDER_STATE_TRANSITION,
                    data: {
                        from: 'AddingItems',
                        to: 'ArrangingPayment',
                    },
                },
                {
                    type: HistoryEntryType.ORDER_PAYMENT_TRANSITION,
                    data: {
                        paymentId: 'T_5',
                        from: 'Created',
                        to: 'Authorized',
                    },
                },
                {
                    type: HistoryEntryType.ORDER_STATE_TRANSITION,
                    data: {
                        from: 'ArrangingPayment',
                        to: 'PaymentAuthorized',
                    },
                },
                {
                    type: HistoryEntryType.ORDER_PAYMENT_TRANSITION,
                    data: {
                        paymentId: 'T_5',
                        from: 'Authorized',
                        to: 'Settled',
                    },
                },
                {
                    type: HistoryEntryType.ORDER_STATE_TRANSITION,
                    data: {
                        from: 'PaymentAuthorized',
                        to: 'PaymentSettled',
                    },
                },
                {
                    type: HistoryEntryType.ORDER_REFUND_TRANSITION,
                    data: {
                        refundId: 'T_1',
                        reason: 'foo',
                        from: 'Pending',
                        to: 'Settled',
                    },
                },
            ]);
        });

        // https://github.com/vendurehq/vendure/issues/873
        it('can add another refund if the first one fails', async () => {
            const orderResult = await createTestOrder(
                adminClient,
                shopClient,
                customers[0].emailAddress,
                password,
            );
            await proceedToArrangingPayment(shopClient, 2);
            const order = await addPaymentToOrder(shopClient, singleStageRefundFailingPaymentMethod);
            orderGuard.assertSuccess(order);

            expect(order.state).toBe('PaymentSettled');

            const { refundOrder: refund1 } = await adminClient.query<
                Codegen.RefundOrderMutation,
                Codegen.RefundOrderMutationVariables
            >(REFUND_ORDER, {
                input: {
                    lines: order.lines.map(l => ({ orderLineId: l.id, quantity: l.quantity })),
                    shipping: order.shippingWithTax,
                    adjustment: 0,
                    reason: 'foo',
                    paymentId: order.payments![0].id,
                },
            });
            refundGuard.assertSuccess(refund1);
            expect(refund1.state).toBe('Failed');
            expect(refund1.total).toBe(order.totalWithTax);

            const { refundOrder: refund2 } = await adminClient.query<
                Codegen.RefundOrderMutation,
                Codegen.RefundOrderMutationVariables
            >(REFUND_ORDER, {
                input: {
                    lines: order.lines.map(l => ({ orderLineId: l.id, quantity: l.quantity })),
                    shipping: order.shippingWithTax,
                    adjustment: 0,
                    reason: 'foo',
                    paymentId: order.payments![0].id,
                },
            });
            refundGuard.assertSuccess(refund2);
            expect(refund2.state).toBe('Settled');
            expect(refund2.total).toBe(order.totalWithTax);
        });

        // https://github.com/vendurehq/vendure/issues/2302
        it('passes correct amount to createRefund function after cancellation', async () => {
            const orderResult = await createTestOrder(
                adminClient,
                shopClient,
                customers[0].emailAddress,
                password,
            );
            await proceedToArrangingPayment(shopClient, 2);
            const order = await addPaymentToOrder(shopClient, singleStageRefundablePaymentMethod);
            orderGuard.assertSuccess(order);

            expect(order.state).toBe('PaymentSettled');

            const { cancelOrder } = await adminClient.query<
                Codegen.CancelOrderMutation,
                Codegen.CancelOrderMutationVariables
            >(CANCEL_ORDER, {
                input: {
                    orderId: order.id,
                    lines: order.lines.map(l => ({ orderLineId: l.id, quantity: l.quantity })),
                    reason: 'cancel reason 1',
                },
            });
            orderGuard.assertSuccess(cancelOrder);

            const { refundOrder } = await adminClient.query<
                Codegen.RefundOrderMutation,
                Codegen.RefundOrderMutationVariables
            >(REFUND_ORDER, {
                input: {
                    lines: order.lines.map(l => ({ orderLineId: l.id, quantity: l.quantity })),
                    shipping: order.shippingWithTax,
                    adjustment: 0,
                    reason: 'foo',
                    paymentId: order.payments![0].id,
                },
            });
            refundGuard.assertSuccess(refundOrder);
            expect(refundOrder.state).toBe('Settled');
            expect(refundOrder.total).toBe(order.totalWithTax);
            expect(refundOrder.metadata.amount).toBe(order.totalWithTax);
        });
    });

    describe('payment cancellation', () => {
        it("cancelling payment calls the method's cancelPayment handler", async () => {
            await createTestOrder(adminClient, shopClient, customers[0].emailAddress, password);
            await proceedToArrangingPayment(shopClient);
            const order = await addPaymentToOrder(shopClient, twoStagePaymentMethod);
            orderGuard.assertSuccess(order);

            expect(order.state).toBe('PaymentAuthorized');
            const paymentId = order.payments![0].id;

            expect(onCancelPaymentSpy).not.toHaveBeenCalled();

            const { cancelPayment } = await adminClient.query<
                Codegen.CancelPaymentMutation,
                Codegen.CancelPaymentMutationVariables
            >(CANCEL_PAYMENT, {
                paymentId,
            });

            paymentGuard.assertSuccess(cancelPayment);
            expect(cancelPayment.state).toBe('Cancelled');
            expect(cancelPayment.metadata.cancellationCode).toBe('12345');
            expect(onCancelPaymentSpy).toHaveBeenCalledTimes(1);
        });

        it('cancellation failure', async () => {
            await createTestOrder(adminClient, shopClient, customers[0].emailAddress, password);
            await proceedToArrangingPayment(shopClient);
            const order = await addPaymentToOrder(shopClient, failsToCancelPaymentMethod);
            orderGuard.assertSuccess(order);

            expect(order.state).toBe('PaymentAuthorized');
            const paymentId = order.payments![0].id;

            const { cancelPayment } = await adminClient.query<
                Codegen.CancelPaymentMutation,
                Codegen.CancelPaymentMutationVariables
            >(CANCEL_PAYMENT, {
                paymentId,
            });

            paymentGuard.assertErrorResult(cancelPayment);
            expect(cancelPayment.message).toBe('Cancelling the payment failed');
            const { order: checkorder } = await adminClient.query<
                Codegen.GetOrderQuery,
                Codegen.GetOrderQueryVariables
            >(GET_ORDER, {
                id: order.id,
            });
            expect(checkorder!.payments![0].state).toBe('Authorized');
            expect(checkorder!.payments![0].metadata).toEqual({ cancellationData: 'foo' });
        });
    });

    describe('refund by amount', () => {
        let orderId: string;
        let paymentId: string;
        let refundId: string;

        beforeAll(async () => {
            const result = await createTestOrder(
                adminClient,
                shopClient,
                customers[0].emailAddress,
                password,
            );
            orderId = result.orderId;
            await proceedToArrangingPayment(shopClient);
            const order = await addPaymentToOrder(shopClient, singleStageRefundablePaymentMethod);
            orderGuard.assertSuccess(order);
            paymentId = order.payments![0].id;
        });

        it('return RefundAmountError if amount too large', async () => {
            const { refundOrder } = await adminClient.query(RefundOrderDocument, {
                input: {
                    lines: [],
                    shipping: 0,
                    adjustment: 0,
                    amount: 999999,
                    paymentId,
                },
            });
            refundGuard.assertErrorResult(refundOrder);

            expect(refundOrder.message).toBe(
                'The amount specified exceeds the refundable amount for this payment',
            );
            expect(refundOrder.errorCode).toBe(ErrorCode.REFUND_AMOUNT_ERROR);
        });

        it('creates a partial refund for the given amount', async () => {
            const { order } = await adminClient.query(GetOrderDocument, {
                id: orderId,
            });

            const refundAmount = order!.totalWithTax - 500;

            const { refundOrder } = await adminClient.query(RefundOrderDocument, {
                input: {
                    lines: [],
                    shipping: 0,
                    adjustment: 0,
                    amount: refundAmount,
                    paymentId,
                },
            });
            refundGuard.assertSuccess(refundOrder);

            expect(refundOrder.total).toBe(refundAmount);
        });
    });

    describe('order notes', () => {
        let orderId: string;
        let firstNoteId: string;

        beforeAll(async () => {
            const result = await createTestOrder(
                adminClient,
                shopClient,
                customers[2].emailAddress,
                password,
            );

            orderId = result.orderId;
        });

        it('private note', async () => {
            const { addNoteToOrder } = await adminClient.query<
                Codegen.AddNoteToOrderMutation,
                Codegen.AddNoteToOrderMutationVariables
            >(ADD_NOTE_TO_ORDER, {
                input: {
                    id: orderId,
                    note: 'A private note',
                    isPublic: false,
                },
            });

            expect(addNoteToOrder.id).toBe(orderId);

            const { order } = await adminClient.query<
                Codegen.GetOrderHistoryQuery,
                Codegen.GetOrderHistoryQueryVariables
            >(GET_ORDER_HISTORY, {
                id: orderId,
                options: {
                    skip: 1,
                },
            });

            expect(order!.history.items.map(pick(['type', 'data']))).toEqual([
                {
                    type: HistoryEntryType.ORDER_NOTE,
                    data: {
                        note: 'A private note',
                    },
                },
            ]);

            firstNoteId = order!.history.items[0].id;

            const { activeOrder } = await shopClient.query<CodegenShop.GetActiveOrderQuery>(GET_ACTIVE_ORDER);

            expect(activeOrder!.history.items.map(pick(['type']))).toEqual([
                { type: HistoryEntryType.ORDER_STATE_TRANSITION },
            ]);
        });

        it('public note', async () => {
            const { addNoteToOrder } = await adminClient.query<
                Codegen.AddNoteToOrderMutation,
                Codegen.AddNoteToOrderMutationVariables
            >(ADD_NOTE_TO_ORDER, {
                input: {
                    id: orderId,
                    note: 'A public note',
                    isPublic: true,
                },
            });

            expect(addNoteToOrder.id).toBe(orderId);

            const { order } = await adminClient.query<
                Codegen.GetOrderHistoryQuery,
                Codegen.GetOrderHistoryQueryVariables
            >(GET_ORDER_HISTORY, {
                id: orderId,
                options: {
                    skip: 2,
                },
            });

            expect(order!.history.items.map(pick(['type', 'data']))).toEqual([
                {
                    type: HistoryEntryType.ORDER_NOTE,
                    data: {
                        note: 'A public note',
                    },
                },
            ]);

            const { activeOrder } = await shopClient.query<CodegenShop.GetActiveOrderQuery>(GET_ACTIVE_ORDER);

            expect(activeOrder!.history.items.map(pick(['type', 'data']))).toEqual([
                {
                    type: HistoryEntryType.ORDER_STATE_TRANSITION,
                    data: {
                        from: 'Created',
                        to: 'AddingItems',
                    },
                },
                {
                    type: HistoryEntryType.ORDER_NOTE,
                    data: {
                        note: 'A public note',
                    },
                },
            ]);
        });

        it('update note', async () => {
            const { updateOrderNote } = await adminClient.query<
                Codegen.UpdateOrderNoteMutation,
                Codegen.UpdateOrderNoteMutationVariables
            >(UPDATE_ORDER_NOTE, {
                input: {
                    noteId: firstNoteId,
                    note: 'An updated note',
                },
            });

            expect(updateOrderNote.data).toEqual({
                note: 'An updated note',
            });
        });

        it('delete note', async () => {
            const { order: before } = await adminClient.query<
                Codegen.GetOrderHistoryQuery,
                Codegen.GetOrderHistoryQueryVariables
            >(GET_ORDER_HISTORY, { id: orderId });
            expect(before?.history.totalItems).toBe(3);

            const { deleteOrderNote } = await adminClient.query<
                Codegen.DeleteOrderNoteMutation,
                Codegen.DeleteOrderNoteMutationVariables
            >(DELETE_ORDER_NOTE, {
                id: firstNoteId,
            });

            expect(deleteOrderNote.result).toBe(DeletionResult.DELETED);

            const { order: after } = await adminClient.query<
                Codegen.GetOrderHistoryQuery,
                Codegen.GetOrderHistoryQueryVariables
            >(GET_ORDER_HISTORY, { id: orderId });
            expect(after?.history.totalItems).toBe(2);
        });
    });

    describe('multiple payments', () => {
        const PARTIAL_PAYMENT_AMOUNT = 1000;
        let orderId: string;
        let orderTotalWithTax: number;
        let payment1Id: string;
        let payment2Id: string;
        let productInOrder: Codegen.GetProductWithVariantsQuery['product'];

        beforeAll(async () => {
            const result = await createTestOrder(
                adminClient,
                shopClient,
                customers[1].emailAddress,
                password,
            );
            orderId = result.orderId;
            productInOrder = result.product;
        });

        it('adds a partial payment', async () => {
            await proceedToArrangingPayment(shopClient, 2);
            const { addPaymentToOrder: order } = await shopClient.query<
                CodegenShop.AddPaymentToOrderMutation,
                CodegenShop.AddPaymentToOrderMutationVariables
            >(ADD_PAYMENT, {
                input: {
                    method: partialPaymentMethod.code,
                    metadata: {
                        amount: PARTIAL_PAYMENT_AMOUNT,
                    },
                },
            });
            orderGuard.assertSuccess(order);
            orderTotalWithTax = order.totalWithTax;

            expect(order.state).toBe('ArrangingPayment');
            expect(order.payments?.length).toBe(1);
            expect(omit(order.payments![0], ['id'])).toEqual({
                amount: PARTIAL_PAYMENT_AMOUNT,
                metadata: {
                    public: {
                        amount: PARTIAL_PAYMENT_AMOUNT,
                    },
                },
                method: partialPaymentMethod.code,
                state: 'Settled',
                transactionId: '12345',
            });
            payment1Id = order.payments![0].id;
        });

        it('adds another payment to make up order totalWithTax', async () => {
            const { addPaymentToOrder: order } = await shopClient.query<
                CodegenShop.AddPaymentToOrderMutation,
                CodegenShop.AddPaymentToOrderMutationVariables
            >(ADD_PAYMENT, {
                input: {
                    method: singleStageRefundablePaymentMethod.code,
                    metadata: {},
                },
            });
            orderGuard.assertSuccess(order);

            expect(order.state).toBe('PaymentSettled');
            expect(order.payments?.length).toBe(2);
            expect(
                omit(order.payments!.find(p => p.method === singleStageRefundablePaymentMethod.code)!, [
                    'id',
                ]),
            ).toEqual({
                amount: orderTotalWithTax - PARTIAL_PAYMENT_AMOUNT,
                metadata: {},
                method: singleStageRefundablePaymentMethod.code,
                state: 'Settled',
                transactionId: '12345',
            });
            payment2Id = order.payments![1].id;
        });

        it('partial refunding of order with multiple payments', async () => {
            const { order } = await adminClient.query<Codegen.GetOrderQuery, Codegen.GetOrderQueryVariables>(
                GET_ORDER,
                {
                    id: orderId,
                },
            );
            const { refundOrder } = await adminClient.query<
                Codegen.RefundOrderMutation,
                Codegen.RefundOrderMutationVariables
            >(REFUND_ORDER, {
                input: {
                    lines: order!.lines.map(l => ({ orderLineId: l.id, quantity: 1 })),
                    shipping: 0,
                    adjustment: 0,
                    reason: 'first refund',
                    paymentId: payment1Id,
                },
            });
            refundGuard.assertSuccess(refundOrder);
            expect(refundOrder.total).toBe(PARTIAL_PAYMENT_AMOUNT);

            const { order: orderWithPayments } = await adminClient.query<
                Codegen.GetOrderWithPaymentsQuery,
                Codegen.GetOrderWithPaymentsQueryVariables
            >(GET_ORDER_WITH_PAYMENTS, {
                id: orderId,
            });

            expect(orderWithPayments?.payments!.sort(sortById)[0].refunds.length).toBe(1);
            expect(orderWithPayments?.payments!.sort(sortById)[0].refunds[0].total).toBe(
                PARTIAL_PAYMENT_AMOUNT,
            );

            expect(orderWithPayments?.payments!.sort(sortById)[1].refunds.length).toBe(1);
            expect(orderWithPayments?.payments!.sort(sortById)[1].refunds[0].total).toBe(
                productInOrder!.variants[0].priceWithTax - PARTIAL_PAYMENT_AMOUNT,
            );
        });

        it('refunding remaining amount of order with multiple payments', async () => {
            const { order } = await adminClient.query<Codegen.GetOrderQuery, Codegen.GetOrderQueryVariables>(
                GET_ORDER,
                {
                    id: orderId,
                },
            );
            const { refundOrder } = await adminClient.query<
                Codegen.RefundOrderMutation,
                Codegen.RefundOrderMutationVariables
            >(REFUND_ORDER, {
                input: {
                    lines: order!.lines.map(l => ({ orderLineId: l.id, quantity: 1 })),
                    shipping: order!.shippingWithTax,
                    adjustment: 0,
                    reason: 'second refund',
                    paymentId: payment1Id,
                },
            });
            refundGuard.assertSuccess(refundOrder);
            expect(refundOrder.total).toBe(order!.totalWithTax - order!.lines[0].unitPriceWithTax);

            const { order: orderWithPayments } = await adminClient.query<
                Codegen.GetOrderWithPaymentsQuery,
                Codegen.GetOrderWithPaymentsQueryVariables
            >(GET_ORDER_WITH_PAYMENTS, {
                id: orderId,
            });

            expect(orderWithPayments?.payments!.sort(sortById)[0].refunds.length).toBe(1);
            expect(orderWithPayments?.payments!.sort(sortById)[0].refunds[0].total).toBe(
                PARTIAL_PAYMENT_AMOUNT,
            );

            expect(orderWithPayments?.payments!.sort(sortById)[1].refunds.length).toBe(2);
            expect(orderWithPayments?.payments!.sort(sortById)[1].refunds[0].total).toBe(
                productInOrder!.variants[0].priceWithTax - PARTIAL_PAYMENT_AMOUNT,
            );
            expect(orderWithPayments?.payments!.sort(sortById)[1].refunds[1].total).toBe(
                productInOrder!.variants[0].priceWithTax + order!.shippingWithTax,
            );
        });

        // https://github.com/vendurehq/vendure/issues/847
        it('manual call to settlePayment works with multiple payments', async () => {
            const result = await createTestOrder(
                adminClient,
                shopClient,
                customers[1].emailAddress,
                password,
            );
            await proceedToArrangingPayment(shopClient);
            await shopClient.query<
                CodegenShop.AddPaymentToOrderMutation,
                CodegenShop.AddPaymentToOrderMutationVariables
            >(ADD_PAYMENT, {
                input: {
                    method: partialPaymentMethod.code,
                    metadata: {
                        amount: PARTIAL_PAYMENT_AMOUNT,
                        authorizeOnly: true,
                    },
                },
            });
            const { addPaymentToOrder: order } = await shopClient.query<
                CodegenShop.AddPaymentToOrderMutation,
                CodegenShop.AddPaymentToOrderMutationVariables
            >(ADD_PAYMENT, {
                input: {
                    method: singleStageRefundablePaymentMethod.code,
                    metadata: {},
                },
            });
            orderGuard.assertSuccess(order);

            expect(order.state).toBe('PaymentAuthorized');

            const { settlePayment } = await adminClient.query<
                Codegen.SettlePaymentMutation,
                Codegen.SettlePaymentMutationVariables
            >(SETTLE_PAYMENT, {
                id: order.payments!.find(p => p.method === partialPaymentMethod.code)!.id,
            });

            paymentGuard.assertSuccess(settlePayment);

            expect(settlePayment.state).toBe('Settled');

            const { order: order2 } = await adminClient.query<
                Codegen.GetOrderQuery,
                Codegen.GetOrderQueryVariables
            >(GET_ORDER, {
                id: order.id,
            });

            expect(order2?.state).toBe('PaymentSettled');
        });
    });

    // https://github.com/vendurehq/vendure/issues/2505
    describe('updating order customer', () => {
        let orderId: string;
        let customerId: string;

        it('set up order', async () => {
            const result = await createTestOrder(
                adminClient,
                shopClient,
                customers[1].emailAddress,
                password,
            );
            orderId = result.orderId;
            customerId = customers[1].id;

            await proceedToArrangingPayment(shopClient);
            const order = await addPaymentToOrder(shopClient, singleStageRefundablePaymentMethod);
            orderGuard.assertSuccess(order);
            expect(order.customer?.id).toBe(customerId);
        });

        it(
            'throws in invalid orderId',
            assertThrowsWithMessage(async () => {
                await adminClient.query<
                    Codegen.SetOrderCustomerMutation,
                    Codegen.SetOrderCustomerMutationVariables
                >(SET_ORDER_CUSTOMER, {
                    input: {
                        orderId: 'T_9999',
                        customerId: customers[2].id,
                        note: 'Testing',
                    },
                });
            }, 'No Order with the id "9999" could be found'),
        );

        it(
            'throws in invalid orderId',
            assertThrowsWithMessage(async () => {
                await adminClient.query<
                    Codegen.SetOrderCustomerMutation,
                    Codegen.SetOrderCustomerMutationVariables
                >(SET_ORDER_CUSTOMER, {
                    input: {
                        orderId,
                        customerId: 'T_999',
                        note: 'Testing',
                    },
                });
            }, 'No Customer with the id "999" could be found'),
        );

        it('update order customer', async () => {
            const newCustomerId = customers[2].id;
            const { setOrderCustomer } = await adminClient.query<
                Codegen.SetOrderCustomerMutation,
                Codegen.SetOrderCustomerMutationVariables
            >(SET_ORDER_CUSTOMER, {
                input: {
                    orderId,
                    customerId: customers[2].id,
                    note: 'Testing',
                },
            });

            expect(setOrderCustomer?.customer?.id).toBe(newCustomerId);
        });

        it('adds a history entry for the customer update', async () => {
            const { order } = await adminClient.query<
                Codegen.GetOrderHistoryQuery,
                Codegen.GetOrderHistoryQueryVariables
            >(GET_ORDER_HISTORY, {
                id: orderId,
                options: {
                    skip: 4,
                },
            });
            expect(order!.history.items.map(pick(['type', 'data']))).toEqual([
                {
                    data: {
                        previousCustomerId: customerId,
                        previousCustomerName: 'Trevor Donnelly',
                        newCustomerId: customers[2].id,
                        newCustomerName: `${customers[2].firstName} ${customers[2].lastName}`,
                        note: 'Testing',
                    },
                    type: HistoryEntryType.ORDER_CUSTOMER_UPDATED,
                },
            ]);
        });
    });

    describe('issues', () => {
        // https://github.com/vendurehq/vendure/issues/639
        it('returns fulfillments for Order with no lines', async () => {
            await shopClient.asAnonymousUser();
            // Apply a coupon code just to create an active order with no OrderLines
            await shopClient.query<
                CodegenShop.ApplyCouponCodeMutation,
                CodegenShop.ApplyCouponCodeMutationVariables
            >(APPLY_COUPON_CODE, {
                couponCode: 'TEST',
            });
            const { activeOrder } = await shopClient.query<CodegenShop.GetActiveOrderQuery>(GET_ACTIVE_ORDER);
            const { order } = await adminClient.query<
                Codegen.GetOrderFulfillmentsQuery,
                Codegen.GetOrderFulfillmentsQueryVariables
            >(GET_ORDER_FULFILLMENTS, {
                id: activeOrder!.id,
            });

            expect(order?.fulfillments).toEqual([]);
        });

        // https://github.com/vendurehq/vendure/issues/603
        it('orders correctly resolves quantities and OrderItems', async () => {
            await shopClient.asAnonymousUser();
            const { addItemToOrder } = await shopClient.query<
                CodegenShop.AddItemToOrderMutation,
                CodegenShop.AddItemToOrderMutationVariables
            >(ADD_ITEM_TO_ORDER, {
                productVariantId: 'T_1',
                quantity: 2,
            });
            orderGuard.assertSuccess(addItemToOrder);

            const { orders } = await adminClient.query<
                Codegen.GetOrderListWithQtyQuery,
                Codegen.GetOrderListWithQtyQueryVariables
            >(GET_ORDERS_LIST_WITH_QUANTITIES, {
                options: {
                    filter: {
                        code: { eq: addItemToOrder.code },
                    },
                },
            });

            expect(orders.items[0].totalQuantity).toBe(2);
            expect(orders.items[0].lines[0].quantity).toBe(2);
        });

        // https://github.com/vendurehq/vendure/issues/716
        it('get an Order with a deleted ShippingMethod', async () => {
            const { createShippingMethod: shippingMethod } = await adminClient.query<
                Codegen.CreateShippingMethodMutation,
                Codegen.CreateShippingMethodMutationVariables
            >(CREATE_SHIPPING_METHOD, {
                input: {
                    code: 'royal-mail',
                    translations: [{ languageCode: LanguageCode.en, name: 'Royal Mail', description: '' }],
                    fulfillmentHandler: manualFulfillmentHandler.code,
                    checker: {
                        code: defaultShippingEligibilityChecker.code,
                        arguments: [{ name: 'orderMinimum', value: '0' }],
                    },
                    calculator: {
                        code: defaultShippingCalculator.code,
                        arguments: [
                            { name: 'rate', value: '500' },
                            { name: 'taxRate', value: '0' },
                        ],
                    },
                },
            });
            await shopClient.asUserWithCredentials(customers[0].emailAddress, password);
            await shopClient.query<
                CodegenShop.AddItemToOrderMutation,
                CodegenShop.AddItemToOrderMutationVariables
            >(ADD_ITEM_TO_ORDER, {
                productVariantId: 'T_1',
                quantity: 2,
            });
            await shopClient.query<
                CodegenShop.SetShippingAddressMutation,
                CodegenShop.SetShippingAddressMutationVariables
            >(SET_SHIPPING_ADDRESS, {
                input: {
                    fullName: 'name',
                    streetLine1: '12 the street',
                    city: 'foo',
                    postalCode: '123456',
                    countryCode: 'US',
                },
            });
            const { setOrderShippingMethod: order } = await shopClient.query<
                CodegenShop.SetShippingMethodMutation,
                CodegenShop.SetShippingMethodMutationVariables
            >(SET_SHIPPING_METHOD, {
                id: shippingMethod.id,
            });
            orderGuard.assertSuccess(order);

            await adminClient.query<
                Codegen.DeleteShippingMethodMutation,
                Codegen.DeleteShippingMethodMutationVariables
            >(DELETE_SHIPPING_METHOD, {
                id: shippingMethod.id,
            });

            const { order: order2 } = await adminClient.query<
                Codegen.GetOrderQuery,
                Codegen.GetOrderQueryVariables
            >(GET_ORDER, {
                id: order.id,
            });
            expect(order2?.shippingLines[0]).toEqual({
                priceWithTax: 500,
                shippingMethod: pick(shippingMethod, ['id', 'name', 'code', 'description']),
            });
        });

        // https://github.com/vendurehq/vendure/issues/868
        it('allows multiple refunds of same OrderLine', async () => {
            await shopClient.asUserWithCredentials(customers[0].emailAddress, password);
            const { addItemToOrder } = await shopClient.query<
                CodegenShop.AddItemToOrderMutation,
                CodegenShop.AddItemToOrderMutationVariables
            >(ADD_ITEM_TO_ORDER, {
                productVariantId: 'T_1',
                quantity: 2,
            });
            await proceedToArrangingPayment(shopClient);
            const order = await addPaymentToOrder(shopClient, singleStageRefundablePaymentMethod);
            orderGuard.assertSuccess(order);

            const { refundOrder: refund1 } = await adminClient.query<
                Codegen.RefundOrderMutation,
                Codegen.RefundOrderMutationVariables
            >(REFUND_ORDER, {
                input: {
                    lines: order.lines.map(l => ({ orderLineId: l.id, quantity: 1 })),
                    shipping: 0,
                    adjustment: 0,
                    reason: 'foo',
                    paymentId: order.payments![0].id,
                },
            });
            refundGuard.assertSuccess(refund1);

            const { refundOrder: refund2 } = await adminClient.query<
                Codegen.RefundOrderMutation,
                Codegen.RefundOrderMutationVariables
            >(REFUND_ORDER, {
                input: {
                    lines: order.lines.map(l => ({ orderLineId: l.id, quantity: 1 })),
                    shipping: 0,
                    adjustment: 0,
                    reason: 'foo',
                    paymentId: order.payments![0].id,
                },
            });
            refundGuard.assertSuccess(refund2);
        });

        // https://github.com/vendurehq/vendure/issues/1125
        it('resolves deleted Product of OrderLine ProductVariants', async () => {
            await shopClient.asUserWithCredentials(customers[0].emailAddress, password);
            const { addItemToOrder } = await shopClient.query<
                CodegenShop.AddItemToOrderMutation,
                CodegenShop.AddItemToOrderMutationVariables
            >(ADD_ITEM_TO_ORDER, {
                productVariantId: 'T_7',
                quantity: 1,
            });

            await proceedToArrangingPayment(shopClient);
            const order = await addPaymentToOrder(shopClient, singleStageRefundablePaymentMethod);
            orderGuard.assertSuccess(order);

            await adminClient.query<Codegen.DeleteProductMutation, Codegen.DeleteProductMutationVariables>(
                DELETE_PRODUCT,
                {
                    id: 'T_3',
                },
            );

            const { activeCustomer } = await shopClient.query<
                CodegenShop.GetActiveCustomerWithOrdersProductSlugQuery,
                CodegenShop.GetActiveCustomerWithOrdersProductSlugQueryVariables
            >(GET_ACTIVE_CUSTOMER_WITH_ORDERS_PRODUCT_SLUG, {
                options: {
                    sort: {
                        createdAt: SortOrder.ASC,
                    },
                },
            });
            expect(
                activeCustomer!.orders.items[activeCustomer!.orders.items.length - 1].lines[0].productVariant
                    .product.slug,
            ).toBe('gaming-pc');
        });

        // https://github.com/vendurehq/vendure/issues/1508
        it('resolves price of deleted ProductVariant of OrderLine', async () => {
            const { activeCustomer } = await shopClient.query<
                CodegenShop.GetActiveCustomerWithOrdersProductPriceQuery,
                CodegenShop.GetActiveCustomerWithOrdersProductPriceQueryVariables
            >(GET_ACTIVE_CUSTOMER_WITH_ORDERS_PRODUCT_PRICE, {
                options: {
                    sort: {
                        createdAt: SortOrder.ASC,
                    },
                },
            });
            expect(
                activeCustomer!.orders.items[activeCustomer!.orders.items.length - 1].lines[0].productVariant
                    .price,
            ).toBe(108720);
        });

        // https://github.com/vendurehq/vendure/issues/2204
        it('creates correct history entries and results in correct state when manually adding payment to order', async () => {
            await shopClient.asUserWithCredentials(customers[0].emailAddress, password);
            const { addItemToOrder } = await shopClient.query<
                CodegenShop.AddItemToOrderMutation,
                CodegenShop.AddItemToOrderMutationVariables
            >(ADD_ITEM_TO_ORDER, {
                productVariantId: 'T_1',
                quantity: 2,
            });
            await proceedToArrangingPayment(shopClient);
            orderGuard.assertSuccess(addItemToOrder);

            const { addManualPaymentToOrder } = await adminClient.query(AddManualPaymentDocument, {
                input: {
                    orderId: addItemToOrder.id,
                    metadata: {},
                    method: twoStagePaymentMethod.code,
                    transactionId: '12345',
                },
            });

            orderGuard.assertSuccess(addManualPaymentToOrder);

            const { order: orderWithHistory } = await adminClient.query(GetOrderHistoryDocument, {
                id: addManualPaymentToOrder.id,
            });

            const stateTransitionHistory = orderWithHistory!.history.items
                .filter(i => i.type === HistoryEntryType.ORDER_STATE_TRANSITION)
                .map(i => i.data);

            expect(stateTransitionHistory).toEqual([
                { from: 'Created', to: 'AddingItems' },
                { from: 'AddingItems', to: 'ArrangingPayment' },
                { from: 'ArrangingPayment', to: 'PaymentSettled' },
            ]);

            const { order } = await adminClient.query(GetOrderDocument, {
                id: addManualPaymentToOrder.id,
            });

            expect(order!.state).toBe('PaymentSettled');
        });

        // https://github.com/vendurehq/vendure/issues/2191
        it('correctly transitions order & fulfillment on partial fulfillment being shipped', async () => {
            await shopClient.asUserWithCredentials(customers[0].emailAddress, password);
            const { addItemToOrder } = await shopClient.query<
                CodegenShop.AddItemToOrderMutation,
                CodegenShop.AddItemToOrderMutationVariables
            >(ADD_ITEM_TO_ORDER, {
                productVariantId: 'T_6',
                quantity: 3,
            });
            await proceedToArrangingPayment(shopClient);
            orderGuard.assertSuccess(addItemToOrder);

            const order = await addPaymentToOrder(shopClient, singleStageRefundablePaymentMethod);
            orderGuard.assertSuccess(order);

            const { addFulfillmentToOrder } = await adminClient.query(CreateFulfillmentDocument, {
                input: {
                    lines: [{ orderLineId: order.lines[0].id, quantity: 2 }],
                    handler: {
                        code: manualFulfillmentHandler.code,
                        arguments: [
                            { name: 'method', value: 'Test2' },
                            { name: 'trackingCode', value: '222' },
                        ],
                    },
                },
            });
            fulfillmentGuard.assertSuccess(addFulfillmentToOrder);

            const { transitionFulfillmentToState } = await adminClient.query(TransitFulfillmentDocument, {
                id: addFulfillmentToOrder.id,
                state: 'Shipped',
            });
            fulfillmentGuard.assertSuccess(transitionFulfillmentToState);

            expect(transitionFulfillmentToState.id).toBe(addFulfillmentToOrder.id);
            expect(transitionFulfillmentToState.state).toBe('Shipped');

            const { order: order2 } = await adminClient.query(GetOrderDocument, {
                id: order.id,
            });
            expect(order2?.state).toBe('PartiallyShipped');
        });
    });

    describe('multiple items to order', () => {
        it('adds multiple items to a new active order', async () => {
            await shopClient.asAnonymousUser();
            const { addItemsToOrder } = await shopClient.query<
                CodegenShop.AddItemsToOrderMutation,
                CodegenShop.AddItemsToOrderMutationVariables
            >(ADD_MULTIPLE_ITEMS_TO_ORDER, {
                inputs: [
                    {
                        productVariantId: 'T_1',
                        quantity: 5,
                    },
                    {
                        productVariantId: 'T_2',
                        quantity: 3,
                    },
                ],
            });
            expect(addItemsToOrder.order.lines.length).toBe(2);
            expect(addItemsToOrder.order.lines[0].quantity).toBe(5);
            expect(addItemsToOrder.order.lines[1].quantity).toBe(3);
        });

        it('adds successful items and returns error results for failed items', async () => {
            await shopClient.asAnonymousUser();
            const { addItemsToOrder } = await shopClient.query<
                CodegenShop.AddItemsToOrderMutation,
                CodegenShop.AddItemsToOrderMutationVariables
            >(ADD_MULTIPLE_ITEMS_TO_ORDER, {
                inputs: [
                    {
                        productVariantId: 'T_1',
                        quantity: 1,
                    },
                    {
                        productVariantId: 'T_2',
                        quantity: 999999, // Exceeds limit
                    },
                ],
            });
            const t1 = addItemsToOrder.order.lines.find(l => l.productVariant.id === 'T_1');
            // Should have added 1 of T_1
            expect(t1?.quantity).toBe(1);
            // Should not have added T_2
            const t2 = addItemsToOrder.order.lines.find(l => l.productVariant.id === 'T_2');
            expect(t2).toBeUndefined();
            // Should have errors
            expect(addItemsToOrder.errorResults.length).toBe(1);
            expect(addItemsToOrder.errorResults[0].errorCode).toBe('ORDER_LIMIT_ERROR');
            expect(addItemsToOrder.errorResults[0].message).toBe('ORDER_LIMIT_ERROR');
        });
    });

    describe('update order currency', () => {
        let product1: Codegen.GetProductWithVariantsQuery['product'];

        beforeAll(async () => {
            product1 = (
                await adminClient.query<
                    Codegen.GetProductWithVariantsQuery,
                    Codegen.GetProductWithVariantsQueryVariables
                >(GET_PRODUCT_WITH_VARIANTS, { id: 'T_1' })
            ).product!;

            // Make "EGP" available in the channel for testing
            await adminClient.query<Codegen.UpdateChannelMutation, Codegen.UpdateChannelMutationVariables>(
                UPDATE_CHANNEL,
                {
                    input: {
                        id: 'T_1',
                        availableCurrencyCodes: [CurrencyCode.USD, CurrencyCode.EGP],
                    },
                },
            );

            // Add 1st variant of product 1 to the channel
            await adminClient.query<
                Codegen.AssignProductVariantsToChannelMutation,
                { input: Codegen.AssignProductVariantsToChannelInput }
            >(ASSIGN_PRODUCTVARIANT_TO_CHANNEL, {
                input: {
                    channelId: 'T_1',
                    productVariantIds: product1.variants.map(v => v.id),
                    priceFactor: 1,
                },
            });
        });

        it('should throw UserInputError if new currency is not available in the channel', async () => {
            await shopClient.asAnonymousUser();
            await expect(
                shopClient.query<
                    CodegenShop.SetCurrencyCodeForOrderMutation,
                    CodegenShop.SetCurrencyCodeForOrderMutationVariables
                >(SET_CURRENCY_CODE_FOR_ORDER, { currencyCode: CurrencyCode.AUD }),
            ).rejects.toThrow('error.currency-not-available');
        });

        it('Should update the order currency and return the updated order', async () => {
            await shopClient.asAnonymousUser();
            // create simple order using the available variant
            const { addItemsToOrder } = await shopClient.query<
                CodegenShop.AddItemsToOrderMutation,
                CodegenShop.AddItemsToOrderMutationVariables
            >(ADD_MULTIPLE_ITEMS_TO_ORDER, {
                inputs: [
                    {
                        productVariantId: product1!.variants[0].id,
                        quantity: 1,
                    },
                ],
            });

            expect(addItemsToOrder.order.currencyCode).toBe(CurrencyCode.USD);
            expect(addItemsToOrder.order.lines.length).toBe(1);

            const response = await shopClient.query<
                CodegenShop.SetCurrencyCodeForOrderMutation,
                CodegenShop.SetCurrencyCodeForOrderMutationVariables
            >(SET_CURRENCY_CODE_FOR_ORDER, { currencyCode: CurrencyCode.EGP });

            const setCurrencyCodeForOrder = response.setCurrencyCodeForOrder;

            expect((setCurrencyCodeForOrder as UpdatedOrderFragment).currencyCode).toBe(CurrencyCode.EGP);
            expect((setCurrencyCodeForOrder as UpdatedOrderFragment).lines?.length).toBe(1);
        });
    });
});

async function createTestOrder(
    adminClient: SimpleGraphQLClient,
    shopClient: SimpleGraphQLClient,
    emailAddress: string,
    password: string,
): Promise<{
    orderId: string;
    product: Codegen.GetProductWithVariantsQuery['product'];
    productVariantId: string;
}> {
    const result = await adminClient.query<
        Codegen.GetProductWithVariantsQuery,
        Codegen.GetProductWithVariantsQueryVariables
    >(GET_PRODUCT_WITH_VARIANTS, {
        id: 'T_3',
    });
    const product = result.product!;
    const productVariantId = product.variants[0].id;

    // Set the ProductVariant to trackInventory
    const { updateProductVariants } = await adminClient.query<
        Codegen.UpdateProductVariantsMutation,
        Codegen.UpdateProductVariantsMutationVariables
    >(UPDATE_PRODUCT_VARIANTS, {
        input: [
            {
                id: productVariantId,
                trackInventory: GlobalFlag.TRUE,
            },
        ],
    });

    // Add the ProductVariant to the Order
    await shopClient.asUserWithCredentials(emailAddress, password);
    const { addItemToOrder } = await shopClient.query<
        CodegenShop.AddItemToOrderMutation,
        CodegenShop.AddItemToOrderMutationVariables
    >(ADD_ITEM_TO_ORDER, {
        productVariantId,
        quantity: 2,
    });
    const orderId = (addItemToOrder as CodegenShop.UpdatedOrderFragment).id;
    return { product, productVariantId, orderId };
}

async function getUnfulfilledOrderLineInput(
    client: SimpleGraphQLClient,
    id: string,
): Promise<OrderLineInput[]> {
    const { order } = await client.query<Codegen.GetOrderQuery, Codegen.GetOrderQueryVariables>(GET_ORDER, {
        id,
    });
    const allFulfillmentLines =
        order?.fulfillments
            ?.filter(f => f.state !== 'Cancelled')
            .reduce((all, f) => [...all, ...f.lines], [] as Codegen.FulfillmentFragment['lines']) || [];

    const unfulfilledItems =
        order?.lines
            .map(l => {
                const fulfilledQuantity = allFulfillmentLines
                    .filter(fl => fl.orderLineId === l.id)
                    .reduce((sum, fl) => sum + fl.quantity, 0);
                return { orderLineId: l.id, unfulfilled: l.quantity - fulfilledQuantity };
            })
            .filter(l => 0 < l.unfulfilled) || [];

    return unfulfilledItems.map(l => ({
        orderLineId: l.orderLineId,
        quantity: l.unfulfilled,
    }));
}

export const GET_ORDER_LIST_FULFILLMENTS = gql`
    query GetOrderListFulfillments {
        orders {
            items {
                id
                state
                fulfillments {
                    id
                    state
                    nextStates
                    method
                }
            }
        }
    }
`;

export const GET_ORDER_FULFILLMENT_ITEMS = gql`
    query GetOrderFulfillmentItems($id: ID!) {
        order(id: $id) {
            id
            state
            fulfillments {
                ...Fulfillment
            }
        }
    }
    ${FULFILLMENT_FRAGMENT}
`;

const REFUND_FRAGMENT = gql`
    fragment Refund on Refund {
        id
        state
        items
        transactionId
        shipping
        total
        metadata
    }
`;

export const REFUND_ORDER = gql`
    mutation RefundOrder($input: RefundOrderInput!) {
        refundOrder(input: $input) {
            ...Refund
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
    ${REFUND_FRAGMENT}
`;

export const SETTLE_REFUND = gql`
    mutation SettleRefund($input: SettleRefundInput!) {
        settleRefund(input: $input) {
            ...Refund
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
    ${REFUND_FRAGMENT}
`;

export const ADD_NOTE_TO_ORDER = gql`
    mutation AddNoteToOrder($input: AddNoteToOrderInput!) {
        addNoteToOrder(input: $input) {
            id
        }
    }
`;

export const UPDATE_ORDER_NOTE = gql`
    mutation UpdateOrderNote($input: UpdateOrderNoteInput!) {
        updateOrderNote(input: $input) {
            id
            data
            isPublic
        }
    }
`;

export const DELETE_ORDER_NOTE = gql`
    mutation DeleteOrderNote($id: ID!) {
        deleteOrderNote(id: $id) {
            result
            message
        }
    }
`;

const GET_ORDER_WITH_PAYMENTS = gql`
    query GetOrderWithPayments($id: ID!) {
        order(id: $id) {
            id
            payments {
                id
                errorMessage
                metadata
                refunds {
                    id
                    total
                }
            }
        }
    }
`;

export const GET_ORDER_LINE_FULFILLMENTS = gql`
    query GetOrderLineFulfillments($id: ID!) {
        order(id: $id) {
            id
            lines {
                id
                fulfillmentLines {
                    fulfillment {
                        id
                        state
                    }
                    orderLineId
                    quantity
                }
            }
        }
    }
`;

const GET_ORDERS_LIST_WITH_QUANTITIES = gql`
    query GetOrderListWithQty($options: OrderListOptions) {
        orders(options: $options) {
            items {
                id
                code
                totalQuantity
                lines {
                    id
                    quantity
                }
            }
        }
    }
`;

const CANCEL_PAYMENT = gql`
    mutation CancelPayment($paymentId: ID!) {
        cancelPayment(id: $paymentId) {
            ...Payment
            ... on ErrorResult {
                errorCode
                message
            }
            ... on PaymentStateTransitionError {
                transitionError
            }
            ... on CancelPaymentError {
                paymentErrorMessage
            }
        }
    }
    ${PAYMENT_FRAGMENT}
`;

const SET_ORDER_CUSTOMER = gql`
    mutation SetOrderCustomer($input: SetOrderCustomerInput!) {
        setOrderCustomer(input: $input) {
            id
            customer {
                id
            }
        }
    }
`;
