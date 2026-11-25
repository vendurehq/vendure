/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { LanguageCode } from '@vendure/common/lib/generated-types';
import { summate } from '@vendure/common/lib/shared-utils';
import {
    defaultShippingCalculator,
    defaultShippingEligibilityChecker,
    manualFulfillmentHandler,
    mergeConfig,
    Order,
    OrderLine,
    OrderService,
    RequestContext,
    RequestContextService,
    ShippingLine,
    ShippingLineAssignmentStrategy,
} from '@vendure/core';
import { createErrorResultGuard, createTestEnvironment, ErrorResultGuard } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { testSuccessfulPaymentMethod } from './fixtures/test-payment-methods';
import { orderWithModificationsFragment } from './graphql/fragments-admin';
import { FragmentOf as AdminFragmentOf } from './graphql/graphql-admin';
import { FragmentOf } from './graphql/graphql-shop';
import {
    adminTransitionToStateDocument,
    createShippingMethodDocument,
    getCustomerListDocument,
    modifyOrderDocument,
} from './graphql/shared-definitions';
import {
    activeOrderCustomerDocument,
    addItemToOrderDocument,
    getActiveOrderDocument,
    getEligibleShippingMethodsDocument,
    removeItemFromOrderDocument,
    setShippingAddressDocument,
    setShippingMethodDocument,
    testOrderFragment,
    testOrderWithPaymentsFragment,
    transitionToStateDocument,
    updatedOrderFragment,
} from './graphql/shop-definitions';
import { addPaymentToOrder } from './utils/test-order-utils';

declare module '@vendure/core/dist/entity/custom-entity-fields' {
    interface CustomShippingMethodFields {
        minPrice: number;
        maxPrice: number;
    }
}

class CustomShippingLineAssignmentStrategy implements ShippingLineAssignmentStrategy {
    assignShippingLineToOrderLines(
        ctx: RequestContext,
        shippingLine: ShippingLine,
        order: Order,
    ): OrderLine[] | Promise<OrderLine[]> {
        const { minPrice, maxPrice } = shippingLine.shippingMethod.customFields;
        return order.lines.filter(l => l.linePriceWithTax >= minPrice && l.linePriceWithTax <= maxPrice);
    }
}

describe('Multiple shipping orders', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            customFields: {
                ShippingMethod: [
                    { name: 'minPrice', type: 'int' },
                    { name: 'maxPrice', type: 'int' },
                ],
            },
            shippingOptions: {
                shippingLineAssignmentStrategy: new CustomShippingLineAssignmentStrategy(),
            },
            paymentOptions: {
                paymentMethodHandlers: [testSuccessfulPaymentMethod],
            },
        }),
    );
    const modificationGuard: ErrorResultGuard<AdminFragmentOf<typeof orderWithModificationsFragment>> =
        createErrorResultGuard(input => !!input.modifications);

    type OrderSuccessResult =
        | FragmentOf<typeof updatedOrderFragment>
        | FragmentOf<typeof testOrderFragment>
        | FragmentOf<typeof testOrderWithPaymentsFragment>
        | FragmentOf<typeof activeOrderCustomerDocument>;
    const orderResultGuard: ErrorResultGuard<OrderSuccessResult> = createErrorResultGuard(
        input => !!input.lines,
    );

    let lessThan100MethodId: string;
    let greaterThan100MethodId: string;
    let orderService: OrderService;

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
            customerCount: 3,
        });
        await adminClient.asSuperAdmin();
        orderService = server.app.get(OrderService);
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('setup shipping methods', async () => {
        const result1 = await adminClient.query(createShippingMethodDocument, {
            input: {
                code: 'less-than-100',
                translations: [{ languageCode: LanguageCode.en, name: 'Less than 100', description: '' }],
                fulfillmentHandler: manualFulfillmentHandler.code,
                checker: {
                    code: defaultShippingEligibilityChecker.code,
                    arguments: [{ name: 'orderMinimum', value: '0' }],
                },
                calculator: {
                    code: defaultShippingCalculator.code,
                    arguments: [
                        { name: 'rate', value: '1000' },
                        { name: 'taxRate', value: '0' },
                        { name: 'includesTax', value: 'auto' },
                    ],
                },
                customFields: {
                    minPrice: 0,
                    maxPrice: 100_00,
                },
            },
        });

        const result2 = await adminClient.query(createShippingMethodDocument, {
            input: {
                code: 'greater-than-100',
                translations: [{ languageCode: LanguageCode.en, name: 'Greater than 200', description: '' }],
                fulfillmentHandler: manualFulfillmentHandler.code,
                checker: {
                    code: defaultShippingEligibilityChecker.code,
                    arguments: [{ name: 'orderMinimum', value: '0' }],
                },
                calculator: {
                    code: defaultShippingCalculator.code,
                    arguments: [
                        { name: 'rate', value: '2000' },
                        { name: 'taxRate', value: '0' },
                        { name: 'includesTax', value: 'auto' },
                    ],
                },
                customFields: {
                    minPrice: 100_00,
                    maxPrice: 500000_00,
                },
            },
        });

        expect(result1.createShippingMethod.id).toBe('T_4');
        expect(result2.createShippingMethod.id).toBe('T_5');
        lessThan100MethodId = result1.createShippingMethod.id;
        greaterThan100MethodId = result2.createShippingMethod.id;
    });

    it('assigns shipping methods to correct order lines', async () => {
        await shopClient.query(addItemToOrderDocument, {
            productVariantId: 'T_1',
            quantity: 1,
        });
        await shopClient.query(addItemToOrderDocument, {
            productVariantId: 'T_11',
            quantity: 1,
        });

        await shopClient.query(setShippingAddressDocument, {
            input: {
                streetLine1: '12 the street',
                postalCode: '123456',
                countryCode: 'US',
            },
        });

        const { eligibleShippingMethods } = await shopClient.query(getEligibleShippingMethodsDocument);

        expect(eligibleShippingMethods.map(m => m.id).includes(lessThan100MethodId)).toBe(true);
        expect(eligibleShippingMethods.map(m => m.id).includes(greaterThan100MethodId)).toBe(true);

        const { setOrderShippingMethod } = await shopClient.query(setShippingMethodDocument, {
            id: [lessThan100MethodId, greaterThan100MethodId],
        });

        orderResultGuard.assertSuccess(setOrderShippingMethod);

        const order = await getInternalOrder(setOrderShippingMethod.id);
        expect(order?.lines[0].shippingLine?.shippingMethod.code).toBe('greater-than-100');
        expect(order?.lines[1].shippingLine?.shippingMethod.code).toBe('less-than-100');

        expect(order?.shippingLines.length).toBe(2);
    });

    // Setting fewer shipping methods than the Order has ShippingLines keeps the ShippingLines of the
    // methods that were set
    it('keeps the remaining shipping line when fewer shipping methods are set', async () => {
        const { setOrderShippingMethod } = await shopClient.query(setShippingMethodDocument, {
            id: [lessThan100MethodId],
        });
        orderResultGuard.assertSuccess(setOrderShippingMethod);

        const order = await getInternalOrder(setOrderShippingMethod.id);
        expect(order?.shippingLines.map(line => line.shippingMethod.code)).toEqual(['less-than-100']);
        expect(order?.lines[1].shippingLine?.shippingMethod.code).toBe('less-than-100');
        // The OrderLine of the removed ShippingMethod is left without a ShippingLine
        expect(order?.lines[0].shippingLine ?? null).toBeNull();
        expect(order?.lines[0].shippingLineId ?? null).toBeNull();
        const { activeOrder } = await shopClient.query(getActiveOrderDocument);
        expect(activeOrder?.shippingWithTax).toBe(1000);

        // Restore both shipping methods for the following tests
        const { setOrderShippingMethod: restored } = await shopClient.query(setShippingMethodDocument, {
            id: [lessThan100MethodId, greaterThan100MethodId],
        });
        orderResultGuard.assertSuccess(restored);
        const restoredOrder = await getInternalOrder(restored.id);
        expect(restoredOrder.shippingLines.length).toBe(2);
        expect(restoredOrder.lines[0].shippingLine?.shippingMethod.code).toBe('greater-than-100');
        expect(restoredOrder.lines[1].shippingLine?.shippingMethod.code).toBe('less-than-100');
    });

    it('removes shipping methods that are no longer applicable', async () => {
        const { activeOrder } = await shopClient.query(getActiveOrderDocument);

        const { removeOrderLine } = await shopClient.query(removeItemFromOrderDocument, {
            orderLineId: activeOrder!.lines[0].id,
        });
        orderResultGuard.assertSuccess(removeOrderLine);

        const order = await getInternalOrder(activeOrder!.id);
        expect(order?.lines.length).toBe(1);
        expect(order?.shippingLines.length).toBe(1);
        expect(order?.shippingLines[0].shippingMethod.code).toBe('less-than-100');

        const { activeOrder: activeOrder2 } = await shopClient.query(getActiveOrderDocument);

        expect(activeOrder2?.shippingWithTax).toBe(summate(activeOrder2!.shippingLines, 'priceWithTax'));
    });

    it('removes remaining shipping method when removing all items', async () => {
        const { activeOrder } = await shopClient.query(getActiveOrderDocument);

        const { removeOrderLine } = await shopClient.query(removeItemFromOrderDocument, {
            orderLineId: activeOrder!.lines[0].id,
        });
        orderResultGuard.assertSuccess(removeOrderLine);

        const order = await getInternalOrder(activeOrder!.id);
        expect(order?.lines.length).toBe(0);

        const { activeOrder: activeOrder2 } = await shopClient.query(getActiveOrderDocument);

        expect(activeOrder2?.shippingWithTax).toBe(0);
    });

    // Setting fewer shipping methods than the Order has ShippingLines keeps one ShippingLine per
    // method. An OrderLine which the strategy no longer assigns must not keep its old ShippingLine.
    it('keeps one shipping line per method when fewer shipping methods are set', async () => {
        await shopClient.query(addItemToOrderDocument, { productVariantId: 'T_1', quantity: 1 });
        await shopClient.query(addItemToOrderDocument, { productVariantId: 'T_11', quantity: 1 });
        const { setOrderShippingMethod: both } = await shopClient.query(setShippingMethodDocument, {
            id: [lessThan100MethodId, greaterThan100MethodId],
        });
        orderResultGuard.assertSuccess(both);
        expect(both.shippingWithTax).toBe(3000);

        const { setOrderShippingMethod: one } = await shopClient.query(setShippingMethodDocument, {
            id: [greaterThan100MethodId],
        });
        orderResultGuard.assertSuccess(one);

        expect(one.shippingLines.map(l => l.shippingMethod.code)).toEqual(['greater-than-100']);
        expect(one.shippingWithTax).toBe(2000);
        const order = await getInternalOrder(one.id);
        expect(order.shippingLines.length).toBe(1);
        const assigned = order.lines
            .filter(l => l.shippingLine)
            .map(l => l.shippingLine!.shippingMethod.code);
        expect(assigned).toEqual(['greater-than-100']);
    });

    // modifyOrder works on the in-memory Order, so an OrderLine left without a ShippingLine
    // must not be saved with a reference to the removed ShippingLine
    it('modifyOrder refunds only the shipping of the removed method', async () => {
        const { customers } = await adminClient.query(getCustomerListDocument, { options: { take: 1 } });
        await shopClient.asUserWithCredentials(customers.items[0].emailAddress, 'test');
        await shopClient.query(addItemToOrderDocument, { productVariantId: 'T_1', quantity: 1 });
        await shopClient.query(addItemToOrderDocument, { productVariantId: 'T_11', quantity: 1 });
        await shopClient.query(setShippingAddressDocument, {
            input: {
                fullName: 'name',
                streetLine1: '12 the street',
                postalCode: '123456',
                countryCode: 'US',
            },
        });
        const { setOrderShippingMethod } = await shopClient.query(setShippingMethodDocument, {
            id: [lessThan100MethodId, greaterThan100MethodId],
        });
        orderResultGuard.assertSuccess(setOrderShippingMethod);
        await shopClient.query(transitionToStateDocument, { state: 'ArrangingPayment' });
        const placed = await addPaymentToOrder(shopClient, testSuccessfulPaymentMethod);
        orderResultGuard.assertSuccess(placed);
        expect(placed.state).toBe('PaymentSettled');
        expect(placed.shippingWithTax).toBe(3000);
        const orderId = placed.id;

        await adminClient.query(adminTransitionToStateDocument, { id: orderId, state: 'Modifying' });

        const { modifyOrder: dryRun } = await adminClient.query(modifyOrderDocument, {
            input: { dryRun: true, orderId, shippingMethodIds: [lessThan100MethodId] },
        });
        modificationGuard.assertSuccess(dryRun);
        expect(dryRun.shippingWithTax).toBe(1000);
        expect(dryRun.totalWithTax).toBe(placed.totalWithTax - 2000);

        const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
            input: {
                dryRun: false,
                orderId,
                shippingMethodIds: [lessThan100MethodId],
                refunds: [{ paymentId: placed.payments![0].id, reason: 'removed shipping method' }],
            },
        });
        modificationGuard.assertSuccess(modifyOrder);
        expect(modifyOrder.shippingWithTax).toBe(1000);
        expect(modifyOrder.modifications[0].priceChange).toBe(-2000);
        expect(modifyOrder.modifications[0].refund?.total).toBe(2000);
        const order = await getInternalOrder(orderId);
        expect(order.shippingLines.map(l => l.shippingMethod.code)).toEqual(['less-than-100']);
    });

    it('removes every shipping line when no shipping methods are set', async () => {
        await shopClient.asAnonymousUser();
        await shopClient.query(addItemToOrderDocument, { productVariantId: 'T_1', quantity: 1 });
        await shopClient.query(addItemToOrderDocument, { productVariantId: 'T_11', quantity: 1 });
        await shopClient.query(setShippingAddressDocument, {
            input: { streetLine1: '12 the street', postalCode: '123456', countryCode: 'US' },
        });
        const { setOrderShippingMethod: both } = await shopClient.query(setShippingMethodDocument, {
            id: [lessThan100MethodId, greaterThan100MethodId],
        });
        orderResultGuard.assertSuccess(both);

        const { setOrderShippingMethod: none } = await shopClient.query(setShippingMethodDocument, {
            id: [],
        });
        orderResultGuard.assertSuccess(none);

        expect(none.shippingLines).toEqual([]);
        expect(none.shippingWithTax).toBe(0);
        expect(none.totalWithTax).toBe(both.totalWithTax - 3000);
        const order = await getInternalOrder(none.id);
        expect(order.lines.map(l => l.shippingLineId ?? null)).toEqual([null, null]);
    });

    async function getInternalOrder(externalOrderId: string): Promise<Order> {
        const ctx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
        const internalOrderId = +externalOrderId.replace('T_', '');
        const order = await orderService.findOne(ctx, internalOrderId, [
            'lines',
            'lines.shippingLine',
            'lines.shippingLine.shippingMethod',
            'shippingLines',
            'shippingLines.shippingMethod',
        ]);
        return order!;
    }
});
