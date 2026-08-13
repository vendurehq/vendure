/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
    CurrencyCode,
    DeletionResult,
    ErrorCode,
    GlobalFlag,
    HistoryEntryType,
    LanguageCode,
    SortOrder,
    StockMovementType,
} from '@vendure/common/lib/generated-types';
import { omit } from '@vendure/common/lib/omit';
import { pick } from '@vendure/common/lib/pick';
import {
    OrderService,
    RequestContextService,
    defaultShippingCalculator,
    defaultShippingEligibilityChecker,
    manualFulfillmentHandler,
    mergeConfig,
} from '@vendure/core';
import {
    ErrorResultGuard,
    SimpleGraphQLClient,
    createErrorResultGuard,
    createTestEnvironment,
} from '@vendure/testing';
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
    singleStageRefundFailingPaymentMethod,
    singleStageRefundablePaymentMethod,
    twoStagePaymentMethod,
} from './fixtures/test-payment-methods';
import {
    canceledOrderFragment,
    fulfillmentFragment,
    paymentFragment,
    refundFragment,
} from './graphql/fragments-admin';
import { FragmentOf, ResultOf } from './graphql/graphql-admin';
import { FragmentOf as FragmentOfShop } from './graphql/graphql-shop';
import {
    addManualPaymentDocument,
    addNoteToOrderDocument,
    cancelOrderDocument,
    cancelPaymentDocument,
    createFulfillmentDocument,
    createShippingMethodDocument,
    deleteOrderNoteDocument,
    deleteProductDocument,
    deleteShippingMethodDocument,
    getCustomerListDocument,
    getOrderAssetEdgeCaseDocument,
    getOrderDocument,
    getOrderFulfillmentsDocument,
    getOrderHistoryDocument,
    getOrderLineFulfillmentsDocument,
    getOrderListDocument,
    getOrderListFulfillmentsDocument,
    getOrderListWithQtyDocument,
    getOrderWithLineCalculatedPropsDocument,
    getOrderWithPaymentsDocument,
    getProductWithVariantsDocument,
    getStockMovementDocument,
    refundOrderDocument,
    setOrderCustomerDocument,
    settlePaymentDocument,
    settleRefundDocument,
    transitFulfillmentDocument,
    updateChannelDocument,
    updateOrderNoteDocument,
    updateProductVariantsDocument,
} from './graphql/shared-definitions';
import {
    addItemToOrderDocument,
    addMultipleItemsToOrderDocument,
    addPaymentDocument,
    applyCouponCodeDocument,
    getActiveCustomerWithOrdersProductPriceDocument,
    getActiveCustomerWithOrdersProductSlugDocument,
    getActiveOrderDocument,
    getOrderByCodeWithPaymentsDocument,
    setCurrencyCodeForOrderDocument,
    setCustomerDocument,
    setShippingAddressDocument,
    setShippingMethodDocument,
    testOrderWithPaymentsFragment,
    transitionToStateDocument,
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
    let customers: ResultOf<typeof getCustomerListDocument>['customers']['items'];
    const password = 'test';

    type RefundFragment = FragmentOf<typeof refundFragment>;
    type PaymentFragment = FragmentOf<typeof paymentFragment>;
    type FulfillmentFragment = FragmentOf<typeof fulfillmentFragment>;
    type CanceledOrderFragment = FragmentOf<typeof canceledOrderFragment>;
    type ShopOrderFragment = FragmentOfShop<typeof testOrderWithPaymentsFragment>;

    const canceledOrderGuard: ErrorResultGuard<CanceledOrderFragment> = createErrorResultGuard(
        input => !!input.lines,
    );
    const shopOrderGuard: ErrorResultGuard<ShopOrderFragment> = createErrorResultGuard(
        input => !!input.lines,
    );
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
        const result = await adminClient.query(getCustomerListDocument, {
            options: {
                take: 3,
            },
        });
        customers = result.customers.items;
        await shopClient.asUserWithCredentials(customers[0].emailAddress, password);
        await shopClient.query(addItemToOrderDocument, {
            productVariantId: 'T_1',
            quantity: 1,
        });
        await shopClient.query(addItemToOrderDocument, {
            productVariantId: 'T_2',
            quantity: 1,
        });
        await shopClient.asUserWithCredentials(customers[1].emailAddress, password);
        await shopClient.query(addItemToOrderDocument, {
            productVariantId: 'T_2',
            quantity: 1,
        });
        await shopClient.query(addItemToOrderDocument, {
            productVariantId: 'T_3',
            quantity: 3,
        });
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('order history initially contains Created -> AddingItems transition', async () => {
        const { order } = await adminClient.query(getOrderHistoryDocument, { id: 'T_1' });
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
            const result = await adminClient.query(getOrderListDocument);
            expect(result.orders.items.map(o => o.id).sort()).toEqual(['T_1', 'T_2']);
        });

        it('filtering by total', async () => {
            const result = await adminClient.query(getOrderListDocument, {
                options: {
                    filter: { total: { gt: 1000_00 } },
                },
            });
            expect(result.orders.items.map(o => o.id).sort()).toEqual(['T_1', 'T_2']);
        });

        it('filtering by total using boolean expression', async () => {
            const result = await adminClient.query(getOrderListDocument, {
                options: {
                    filter: {
                        _and: [{ total: { gt: 1000_00 } }],
                    },
                },
            });
            expect(result.orders.items.map(o => o.id).sort()).toEqual(['T_1', 'T_2']);
        });

        it('order', async () => {
            const result = await adminClient.query(getOrderDocument, {
                id: 'T_2',
            });
            expect(result.order!.id).toBe('T_2');
        });

        it('correctly resolves asset preview urls with edge-case query', async () => {
            // This came up as a strange edge-case where the AssetInterceptorPlugin was unable to
            // correctly transform the asset preview URL. It is not directly to do with Orders per se,
            // but manifested when attempting an order-related query.
            const result = await adminClient.query(getOrderAssetEdgeCaseDocument, {
                id: 'T_2',
            });
            expect(result.order!.lines.length).toBe(2);
            expect(result.order!.lines.map((l: any) => l.featuredAsset?.preview)).toEqual([
                'test-url/test-assets/derick-david-409858-unsplash__preview.jpg',
                'test-url/test-assets/derick-david-409858-unsplash__preview.jpg',
            ]);
        });

        it('order with calculated line properties', async () => {
            const result = await adminClient.query(getOrderWithLineCalculatedPropsDocument, {
                id: 'T_2',
            });
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
            const result = await adminClient.query(getOrderListDocument, {
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
            const result = await adminClient.query(getOrderListDocument, {
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
            const result = await adminClient.query(getOrderListDocument, {
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
                const { orders } = await adminClient.query(getOrderListDocument, {
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
            const result = await adminClient.query(getOrderListDocument, {
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
            const result = await adminClient.query(getOrderListDocument, {
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
            const result = await adminClient.query(getOrderListDocument, {
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
            const result = await adminClient.query(getOrderListDocument, {
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
            shopOrderGuard.assertSuccess(order);

            expect(order.state).toBe('PaymentAuthorized');

            const payment = 'payments' in order ? order.payments![0] : null;
            if (!payment) throw new Error('Expected payment');
            const { settlePayment } = await adminClient.query(settlePaymentDocument, {
                id: payment.id,
            });
            paymentGuard.assertErrorResult(settlePayment);

            expect(settlePayment.message).toBe('Settling the payment failed');
            expect(settlePayment.errorCode).toBe(ErrorCode.SETTLE_PAYMENT_ERROR);
            expect((settlePayment as any).paymentErrorMessage).toBe('Something went horribly wrong');

            const result = await adminClient.query(getOrderDocument, {
                id: order.id,
            });

            expect(result.order!.state).toBe('PaymentAuthorized');
            expect(result.order!.payments![0].state).toBe('Cancelled');
            firstOrderCode = 'code' in order ? order.code : '';
            firstOrderId = order.id;
        });

        it('public payment metadata available in Shop API', async () => {
            const { orderByCode } = await shopClient.query(getOrderByCodeWithPaymentsDocument, {
                code: firstOrderCode,
            });

            expect(orderByCode?.payments?.[0].metadata).toEqual({
                public: {
                    publicCreatePaymentData: 'public',
                    publicSettlePaymentData: 'public',
                },
            });
        });

        it('public and private payment metadata available in Admin API', async () => {
            const { order } = await adminClient.query(getOrderWithPaymentsDocument, { id: firstOrderId });

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
            shopOrderGuard.assertSuccess(order);

            expect(order.state).toBe('PaymentAuthorized');
            expect(onTransitionSpy).toHaveBeenCalledTimes(1);
            expect(onTransitionSpy.mock.calls[0][0]).toBe('Created');
            expect(onTransitionSpy.mock.calls[0][1]).toBe('Authorized');

            const payment = 'payments' in order ? order.payments![0] : null;
            if (!payment) throw new Error('Expected payment');
            const { settlePayment } = await adminClient.query(settlePaymentDocument, {
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

            const result = await adminClient.query(getOrderDocument, {
                id: order.id,
            });

            expect(result.order!.state).toBe('PaymentSettled');
            expect(result.order!.payments![0].state).toBe('Settled');
        });

        it('order history contains expected entries', async () => {
            const { order } = await adminClient.query(getOrderHistoryDocument, {
                id: 'T_2',
                options: { sort: { id: SortOrder.ASC } },
            });
            expect(order?.history.items.map(pick(['type', 'data']))).toEqual([
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
            const result = await adminClient.query(getOrderListDocument, {
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
            const { order } = await adminClient.query(getOrderDocument, {
                id: orderId,
            });
            expect(order!.state).toBe('PaymentSettled');
            const { addFulfillmentToOrder } = await adminClient.query(createFulfillmentDocument, {
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
            const { order } = await adminClient.query(getOrderDocument, {
                id: orderId,
            });
            expect(order!.state).toBe('PaymentSettled');
            const { addFulfillmentToOrder } = await adminClient.query(createFulfillmentDocument, {
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
            const { order } = await adminClient.query(getOrderDocument, {
                id: orderId,
            });
            expect(order!.state).toBe('PaymentSettled');
            const lines = order!.lines;

            const { addFulfillmentToOrder } = await adminClient.query(createFulfillmentDocument, {
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

            const result = await adminClient.query(getOrderDocument, {
                id: orderId,
            });

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

            const { addFulfillmentToOrder } = await adminClient.query(createFulfillmentDocument, {
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
            const { transitionFulfillmentToState } = await adminClient.query(transitFulfillmentDocument, {
                id: f2Id,
                state: 'Cancelled',
            });
            fulfillmentGuard.assertSuccess(transitionFulfillmentToState);

            expect(transitionFulfillmentToState.id).toBe('T_2');
            expect(transitionFulfillmentToState.state).toBe('Cancelled');
        });

        it('order.fulfillments still lists second (cancelled) fulfillment', async () => {
            const { order } = await adminClient.query(getOrderFulfillmentsDocument, {
                id: orderId,
            });

            expect(order?.fulfillments?.sort(sortById).map(pick(['id', 'state']))).toEqual([
                { id: f1Id, state: 'Pending' },
                { id: f2Id, state: 'Cancelled' },
            ]);
        });

        it('order.fulfillments.summary', async () => {
            const { order } = await adminClient.query(getOrderFulfillmentsDocument, {
                id: orderId,
            });

            expect(order?.fulfillments?.sort(sortById).map(pick(['id', 'state', 'summary']))).toEqual([
                { id: f1Id, state: 'Pending', summary: [{ orderLine: { id: 'T_3' }, quantity: 1 }] },
                { id: f2Id, state: 'Cancelled', summary: [{ orderLine: { id: 'T_4' }, quantity: 3 }] },
            ]);
        });

        it('lines.fulfillments', async () => {
            const { order } = await adminClient.query(getOrderLineFulfillmentsDocument, {
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
            const { addFulfillmentToOrder } = await adminClient.query(createFulfillmentDocument, {
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
            const { order } = await adminClient.query(getOrderDocument, {
                id: orderId,
            });
            const { addFulfillmentToOrder } = await adminClient.query(createFulfillmentDocument, {
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
            const { transitionFulfillmentToState } = await adminClient.query(transitFulfillmentDocument, {
                id: f1Id,
                state: 'Shipped',
            });
            fulfillmentGuard.assertSuccess(transitionFulfillmentToState);

            expect(transitionFulfillmentToState.id).toBe(f1Id);
            expect(transitionFulfillmentToState.state).toBe('Shipped');

            const { order } = await adminClient.query(getOrderDocument, {
                id: orderId,
            });
            expect(order?.state).toBe('PartiallyShipped');
        });

        it('transitions the third fulfillment from created to Shipped and automatically change the order state to Shipped', async () => {
            const { transitionFulfillmentToState } = await adminClient.query(transitFulfillmentDocument, {
                id: f3Id,
                state: 'Shipped',
            });
            fulfillmentGuard.assertSuccess(transitionFulfillmentToState);

            expect(transitionFulfillmentToState.id).toBe(f3Id);
            expect(transitionFulfillmentToState.state).toBe('Shipped');

            const { order } = await adminClient.query(getOrderDocument, {
                id: orderId,
            });
            expect(order?.state).toBe('Shipped');
        });

        it('transitions the first fulfillment from Shipped to Delivered and change the order state to PartiallyDelivered', async () => {
            const { transitionFulfillmentToState } = await adminClient.query(transitFulfillmentDocument, {
                id: f1Id,
                state: 'Delivered',
            });
            fulfillmentGuard.assertSuccess(transitionFulfillmentToState);

            expect(transitionFulfillmentToState.id).toBe(f1Id);
            expect(transitionFulfillmentToState.state).toBe('Delivered');

            const { order } = await adminClient.query(getOrderDocument, {
                id: orderId,
            });
            expect(order?.state).toBe('PartiallyDelivered');
        });

        it('transitions the third fulfillment from Shipped to Delivered and change the order state to Delivered', async () => {
            const { transitionFulfillmentToState } = await adminClient.query(transitFulfillmentDocument, {
                id: f3Id,
                state: 'Delivered',
            });
            fulfillmentGuard.assertSuccess(transitionFulfillmentToState);

            expect(transitionFulfillmentToState.id).toBe(f3Id);
            expect(transitionFulfillmentToState.state).toBe('Delivered');

            const { order } = await adminClient.query(getOrderDocument, {
                id: orderId,
            });
            expect(order?.state).toBe('Delivered');
        });

        it('order history contains expected entries', async () => {
            const { order } = await adminClient.query(getOrderHistoryDocument, {
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
            const { order } = await adminClient.query(getOrderFulfillmentsDocument, {
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
            const { orders } = await adminClient.query(getOrderListFulfillmentsDocument);

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
            const { order } = await adminClient.query(getOrderDocument, {
                id: testOrder.orderId,
            });
            expect(order!.state).toBe('AddingItems');
            await adminClient.query(cancelOrderDocument, {
                input: {
                    orderId: testOrder.orderId,
                },
            });

            const { order: order2 } = await adminClient.query(getOrderDocument, {
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
            const { order } = await adminClient.query(getOrderDocument, {
                id: testOrder.orderId,
            });
            expect(order!.state).toBe('ArrangingPayment');
            await adminClient.query(cancelOrderDocument, {
                input: {
                    orderId: testOrder.orderId,
                },
            });

            const { order: order2 } = await adminClient.query(getOrderDocument, {
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
            shopOrderGuard.assertSuccess(order);

            expect(order.state).toBe('PaymentAuthorized');

            const result1 = await adminClient.query(getStockMovementDocument, {
                id: 'T_3',
            });
            let variant1 = result1.product!.variants[0];
            expect(variant1.stockOnHand).toBe(100);
            expect(variant1.stockAllocated).toBe(2);
            expect(variant1.stockMovements.items.map(pick(['type', 'quantity']))).toEqual([
                { type: StockMovementType.ADJUSTMENT, quantity: 100 },
                { type: StockMovementType.ALLOCATION, quantity: 2 },
            ]);

            const { cancelOrder } = await adminClient.query(cancelOrderDocument, {
                input: {
                    orderId: testOrder.orderId,
                    cancelShipping: true,
                },
            });
            canceledOrderGuard.assertSuccess(cancelOrder);

            expect(cancelOrder.lines.sort((a, b) => (a.id > b.id ? 1 : -1))).toEqual([
                { id: 'T_7', quantity: 0 },
            ]);
            const { order: order2 } = await adminClient.query(getOrderDocument, {
                id: testOrder.orderId,
            });
            expect(order2!.active).toBe(false);
            expect(order2!.state).toBe('Cancelled');
            expect(order2!.totalWithTax).toBe(0);
            expect(order2!.shippingWithTax).toBe(0);

            const result2 = await adminClient.query(getStockMovementDocument, {
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
            const result = await adminClient.query(getStockMovementDocument, {
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
        let product: ResultOf<typeof getProductWithVariantsDocument>['product'];

        beforeAll(async () => {
            const result = await createTestOrder(
                adminClient,
                shopClient,
                customers[0].emailAddress,
                password,
            );
            orderId = result.orderId;
            product = result.product;
        });

        it('cannot cancel from AddingItems state', async () => {
            const { order } = await adminClient.query(getOrderDocument, {
                id: orderId,
            });
            expect(order!.state).toBe('AddingItems');

            const { cancelOrder } = await adminClient.query(cancelOrderDocument, {
                input: {
                    orderId,
                    lines: order!.lines.map(l => ({ orderLineId: l.id, quantity: 1 })),
                },
            });
            canceledOrderGuard.assertErrorResult(cancelOrder);

            expect(cancelOrder.message).toBe(
                'Cannot cancel OrderLines from an Order in the "AddingItems" state',
            );
            expect(cancelOrder.errorCode).toBe(ErrorCode.CANCEL_ACTIVE_ORDER_ERROR);
        });

        it('cannot cancel from ArrangingPayment state', async () => {
            await proceedToArrangingPayment(shopClient, 2);
            const { order } = await adminClient.query(getOrderDocument, {
                id: orderId,
            });
            expect(order!.state).toBe('ArrangingPayment');
            const { cancelOrder } = await adminClient.query(cancelOrderDocument, {
                input: {
                    orderId,
                    lines: order!.lines.map(l => ({ orderLineId: l.id, quantity: 1 })),
                },
            });
            canceledOrderGuard.assertErrorResult(cancelOrder);

            expect(cancelOrder.message).toBe(
                'Cannot cancel OrderLines from an Order in the "ArrangingPayment" state',
            );
            expect(cancelOrder.errorCode).toBe(ErrorCode.CANCEL_ACTIVE_ORDER_ERROR);
        });

        it('returns error result if lines are empty', async () => {
            const order = await addPaymentToOrder(shopClient, twoStagePaymentMethod);
            shopOrderGuard.assertSuccess(order);

            expect(order.state).toBe('PaymentAuthorized');

            const { cancelOrder } = await adminClient.query(cancelOrderDocument, {
                input: {
                    orderId,
                    lines: [],
                },
            });
            canceledOrderGuard.assertErrorResult(cancelOrder);

            expect(cancelOrder.message).toBe('At least one OrderLine must be specified');
            expect(cancelOrder.errorCode).toBe(ErrorCode.EMPTY_ORDER_LINE_SELECTION_ERROR);
        });

        it('returns error result if all quantities zero', async () => {
            const { order } = await adminClient.query(getOrderDocument, {
                id: orderId,
            });
            const { cancelOrder } = await adminClient.query(cancelOrderDocument, {
                input: {
                    orderId,
                    lines: order!.lines.map(l => ({ orderLineId: l.id, quantity: 0 })),
                },
            });
            canceledOrderGuard.assertErrorResult(cancelOrder);

            expect(cancelOrder.message).toBe('At least one OrderLine must be specified');
            expect(cancelOrder.errorCode).toBe(ErrorCode.EMPTY_ORDER_LINE_SELECTION_ERROR);
        });

        it('partial cancellation', async () => {
            const result1 = await adminClient.query(getStockMovementDocument, {
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

            const { order } = await adminClient.query(getOrderDocument, {
                id: orderId,
            });

            const { cancelOrder } = await adminClient.query(cancelOrderDocument, {
                input: {
                    orderId,
                    lines: order!.lines.map(l => ({ orderLineId: l.id, quantity: 1 })),
                    reason: 'cancel reason 1',
                },
            });
            canceledOrderGuard.assertSuccess(cancelOrder);

            expect(cancelOrder.lines[0].quantity).toBe(1);

            const { order: order2 } = await adminClient.query(getOrderDocument, {
                id: orderId,
            });

            expect(order2!.state).toBe('PaymentAuthorized');
            expect(order2!.lines[0].quantity).toBe(1);

            const result2 = await adminClient.query(getStockMovementDocument, {
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
            const { order } = await adminClient.query(getOrderDocument, {
                id: orderId,
            });
            const { cancelOrder } = await adminClient.query(cancelOrderDocument, {
                input: {
                    orderId,
                    lines: order!.lines.map(l => ({ orderLineId: l.id, quantity: 2 })),
                },
            });
            canceledOrderGuard.assertErrorResult(cancelOrder);

            expect(cancelOrder.message).toBe(
                'The specified quantity is greater than the available OrderItems',
            );
            expect(cancelOrder.errorCode).toBe(ErrorCode.QUANTITY_TOO_GREAT_ERROR);
        });

        it('complete cancellation', async () => {
            const { order } = await adminClient.query(getOrderDocument, {
                id: orderId,
            });
            await adminClient.query(cancelOrderDocument, {
                input: {
                    orderId,
                    lines: order!.lines.map(l => ({ orderLineId: l.id, quantity: 1 })),
                    reason: 'cancel reason 2',
                    cancelShipping: true,
                },
            });

            const { order: order2 } = await adminClient.query(getOrderDocument, {
                id: orderId,
            });
            expect(order2!.state).toBe('Cancelled');
            expect(order2!.shippingWithTax).toBe(0);
            expect(order2!.totalWithTax).toBe(0);

            const result = await adminClient.query(getStockMovementDocument, {
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
            const { order } = await adminClient.query(getOrderDocument, {
                id: orderId,
            });

            expect(order?.lines[0].unitPrice).not.toBe(0);
        });

        it('order history contains expected entries', async () => {
            const { order } = await adminClient.query(getOrderHistoryDocument, {
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
            shopOrderGuard.assertSuccess(order);

            expect(order.state).toBe('PaymentAuthorized');
            paymentId = 'payments' in order && order.payments?.[0] ? order.payments[0].id : '';

            const { refundOrder } = await adminClient.query(refundOrderDocument, {
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
            const { order } = await adminClient.query(getOrderDocument, {
                id: orderId,
            });
            const { settlePayment } = await adminClient.query(settlePaymentDocument, {
                id: order!.payments![0].id,
            });
            paymentGuard.assertSuccess(settlePayment);

            expect(settlePayment.state).toBe('Settled');

            const { refundOrder } = await adminClient.query(refundOrderDocument, {
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
                await adminClient.query(getOrderDocument, {
                    id: orderId,
                });
                await adminClient.query(refundOrderDocument, {
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
            const { order } = await adminClient.query(getOrderDocument, {
                id: orderId,
            });
            const { refundOrder } = await adminClient.query(refundOrderDocument, {
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
            const { order } = await adminClient.query(getOrderDocument, {
                id: orderId,
            });
            const { refundOrder } = await adminClient.query(refundOrderDocument, {
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
            const { settleRefund } = await adminClient.query(settleRefundDocument, {
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
            const { order } = await adminClient.query(getOrderHistoryDocument, {
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
            await createTestOrder(adminClient, shopClient, customers[0].emailAddress, password);
            await proceedToArrangingPayment(shopClient, 2);
            const order = await addPaymentToOrder(shopClient, singleStageRefundFailingPaymentMethod);
            shopOrderGuard.assertSuccess(order);

            expect(order.state).toBe('PaymentSettled');

            const shippingWithTax = 'shippingWithTax' in order ? order.shippingWithTax : 0;
            const totalWithTax = 'totalWithTax' in order ? order.totalWithTax : 0;
            const paymentIdForRefund = 'payments' in order && order.payments?.[0] ? order.payments[0].id : '';
            const { refundOrder: refund1 } = await adminClient.query(refundOrderDocument, {
                input: {
                    lines: order.lines.map(l => ({ orderLineId: l.id, quantity: l.quantity })),
                    shipping: shippingWithTax,
                    adjustment: 0,
                    reason: 'foo',
                    paymentId: paymentIdForRefund,
                },
            });
            refundGuard.assertSuccess(refund1);
            expect(refund1.state).toBe('Failed');
            expect(refund1.total).toBe(totalWithTax);

            const shippingWithTax2 = 'shippingWithTax' in order ? order.shippingWithTax : 0;
            const totalWithTax2 = 'totalWithTax' in order ? order.totalWithTax : 0;
            const paymentId2 = 'payments' in order && order.payments?.[0] ? order.payments[0].id : '';
            const { refundOrder: refund2 } = await adminClient.query(refundOrderDocument, {
                input: {
                    lines: order.lines.map(l => ({ orderLineId: l.id, quantity: l.quantity })),
                    shipping: shippingWithTax2,
                    adjustment: 0,
                    reason: 'foo',
                    paymentId: paymentId2,
                },
            });
            refundGuard.assertSuccess(refund2);
            expect(refund2.state).toBe('Settled');
            expect(refund2.total).toBe(totalWithTax2);
        });

        // https://github.com/vendurehq/vendure/issues/2302
        it('passes correct amount to createRefund function after cancellation', async () => {
            await createTestOrder(adminClient, shopClient, customers[0].emailAddress, password);
            await proceedToArrangingPayment(shopClient, 2);
            const order = await addPaymentToOrder(shopClient, singleStageRefundablePaymentMethod);
            shopOrderGuard.assertSuccess(order);

            expect(order.state).toBe('PaymentSettled');

            const { cancelOrder } = await adminClient.query(cancelOrderDocument, {
                input: {
                    orderId: order.id,
                    lines: order.lines.map(l => ({ orderLineId: l.id, quantity: l.quantity })),
                    reason: 'cancel reason 1',
                },
            });
            canceledOrderGuard.assertSuccess(cancelOrder);

            const shippingWithTax3 = 'shippingWithTax' in order ? order.shippingWithTax : 0;
            const totalWithTax3 = 'totalWithTax' in order ? order.totalWithTax : 0;
            const paymentId3 = 'payments' in order && order.payments?.[0] ? order.payments[0].id : '';
            const { refundOrder } = await adminClient.query(refundOrderDocument, {
                input: {
                    lines: order.lines.map(l => ({ orderLineId: l.id, quantity: l.quantity })),
                    shipping: shippingWithTax3,
                    adjustment: 0,
                    reason: 'foo',
                    paymentId: paymentId3,
                },
            });
            refundGuard.assertSuccess(refundOrder);
            expect(refundOrder.state).toBe('Settled');
            expect(refundOrder.total).toBe(totalWithTax3);
            expect(refundOrder.metadata.amount).toBe(totalWithTax3);
        });
    });

    describe('payment cancellation', () => {
        it("cancelling payment calls the method's cancelPayment handler", async () => {
            await createTestOrder(adminClient, shopClient, customers[0].emailAddress, password);
            await proceedToArrangingPayment(shopClient);
            const order = await addPaymentToOrder(shopClient, twoStagePaymentMethod);
            shopOrderGuard.assertSuccess(order);

            expect(order.state).toBe('PaymentAuthorized');
            const paymentId = 'payments' in order && order.payments?.[0] ? order.payments[0].id : '';
            if (!paymentId) throw new Error('Expected payment');

            expect(onCancelPaymentSpy).not.toHaveBeenCalled();

            const { cancelPayment } = await adminClient.query(cancelPaymentDocument, {
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
            shopOrderGuard.assertSuccess(order);

            expect(order.state).toBe('PaymentAuthorized');
            const paymentId = 'payments' in order && order.payments?.[0] ? order.payments[0].id : '';
            if (!paymentId) throw new Error('Expected payment');

            const { cancelPayment } = await adminClient.query(cancelPaymentDocument, {
                paymentId,
            });

            paymentGuard.assertErrorResult(cancelPayment);
            expect(cancelPayment.message).toBe('Cancelling the payment failed');
            const { order: checkorder } = await adminClient.query(getOrderDocument, {
                id: order.id,
            });
            expect(checkorder!.payments![0].state).toBe('Authorized');
            expect(checkorder!.payments![0].metadata).toEqual({ cancellationData: 'foo' });
        });
    });

    describe('refund by amount', () => {
        let orderId: string;
        let paymentId: string;

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
            shopOrderGuard.assertSuccess(order);
            paymentId = 'payments' in order && order.payments?.[0] ? order.payments[0].id : '';
            if (!paymentId) throw new Error('Expected payment');
        });

        it('return RefundAmountError if amount too large', async () => {
            const { refundOrder } = await adminClient.query(refundOrderDocument, {
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
            const { order } = await adminClient.query(getOrderDocument, {
                id: orderId,
            });

            const refundAmount = order!.totalWithTax - 500;

            const { refundOrder } = await adminClient.query(refundOrderDocument, {
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
            const { addNoteToOrder } = await adminClient.query(addNoteToOrderDocument, {
                input: {
                    id: orderId,
                    note: 'A private note',
                    isPublic: false,
                },
            });

            expect(addNoteToOrder.id).toBe(orderId);

            const { order } = await adminClient.query(getOrderHistoryDocument, {
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

            const { activeOrder } = await shopClient.query(getActiveOrderDocument);

            expect(activeOrder!.history.items.map(pick(['type']))).toEqual([
                { type: HistoryEntryType.ORDER_STATE_TRANSITION },
            ]);
        });

        it('public note', async () => {
            const { addNoteToOrder } = await adminClient.query(addNoteToOrderDocument, {
                input: {
                    id: orderId,
                    note: 'A public note',
                    isPublic: true,
                },
            });

            expect(addNoteToOrder.id).toBe(orderId);

            const { order } = await adminClient.query(getOrderHistoryDocument, {
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

            const { activeOrder } = await shopClient.query(getActiveOrderDocument);

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
            const { updateOrderNote } = await adminClient.query(updateOrderNoteDocument, {
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
            const { order: before } = await adminClient.query(getOrderHistoryDocument, { id: orderId });
            expect(before?.history.totalItems).toBe(3);

            const { deleteOrderNote } = await adminClient.query(deleteOrderNoteDocument, {
                id: firstNoteId,
            });

            expect(deleteOrderNote.result).toBe(DeletionResult.DELETED);

            const { order: after } = await adminClient.query(getOrderHistoryDocument, { id: orderId });
            expect(after?.history.totalItems).toBe(2);
        });
    });

    describe('multiple payments', () => {
        const PARTIAL_PAYMENT_AMOUNT = 1000;
        let orderId: string;
        let orderTotalWithTax: number;
        let payment1Id: string;
        let productInOrder: ResultOf<typeof getProductWithVariantsDocument>['product'];

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
            const { addPaymentToOrder: order } = await shopClient.query(addPaymentDocument, {
                input: {
                    method: partialPaymentMethod.code,
                    metadata: {
                        amount: PARTIAL_PAYMENT_AMOUNT,
                    },
                },
            });
            shopOrderGuard.assertSuccess(order);
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
            const { addPaymentToOrder: order } = await shopClient.query(addPaymentDocument, {
                input: {
                    method: singleStageRefundablePaymentMethod.code,
                    metadata: {},
                },
            });
            shopOrderGuard.assertSuccess(order);

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
        });

        it('partial refunding of order with multiple payments', async () => {
            const { order } = await adminClient.query(getOrderDocument, {
                id: orderId,
            });
            const { refundOrder } = await adminClient.query(refundOrderDocument, {
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

            const { order: orderWithPayments } = await adminClient.query(getOrderWithPaymentsDocument, {
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
            const { order } = await adminClient.query(getOrderDocument, {
                id: orderId,
            });
            const { refundOrder } = await adminClient.query(refundOrderDocument, {
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

            const { order: orderWithPayments } = await adminClient.query(getOrderWithPaymentsDocument, {
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
            await createTestOrder(adminClient, shopClient, customers[1].emailAddress, password);
            await proceedToArrangingPayment(shopClient);
            await shopClient.query(addPaymentDocument, {
                input: {
                    method: partialPaymentMethod.code,
                    metadata: {
                        amount: PARTIAL_PAYMENT_AMOUNT,
                        authorizeOnly: true,
                    },
                },
            });
            const { addPaymentToOrder: order } = await shopClient.query(addPaymentDocument, {
                input: {
                    method: singleStageRefundablePaymentMethod.code,
                    metadata: {},
                },
            });
            shopOrderGuard.assertSuccess(order);

            expect(order.state).toBe('PaymentAuthorized');

            const { settlePayment } = await adminClient.query(settlePaymentDocument, {
                id: order.payments!.find(p => p.method === partialPaymentMethod.code)!.id,
            });

            paymentGuard.assertSuccess(settlePayment);

            expect(settlePayment.state).toBe('Settled');

            const { order: order2 } = await adminClient.query(getOrderDocument, {
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
            shopOrderGuard.assertSuccess(order);
            const customerIdCheck = 'customer' in order ? order.customer?.id : undefined;
            expect(customerIdCheck).toBe(customerId);
        });

        it(
            'throws in invalid orderId',
            assertThrowsWithMessage(async () => {
                await adminClient.query(setOrderCustomerDocument, {
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
                await adminClient.query(setOrderCustomerDocument, {
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
            const { setOrderCustomer } = await adminClient.query(setOrderCustomerDocument, {
                input: {
                    orderId,
                    customerId: customers[2].id,
                    note: 'Testing',
                },
            });

            expect(setOrderCustomer?.customer?.id).toBe(newCustomerId);
        });

        it('adds a history entry for the customer update', async () => {
            const { order } = await adminClient.query(getOrderHistoryDocument, {
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
            await shopClient.query(applyCouponCodeDocument, {
                couponCode: 'TEST',
            });
            const { activeOrder } = await shopClient.query(getActiveOrderDocument);
            const { order } = await adminClient.query(getOrderFulfillmentsDocument, {
                id: activeOrder!.id,
            });

            expect(order?.fulfillments).toEqual([]);
        });

        // https://github.com/vendurehq/vendure/issues/603
        it('orders correctly resolves quantities and OrderItems', async () => {
            await shopClient.asAnonymousUser();
            const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_1',
                quantity: 2,
            });
            shopOrderGuard.assertSuccess(addItemToOrder);

            const { orders } = await adminClient.query(getOrderListWithQtyDocument, {
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
            const { createShippingMethod: shippingMethod } = await adminClient.query(
                createShippingMethodDocument,
                {
                    input: {
                        code: 'royal-mail',
                        translations: [
                            { languageCode: LanguageCode.en, name: 'Royal Mail', description: '' },
                        ],
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
                },
            );
            await shopClient.asUserWithCredentials(customers[0].emailAddress, password);
            await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_1',
                quantity: 2,
            });
            await shopClient.query(setShippingAddressDocument, {
                input: {
                    fullName: 'name',
                    streetLine1: '12 the street',
                    city: 'foo',
                    postalCode: '123456',
                    countryCode: 'US',
                },
            });
            const { setOrderShippingMethod: order } = await shopClient.query(setShippingMethodDocument, {
                id: [shippingMethod.id],
            });
            shopOrderGuard.assertSuccess(order);

            await adminClient.query(deleteShippingMethodDocument, {
                id: shippingMethod.id,
            });

            const { order: order2 } = await adminClient.query(getOrderDocument, {
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
            await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_1',
                quantity: 2,
            });
            await proceedToArrangingPayment(shopClient);
            const order = await addPaymentToOrder(shopClient, singleStageRefundablePaymentMethod);
            shopOrderGuard.assertSuccess(order);

            const paymentId4 = 'payments' in order && order.payments?.[0] ? order.payments[0].id : '';
            const { refundOrder: refund1 } = await adminClient.query(refundOrderDocument, {
                input: {
                    lines: order.lines.map(l => ({ orderLineId: l.id, quantity: 1 })),
                    shipping: 0,
                    adjustment: 0,
                    reason: 'foo',
                    paymentId: paymentId4,
                },
            });
            refundGuard.assertSuccess(refund1);

            const { refundOrder: refund2 } = await adminClient.query(refundOrderDocument, {
                input: {
                    lines: order.lines.map(l => ({ orderLineId: l.id, quantity: 1 })),
                    shipping: 0,
                    adjustment: 0,
                    reason: 'foo',
                    paymentId: paymentId4,
                },
            });
            refundGuard.assertSuccess(refund2);
        });

        // https://github.com/vendurehq/vendure/issues/1125
        it('resolves deleted Product of OrderLine ProductVariants', async () => {
            await shopClient.asUserWithCredentials(customers[0].emailAddress, password);
            await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_7',
                quantity: 1,
            });

            await proceedToArrangingPayment(shopClient);
            const order = await addPaymentToOrder(shopClient, singleStageRefundablePaymentMethod);
            shopOrderGuard.assertSuccess(order);

            await adminClient.query(deleteProductDocument, {
                id: 'T_3',
            });

            const { activeCustomer } = await shopClient.query(
                getActiveCustomerWithOrdersProductSlugDocument,
                {
                    options: {
                        sort: {
                            createdAt: SortOrder.ASC,
                        },
                    },
                },
            );
            expect(
                activeCustomer!.orders.items[activeCustomer!.orders.items.length - 1].lines[0].productVariant
                    .product.slug,
            ).toBe('gaming-pc');
        });

        // https://github.com/vendurehq/vendure/issues/1508
        it('resolves price of deleted ProductVariant of OrderLine', async () => {
            const { activeCustomer } = await shopClient.query(
                getActiveCustomerWithOrdersProductPriceDocument,
                {
                    options: {
                        sort: {
                            createdAt: SortOrder.ASC,
                        },
                    },
                },
            );
            expect(
                activeCustomer!.orders.items[activeCustomer!.orders.items.length - 1].lines[0].productVariant
                    .price,
            ).toBe(108720);
        });

        // https://github.com/vendurehq/vendure/issues/2204
        it('creates correct history entries and results in correct state when manually adding payment to order', async () => {
            await shopClient.asUserWithCredentials(customers[0].emailAddress, password);
            const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_1',
                quantity: 2,
            });
            await proceedToArrangingPayment(shopClient);
            shopOrderGuard.assertSuccess(addItemToOrder);

            const { addManualPaymentToOrder } = await adminClient.query(addManualPaymentDocument, {
                input: {
                    orderId: addItemToOrder.id,
                    metadata: {},
                    method: twoStagePaymentMethod.code,
                    transactionId: '12345',
                },
            });

            canceledOrderGuard.assertSuccess(addManualPaymentToOrder as any);
            if ('id' in addManualPaymentToOrder) {
                const { order: orderWithHistory } = await adminClient.query(getOrderHistoryDocument, {
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

                const { order } = await adminClient.query(getOrderDocument, {
                    id: addManualPaymentToOrder.id,
                });

                expect(order!.state).toBe('PaymentSettled');
            }
        });

        // https://github.com/vendurehq/vendure/issues/2191
        it('correctly transitions order & fulfillment on partial fulfillment being shipped', async () => {
            await shopClient.asUserWithCredentials(customers[0].emailAddress, password);
            const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_6',
                quantity: 3,
            });
            await proceedToArrangingPayment(shopClient);
            shopOrderGuard.assertSuccess(addItemToOrder);

            const order = await addPaymentToOrder(shopClient, singleStageRefundablePaymentMethod);
            shopOrderGuard.assertSuccess(order);

            const { addFulfillmentToOrder } = await adminClient.query(createFulfillmentDocument, {
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

            const { transitionFulfillmentToState } = await adminClient.query(transitFulfillmentDocument, {
                id: addFulfillmentToOrder.id,
                state: 'Shipped',
            });
            fulfillmentGuard.assertSuccess(transitionFulfillmentToState);

            expect(transitionFulfillmentToState.id).toBe(addFulfillmentToOrder.id);
            expect(transitionFulfillmentToState.state).toBe('Shipped');

            const { order: order2 } = await adminClient.query(getOrderDocument, {
                id: order.id,
            });
            expect(order2?.state).toBe('PartiallyShipped');
        });

        // https://github.com/vendurehq/vendure/issues/4566
        // Before the fix, `findOne` translated each `line.productVariant` even when the
        // caller's relations list did not include `lines.productVariant.translations`,
        // causing `error.entity-has-no-translation-in-language` on subsequent
        // `addItemToOrder` calls that internally reload the active order via
        // `getOrderOrThrow`.
        it('loads ProductVariant translations when findOne is called with explicit relations', async () => {
            await shopClient.asAnonymousUser();
            const { addItemToOrder: firstAdd } = await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_1',
                quantity: 1,
            });
            shopOrderGuard.assertSuccess(firstAdd);
            const internalOrderId = +firstAdd.id.replace('T_', '');

            const ctx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
            const order = await server.app
                .get(OrderService)
                .findOne(ctx, internalOrderId, [
                    'lines',
                    'lines.productVariant',
                    'lines.productVariant.productVariantPrices',
                    'shippingLines',
                    'surcharges',
                    'customer',
                ]);

            expect(order).toBeDefined();
            expect(order!.lines.length).toBe(1);
            const variant = order!.lines[0].productVariant;
            expect(variant.translations.length).toBe(1);
            expect(variant.translations[0].languageCode).toBe(LanguageCode.en);
            expect(variant.name).toBe('Laptop 13 inch 8GB');

            // Re-add the same item: this exercises the original user-visible failure
            // path (`addItemToOrder` -> `getOrderOrThrow` -> `findOne` -> translate).
            // Pre-fix this would throw `error.entity-has-no-translation-in-language`.
            const { addItemToOrder: secondAdd } = await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_1',
                quantity: 1,
            });
            shopOrderGuard.assertSuccess(secondAdd);
            expect(secondAdd.lines[0].quantity).toBe(2);
        });
    });

    describe('set order currency code', () => {
        it('throws if currency is not available on channel', async () => {
            await shopClient.asAnonymousUser();
            await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_1',
                quantity: 1,
            });

            try {
                await shopClient.query(setCurrencyCodeForOrderDocument, {
                    currencyCode: 'GBP' as CurrencyCode,
                });
                expect.fail('Should have thrown');
            } catch (e: any) {
                expect(e.message).toContain('error.currency-not-available');
            }
        });

        it('returns order unchanged if setting same currency', async () => {
            const { setCurrencyCodeForOrder } = await shopClient.query(setCurrencyCodeForOrderDocument, {
                currencyCode: 'USD' as CurrencyCode,
            });
            expect(setCurrencyCodeForOrder.currencyCode).toBe('USD');
        });

        it('successfully changes currency code', async () => {
            // First, add GBP as available currency on the default channel
            await adminClient.query(updateChannelDocument, {
                input: {
                    id: 'T_1',
                    availableCurrencyCodes: [CurrencyCode.USD, CurrencyCode.GBP],
                },
            });

            const { setCurrencyCodeForOrder } = await shopClient.query(setCurrencyCodeForOrderDocument, {
                currencyCode: 'GBP' as CurrencyCode,
            });
            expect(setCurrencyCodeForOrder.currencyCode).toBe('GBP');
        });

        it('creates a history entry when currency is changed', async () => {
            const { activeOrder } = await shopClient.query(getActiveOrderDocument);
            expect(activeOrder).not.toBeNull();
            const currencyUpdatedEntry = activeOrder!.history.items.find(
                i => i.type === HistoryEntryType.ORDER_CURRENCY_UPDATED,
            );
            expect(currencyUpdatedEntry).toBeDefined();
            expect(currencyUpdatedEntry!.data.previousCurrency).toBe('USD');
            expect(currencyUpdatedEntry!.data.newCurrency).toBe('GBP');
        });

        it('returns error if order is not in AddingItems state', async () => {
            await shopClient.query(setCustomerDocument, {
                input: {
                    firstName: 'Test',
                    lastName: 'Person',
                    emailAddress: 'currency-test@test.com',
                },
            });
            await shopClient.query(setShippingAddressDocument, {
                input: {
                    fullName: 'name',
                    streetLine1: '12 the street',
                    city: 'Leedsburgh',
                    postalCode: '123456',
                    countryCode: 'AT',
                },
            });
            await shopClient.query(setShippingMethodDocument, {
                id: ['T_1'],
            });
            const { transitionOrderToState } = await shopClient.query(transitionToStateDocument, {
                state: 'ArrangingPayment',
            });
            expect(transitionOrderToState?.state).toBe('ArrangingPayment');

            const { setCurrencyCodeForOrder } = await shopClient.query(setCurrencyCodeForOrderDocument, {
                currencyCode: 'USD' as CurrencyCode,
            });
            expect(setCurrencyCodeForOrder.errorCode).toBe('ORDER_MODIFICATION_ERROR');
        });
    });

    describe('multiple items to order', () => {
        it('adds multiple items to a new active order', async () => {
            await shopClient.asAnonymousUser();
            const { addItemsToOrder } = await shopClient.query(addMultipleItemsToOrderDocument, {
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
            const { addItemsToOrder } = await shopClient.query(addMultipleItemsToOrderDocument, {
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
});

async function createTestOrder(
    adminClient: SimpleGraphQLClient,
    shopClient: SimpleGraphQLClient,
    emailAddress: string,
    password: string,
): Promise<{
    orderId: string;
    product: ResultOf<typeof getProductWithVariantsDocument>['product'];
    productVariantId: string;
}> {
    const result = await adminClient.query(getProductWithVariantsDocument, {
        id: 'T_3',
    });
    const product = result.product!;
    const productVariantId = product.variants[0].id;

    // Set the ProductVariant to trackInventory
    await adminClient.query(updateProductVariantsDocument, {
        input: [
            {
                id: productVariantId,
                trackInventory: GlobalFlag.TRUE,
            },
        ],
    });

    // Add the ProductVariant to the Order
    await shopClient.asUserWithCredentials(emailAddress, password);
    const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
        productVariantId,
        quantity: 2,
    });
    if ('errorCode' in addItemToOrder) {
        throw new Error(`Failed to add item to order: ${addItemToOrder.message}`);
    }
    const orderId = addItemToOrder.id;
    return { product, productVariantId, orderId };
}

async function getUnfulfilledOrderLineInput(
    client: SimpleGraphQLClient,
    id: string,
): Promise<Array<{ quantity: number; orderLineId: string }>> {
    const { order } = await client.query(getOrderDocument, {
        id,
    });
    const allFulfillmentLines =
        order?.fulfillments
            ?.filter(f => f.state !== 'Cancelled')
            .reduce(
                (all, f) => [...all, ...f.lines],
                [] as Array<{ orderLineId: string; quantity: number }>,
            ) || [];

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
        orderLineId: String(l.orderLineId),
        quantity: l.unfulfilled,
    }));
}
