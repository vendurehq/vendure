import { ErrorCode, LanguageCode } from '@vendure/common/lib/generated-types';
import {
    idsAreEqual,
    manualFulfillmentHandler,
    Order,
    OrderLine,
    RequestContext,
    ShippingCalculationResult,
    ShippingCalculator,
    ShippingEligibilityChecker,
    ShippingLine,
    ShippingLineAssignmentStrategy,
} from '@vendure/core';
import { createErrorResultGuard, createTestEnvironment, ErrorResultGuard } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { testSuccessfulPaymentMethod } from './fixtures/test-payment-methods';
import { graphql as adminGraphql } from './graphql/graphql-admin';
import { graphql, ResultOf, VariablesOf } from './graphql/graphql-shop';
import {
    createPromotionDocument,
    createShippingMethodDocument,
    deletePromotionDocument,
} from './graphql/shared-definitions';
import {
    addItemToOrderDocument,
    adjustItemQuantityDocument,
    setCustomerDocument,
    setShippingAddressDocument,
    transitionToStateDocument,
} from './graphql/shop-definitions';
import { assertThrowsWithMessage } from './utils/assert-throws-with-message';
import { addPaymentToOrder } from './utils/test-order-utils';

// OSS-1003 / #2649 — a ShippingCalculator may return several options, e.g. the services of a carrier API

const allCarrierServices = [
    { code: 'standard', name: 'Standard', basePrice: 900 },
    { code: 'express', name: 'Express', basePrice: 1500 },
    { code: 'economy', name: 'Economy', basePrice: 500 },
];
let offeredServiceCodes = allCarrierServices.map(s => s.code);
let returnDuplicateCodes = false;
/** Added to every carrier price, to make the carrier dearer than the flat rate */
let carrierSurcharge = 0;
/** How many times the carrier calculator has run */
let carrierCalls = 0;
/** When set, the flat rate calculator returns its single result with this code */
let flatRateCode: string | undefined;
/** Whether the ShippingMethod priced by its assigned OrderLines is eligible */
let assignedLinesMethodEligible = false;
/** When set, the ShippingMethod priced by its assigned OrderLines is only eligible up to this subTotal */
let assignedLinesMaxSubTotal: number | undefined;

/**
 * Stands in for a carrier API: one result per service, priced by the quantity in the Order,
 * deliberately not in price order.
 */
const carrierCalculator = new ShippingCalculator({
    code: 'carrier-calculator',
    description: [{ languageCode: LanguageCode.en, value: 'Carrier rates' }],
    args: {},
    calculate: (_ctx, order): ShippingCalculationResult[] => {
        carrierCalls++;
        const quantity = order.lines.reduce((sum, line) => sum + line.quantity, 0);
        return allCarrierServices
            .filter(service => offeredServiceCodes.includes(service.code))
            .map(service => ({
                code: returnDuplicateCodes ? 'same' : service.code,
                name: service.name,
                price: service.basePrice + quantity * 100 + carrierSurcharge,
                priceIncludesTax: false,
                taxRate: 0,
                metadata: { carrier: 'acme' },
            }));
    },
});

const flatRateCalculator = new ShippingCalculator({
    code: 'flat-calculator',
    description: [{ languageCode: LanguageCode.en, value: 'Flat rate' }],
    args: {},
    calculate: () => ({
        price: 2000,
        priceIncludesTax: false,
        taxRate: 0,
        ...(flatRateCode ? { code: flatRateCode, name: 'Parcel' } : {}),
    }),
});

/**
 * Prices only the OrderLines assigned to its ShippingLine, as a multi-vendor calculator does, plus
 * 1% of the Order's subTotal. It can only give the right price once the OrderLines are assigned and
 * the Order's totals are calculated.
 */
const assignedLinesCalculator = new ShippingCalculator({
    code: 'assigned-lines-calculator',
    description: [{ languageCode: LanguageCode.en, value: 'Priced by assigned lines' }],
    args: {},
    calculate: (_ctx, order, _args, method) => {
        const shippingLine = order.shippingLines.find(line => idsAreEqual(line.shippingMethodId, method.id));
        const assignedLines = order.lines.filter(
            line => shippingLine && idsAreEqual(line.shippingLineId, shippingLine.id),
        );
        return {
            price: assignedLines.length * 1000 + Math.round(order.subTotal / 100),
            priceIncludesTax: false,
            taxRate: 0,
        };
    },
});

const assignedLinesChecker = new ShippingEligibilityChecker({
    code: 'assigned-lines-checker',
    description: [{ languageCode: LanguageCode.en, value: 'Only when enabled by a test' }],
    args: {},
    check: (_ctx, order) =>
        assignedLinesMethodEligible &&
        (assignedLinesMaxSubTotal === undefined || order.subTotal <= assignedLinesMaxSubTotal),
});

const alwaysEligible = new ShippingEligibilityChecker({
    code: 'always-eligible',
    description: [{ languageCode: LanguageCode.en, value: 'Always eligible' }],
    args: {},
    check: () => true,
});

const eligibleShippingMethodsWithOptionsDocument = graphql(`
    query EligibleShippingMethodsWithOptions {
        eligibleShippingMethods {
            id
            code
            price
            priceWithTax
            metadata
            options {
                code
                name
                price
                priceWithTax
                metadata
            }
        }
    }
`);

const shippingLineFragment = graphql(`
    fragment ShippingOptionOrder on Order {
        id
        subTotal
        shippingWithTax
        shippingLines {
            shippingMethod {
                id
            }
            priceWithTax
            shippingOptionCode
            shippingOptionName
        }
    }
`);

const setShippingMethodsDocument = graphql(
    `
        mutation SetShippingMethods(
            $shippingMethodId: [ID!]
            $shippingMethods: [ShippingMethodSelectionInput!]
        ) {
            setOrderShippingMethod(shippingMethodId: $shippingMethodId, shippingMethods: $shippingMethods) {
                ...ShippingOptionOrder
                ... on ErrorResult {
                    errorCode
                    message
                }
            }
        }
    `,
    [shippingLineFragment],
);

const activeOrderShippingDocument = graphql(
    `
        query ActiveOrderShipping {
            activeOrder {
                ...ShippingOptionOrder
            }
        }
    `,
    [shippingLineFragment],
);

const adminShippingLinesFragment = adminGraphql(`
    fragment AdminShippingOptionOrder on Order {
        id
        state
        subTotal
        lines {
            id
            quantity
        }
        shippingLines {
            shippingMethod {
                id
            }
            priceWithTax
            shippingOptionCode
            shippingOptionName
        }
    }
`);

const adminOrderShippingDocument = adminGraphql(
    `
        query AdminOrderShipping($id: ID!) {
            order(id: $id) {
                ...AdminShippingOptionOrder
            }
        }
    `,
    [adminShippingLinesFragment],
);

const orderPaymentsDocument = adminGraphql(`
    query OrderPaymentsForOptions($id: ID!) {
        order(id: $id) {
            payments {
                id
            }
        }
    }
`);

const createDraftOrderDocument = adminGraphql(`
    mutation CreateDraftOrderForOptions {
        createDraftOrder {
            id
        }
    }
`);

const addItemToDraftOrderDocument = adminGraphql(`
    mutation AddItemToDraftOrderForOptions($orderId: ID!, $input: AddItemToDraftOrderInput!) {
        addItemToDraftOrder(orderId: $orderId, input: $input) {
            ... on Order {
                id
            }
        }
    }
`);

const draftOrderShippingOptionsDocument = adminGraphql(`
    query DraftOrderShippingOptions($orderId: ID!) {
        eligibleShippingMethodsForDraftOrder(orderId: $orderId) {
            id
            options {
                code
                priceWithTax
            }
        }
    }
`);

const setDraftOrderShippingOptionDocument = adminGraphql(
    `
        mutation SetDraftOrderShippingOption($orderId: ID!, $shippingMethodId: ID!, $shippingOptionCode: String) {
            setDraftOrderShippingMethod(
                orderId: $orderId
                shippingMethodId: $shippingMethodId
                shippingOptionCode: $shippingOptionCode
            ) {
                ...AdminShippingOptionOrder
                ... on ErrorResult {
                    errorCode
                    message
                }
            }
        }
    `,
    [adminShippingLinesFragment],
);

const adminTransitionDocument = adminGraphql(`
    mutation TransitionForOptions($id: ID!, $state: String!) {
        transitionOrderToState(id: $id, state: $state) {
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

const modifyOrderShippingDocument = adminGraphql(
    `
        mutation ModifyOrderShipping($input: ModifyOrderInput!) {
            modifyOrder(input: $input) {
                ...AdminShippingOptionOrder
                ... on ErrorResult {
                    errorCode
                    message
                }
            }
        }
    `,
    [adminShippingLinesFragment],
);

const modifyOrderShippingDiscountsDocument = adminGraphql(`
    mutation ModifyOrderShippingDiscounts($input: ModifyOrderInput!) {
        modifyOrder(input: $input) {
            ... on Order {
                shippingWithTax
                shippingLines {
                    priceWithTax
                    discountedPriceWithTax
                    shippingOptionCode
                }
            }
            ... on ErrorResult {
                errorCode
            }
        }
    }
`);

const testShippingMethodDocument = adminGraphql(`
    query TestShippingMethodOptions($input: TestShippingMethodInput!) {
        testShippingMethod(input: $input) {
            eligible
            quote {
                price
            }
            options {
                code
                name
                price
            }
        }
    }
`);

class ClonedLinesAssignmentStrategy implements ShippingLineAssignmentStrategy {
    assignShippingLineToOrderLines(_ctx: RequestContext, _shippingLine: ShippingLine, order: Order) {
        return order.lines.map(line => new OrderLine({ id: line.id }));
    }
}

describe('ShippingMethod with several options', () => {
    const { server, adminClient, shopClient } = createTestEnvironment({
        ...testConfig(),
        shippingOptions: {
            shippingEligibilityCheckers: [alwaysEligible, assignedLinesChecker],
            shippingCalculators: [carrierCalculator, flatRateCalculator, assignedLinesCalculator],
            // Returns other instances than those of order.lines, which a strategy is free to do: the
            // detection of refused options must not depend on them being the same objects
            shippingLineAssignmentStrategy: new ClonedLinesAssignmentStrategy(),
        },
        paymentOptions: {
            paymentMethodHandlers: [testSuccessfulPaymentMethod],
        },
    });

    type OrderResult = Exclude<
        ResultOf<typeof setShippingMethodsDocument>['setOrderShippingMethod'],
        { errorCode: string }
    >;
    const orderGuard: ErrorResultGuard<OrderResult> = createErrorResultGuard(input => !!input.shippingLines);

    let carrierMethodId: string;
    let flatMethodId: string;
    let assignedLinesMethodId: string;
    let orderLineId: string;

    const setShippingMethods = async (variables: VariablesOf<typeof setShippingMethodsDocument>) => {
        const { setOrderShippingMethod } = await shopClient.query(setShippingMethodsDocument, variables);
        return setOrderShippingMethod;
    };

    const createMethod = async (code: string, calculatorCode: string, checkerCode = alwaysEligible.code) => {
        const { createShippingMethod } = await adminClient.query(createShippingMethodDocument, {
            input: {
                code,
                fulfillmentHandler: manualFulfillmentHandler.code,
                checker: { code: checkerCode, arguments: [] },
                calculator: { code: calculatorCode, arguments: [] },
                translations: [{ languageCode: LanguageCode.en, name: code, description: '' }],
            },
        });
        return createShippingMethod.id;
    };

    beforeAll(async () => {
        await server.init({
            initialData: {
                ...initialData,
                shippingMethods: [],
                paymentMethods: [
                    {
                        name: testSuccessfulPaymentMethod.code,
                        handler: { code: testSuccessfulPaymentMethod.code, arguments: [] },
                    },
                ],
            },
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
        carrierMethodId = await createMethod('carrier', carrierCalculator.code);
        flatMethodId = await createMethod('flat', flatRateCalculator.code);
        assignedLinesMethodId = await createMethod(
            'assigned-lines',
            assignedLinesCalculator.code,
            assignedLinesChecker.code,
        );

        await shopClient.asAnonymousUser();
        const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
            productVariantId: 'T_1',
            quantity: 1,
        });
        orderLineId = (addItemToOrder as any).lines[0].id;
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('lists the ShippingMethod once, with its options cheapest first', async () => {
        const { eligibleShippingMethods } = await shopClient.query(
            eligibleShippingMethodsWithOptionsDocument,
        );

        expect(eligibleShippingMethods.map(m => m.id)).toEqual([carrierMethodId, flatMethodId]);
        const [carrier, flat] = eligibleShippingMethods;
        expect(carrier.options).toEqual([
            {
                code: 'economy',
                name: 'Economy',
                price: 600,
                priceWithTax: 600,
                metadata: { carrier: 'acme' },
            },
            {
                code: 'standard',
                name: 'Standard',
                price: 1000,
                priceWithTax: 1000,
                metadata: { carrier: 'acme' },
            },
            {
                code: 'express',
                name: 'Express',
                price: 1600,
                priceWithTax: 1600,
                metadata: { carrier: 'acme' },
            },
        ]);
        // The top-level fields are those of the cheapest option, as for a single-price calculator
        expect(carrier.price).toBe(600);
        expect(carrier.metadata).toEqual({ carrier: 'acme' });
        // A calculator returning a single result gives a single option without a code
        expect(flat.options).toEqual([
            { code: null, name: null, price: 2000, priceWithTax: 2000, metadata: null },
        ]);
    });

    it('sets the chosen option', async () => {
        const result = await setShippingMethods({
            shippingMethods: [{ shippingMethodId: carrierMethodId, shippingOptionCode: 'express' }],
        });
        orderGuard.assertSuccess(result);

        expect(result.shippingLines).toEqual([
            {
                shippingMethod: { id: carrierMethodId },
                priceWithTax: 1600,
                shippingOptionCode: 'express',
                shippingOptionName: 'Express',
            },
        ]);
        expect(result.shippingWithTax).toBe(1600);
    });

    it('keeps the chosen option and re-prices it when the Order changes', async () => {
        await shopClient.query(adjustItemQuantityDocument, { orderLineId, quantity: 3 });

        const { activeOrder } = await shopClient.query(activeOrderShippingDocument);
        expect(activeOrder?.shippingLines[0].shippingOptionCode).toBe('express');
        expect(activeOrder?.shippingLines[0].priceWithTax).toBe(1800);
    });

    it('rejects an option which the ShippingMethod does not offer', async () => {
        const result = await setShippingMethods({
            shippingMethods: [{ shippingMethodId: carrierMethodId, shippingOptionCode: 'teleport' }],
        });
        orderGuard.assertErrorResult(result);

        expect(result.errorCode).toBe(ErrorCode.INELIGIBLE_SHIPPING_METHOD_ERROR);
        const { activeOrder } = await shopClient.query(activeOrderShippingDocument);
        expect(activeOrder?.shippingLines[0].shippingOptionCode).toBe('express');
    });

    it(
        'rejects both shippingMethodId and shippingMethods',
        assertThrowsWithMessage(
            () =>
                setShippingMethods({
                    shippingMethodId: [carrierMethodId],
                    shippingMethods: [{ shippingMethodId: carrierMethodId }],
                }),
            "Provide exactly one of the 'shippingMethodId' and 'shippingMethods' arguments",
        ),
    );

    it('uses and records the cheapest option when only the ShippingMethod id is given', async () => {
        const result = await setShippingMethods({ shippingMethodId: [carrierMethodId] });
        orderGuard.assertSuccess(result);

        expect(result.shippingLines[0].shippingOptionCode).toBe('economy');
        expect(result.shippingLines[0].shippingOptionName).toBe('Economy');
        expect(result.shippingLines[0].priceWithTax).toBe(800);
    });

    it('stores no option for a ShippingMethod whose calculator returns a single result', async () => {
        const result = await setShippingMethods({ shippingMethodId: [flatMethodId] });
        orderGuard.assertSuccess(result);

        expect(result.shippingLines[0].shippingOptionCode).toBeNull();
        expect(result.shippingLines[0].priceWithTax).toBe(2000);
    });

    it('runs the calculator once when an option is set', async () => {
        carrierCalls = 0;
        await setShippingMethods({
            shippingMethods: [{ shippingMethodId: carrierMethodId, shippingOptionCode: 'standard' }],
        });
        expect(carrierCalls).toBe(1);

        carrierCalls = 0;
        await setShippingMethods({ shippingMethodId: [carrierMethodId] });
        expect(carrierCalls).toBe(1);
    });

    it('stores the code of a single result which has one', async () => {
        flatRateCode = 'parcel';
        try {
            const result = await setShippingMethods({ shippingMethodId: [flatMethodId] });
            orderGuard.assertSuccess(result);
            expect(result.shippingLines[0]).toMatchObject({
                shippingOptionCode: 'parcel',
                shippingOptionName: 'Parcel',
                priceWithTax: 2000,
            });
        } finally {
            flatRateCode = undefined;
        }
    });

    it('prices a ShippingLine after its OrderLines are assigned to it', async () => {
        assignedLinesMethodEligible = true;
        try {
            const result = await setShippingMethods({ shippingMethodId: [assignedLinesMethodId] });
            orderGuard.assertSuccess(result);
            // 3 x T_1 at 1299.00. One assigned OrderLine (1000), plus 1% of the subTotal (3897).
            expect(result.subTotal).toBe(389700);
            expect(result.shippingLines[0].priceWithTax).toBe(4897);
        } finally {
            assignedLinesMethodEligible = false;
        }
    });

    it('falls back to the cheapest option when the chosen one is withdrawn', async () => {
        await setShippingMethods({
            shippingMethods: [{ shippingMethodId: carrierMethodId, shippingOptionCode: 'express' }],
        });
        offeredServiceCodes = ['standard', 'economy'];
        try {
            await shopClient.query(adjustItemQuantityDocument, { orderLineId, quantity: 2 });

            const { activeOrder } = await shopClient.query(activeOrderShippingDocument);
            expect(activeOrder?.shippingLines[0].shippingMethod.id).toBe(carrierMethodId);
            expect(activeOrder?.shippingLines[0].shippingOptionCode).toBe('economy');
            expect(activeOrder?.shippingLines[0].priceWithTax).toBe(700);
        } finally {
            offeredServiceCodes = allCarrierServices.map(s => s.code);
        }
    });

    it('falls back to another ShippingMethod when it is cheaper than the remaining options', async () => {
        await setShippingMethods({
            shippingMethods: [{ shippingMethodId: carrierMethodId, shippingOptionCode: 'economy' }],
        });
        offeredServiceCodes = ['express'];
        carrierSurcharge = 1000;
        try {
            await shopClient.query(adjustItemQuantityDocument, { orderLineId, quantity: 2 });

            const { activeOrder } = await shopClient.query(activeOrderShippingDocument);
            expect(activeOrder?.shippingLines).toEqual([
                {
                    shippingMethod: { id: flatMethodId },
                    priceWithTax: 2000,
                    shippingOptionCode: null,
                    shippingOptionName: null,
                },
            ]);
        } finally {
            offeredServiceCodes = allCarrierServices.map(s => s.code);
            carrierSurcharge = 0;
        }
    });

    it(
        'rejects a call with neither shippingMethodId nor shippingMethods',
        assertThrowsWithMessage(
            () => setShippingMethods({}),
            "Provide exactly one of the 'shippingMethodId' and 'shippingMethods' arguments",
        ),
    );

    it('refuses an empty list of shipping methods and keeps the ShippingLine', async () => {
        for (const variables of [{ shippingMethods: [] }, { shippingMethodId: [] }]) {
            await expect(setShippingMethods(variables)).rejects.toThrow('with at least one shipping method');
        }
        const { activeOrder } = await shopClient.query(activeOrderShippingDocument);
        expect(activeOrder?.shippingLines).toHaveLength(1);
    });

    it('makes only that ShippingMethod unavailable when its options lack unique codes', async () => {
        returnDuplicateCodes = true;
        try {
            const { eligibleShippingMethods } = await shopClient.query(
                eligibleShippingMethodsWithOptionsDocument,
            );
            expect(eligibleShippingMethods.map(m => m.id)).toEqual([flatMethodId]);
        } finally {
            returnDuplicateCodes = false;
        }
    });

    it('blocks ArrangingPayment when the chosen option is no longer offered', async () => {
        await setShippingMethods({
            shippingMethods: [{ shippingMethodId: carrierMethodId, shippingOptionCode: 'express' }],
        });
        await shopClient.query(setShippingAddressDocument, {
            input: { streetLine1: '1 Test Street', countryCode: 'GB' },
        });
        await shopClient.query(setCustomerDocument, {
            input: { emailAddress: 'options@test.com', firstName: 'Test', lastName: 'Options' },
        });

        offeredServiceCodes = ['standard', 'economy'];
        try {
            const { transitionOrderToState: refused } = await shopClient.query(transitionToStateDocument, {
                state: 'ArrangingPayment',
            });
            expect((refused as any).transitionError).toContain(
                'the selected ShippingMethod is no longer eligible',
            );
        } finally {
            offeredServiceCodes = allCarrierServices.map(s => s.code);
        }

        const { transitionOrderToState } = await shopClient.query(transitionToStateDocument, {
            state: 'ArrangingPayment',
        });
        expect((transitionOrderToState as any).state).toBe('ArrangingPayment');
        const { activeOrder } = await shopClient.query(activeOrderShippingDocument);
        expect(activeOrder?.shippingLines[0].shippingOptionCode).toBe('express');
    });

    it('returns every option from testShippingMethod', async () => {
        const { testShippingMethod } = await adminClient.query(testShippingMethodDocument, {
            input: {
                checker: { code: alwaysEligible.code, arguments: [] },
                calculator: { code: carrierCalculator.code, arguments: [] },
                shippingAddress: { streetLine1: '1 Test Street', countryCode: 'GB' },
                lines: [{ productVariantId: 'T_1', quantity: 1 }],
            },
        });

        expect(testShippingMethod.eligible).toBe(true);
        expect(testShippingMethod.quote?.price).toBe(600);
        expect(testShippingMethod.options.map(o => o.code)).toEqual(['economy', 'standard', 'express']);
    });

    describe('Admin API', () => {
        let placedOrderId: string;

        it('keeps the chosen option when the Order is placed', async () => {
            const order = await addPaymentToOrder(shopClient, testSuccessfulPaymentMethod);
            placedOrderId = order.id;

            const { order: placed } = await adminClient.query(adminOrderShippingDocument, {
                id: placedOrderId,
            });
            expect(placed?.state).toBe('PaymentSettled');
            expect(placed?.shippingLines[0].shippingOptionCode).toBe('express');
            expect(placed?.shippingLines[0].shippingOptionName).toBe('Express');
        });

        it('changes the option with modifyOrder', async () => {
            const { transitionOrderToState } = await adminClient.query(adminTransitionDocument, {
                id: placedOrderId,
                state: 'Modifying',
            });
            expect((transitionOrderToState as any).state).toBe('Modifying');

            const { modifyOrder } = await adminClient.query(modifyOrderShippingDocument, {
                input: {
                    orderId: placedOrderId,
                    dryRun: true,
                    shippingMethods: [{ shippingMethodId: carrierMethodId, shippingOptionCode: 'standard' }],
                },
            });

            expect((modifyOrder as any).shippingLines).toEqual([
                {
                    shippingMethod: { id: carrierMethodId },
                    priceWithTax: 1100,
                    shippingOptionCode: 'standard',
                    shippingOptionName: 'Standard',
                },
            ]);
        });

        it('saves the chosen option with modifyOrder', async () => {
            const { order: before } = await adminClient.query(orderPaymentsDocument, { id: placedOrderId });
            const paymentId = before?.payments?.[0]?.id;
            expect(paymentId).toBeDefined();
            // Standard is cheaper than Express, so the difference is refunded
            const { modifyOrder } = await adminClient.query(modifyOrderShippingDocument, {
                input: {
                    orderId: placedOrderId,
                    dryRun: false,
                    shippingMethods: [{ shippingMethodId: carrierMethodId, shippingOptionCode: 'standard' }],
                    refunds: [{ paymentId: paymentId as string, reason: 'Cheaper shipping' }],
                },
            });
            expect((modifyOrder as any).errorCode).toBeUndefined();

            const { order } = await adminClient.query(adminOrderShippingDocument, { id: placedOrderId });
            expect(order?.shippingLines).toEqual([
                {
                    shippingMethod: { id: carrierMethodId },
                    priceWithTax: 1100,
                    shippingOptionCode: 'standard',
                    shippingOptionName: 'Standard',
                },
            ]);
        });

        it('prices the chosen option when modifyOrder does not recalculate shipping', async () => {
            const modify = async (shippingOptionCode?: string) => {
                const { modifyOrder } = await adminClient.query(modifyOrderShippingDocument, {
                    input: {
                        orderId: placedOrderId,
                        dryRun: true,
                        options: { recalculateShipping: false },
                        shippingMethods: [{ shippingMethodId: carrierMethodId, shippingOptionCode }],
                    },
                });
                return (modifyOrder as any).shippingLines[0];
            };

            expect(await modify('express')).toMatchObject({
                priceWithTax: 1700,
                shippingOptionCode: 'express',
                shippingOptionName: 'Express',
            });
            // Without a code the cheapest option is chosen, and priced
            expect(await modify()).toMatchObject({
                priceWithTax: 700,
                shippingOptionCode: 'economy',
                shippingOptionName: 'Economy',
            });
        });

        it('prices the chosen ShippingMethod against the modified Order when shipping is not recalculated', async () => {
            const { order } = await adminClient.query(adminOrderShippingDocument, { id: placedOrderId });
            const line = order?.lines[0];
            const subTotalBefore = order?.subTotal ?? 0;
            if (!line) {
                throw new Error('The placed Order has no lines');
            }
            assignedLinesMethodEligible = true;
            try {
                const { modifyOrder } = await adminClient.query(modifyOrderShippingDocument, {
                    input: {
                        orderId: placedOrderId,
                        dryRun: true,
                        options: { recalculateShipping: false },
                        adjustOrderLines: [{ orderLineId: line.id, quantity: line.quantity + 1 }],
                        shippingMethods: [{ shippingMethodId: assignedLinesMethodId }],
                    },
                });
                const modified = modifyOrder as any;
                // 2 x T_1 becomes 3 x T_1 at 1299.00. One assigned OrderLine (1000), plus 1% of the
                // modified subTotal (3897), not of the subTotal before the modification (2598).
                expect(subTotalBefore).toBe(259800);
                expect(modified.subTotal).toBe(389700);
                expect(modified.shippingLines[0].priceWithTax).toBe(4897);
            } finally {
                assignedLinesMethodEligible = false;
            }
        });

        it('checks the eligibility on the modified Order when shipping is not recalculated', async () => {
            const { order } = await adminClient.query(adminOrderShippingDocument, { id: placedOrderId });
            const line = order?.lines[0];
            if (!line) {
                throw new Error('The placed Order has no lines');
            }
            // Eligible for the 2 x T_1 of the placed Order (259800), but not the 3 x T_1 (389700) it becomes
            assignedLinesMethodEligible = true;
            assignedLinesMaxSubTotal = 300000;
            try {
                const { modifyOrder } = await adminClient.query(modifyOrderShippingDocument, {
                    input: {
                        orderId: placedOrderId,
                        dryRun: true,
                        options: { recalculateShipping: false },
                        adjustOrderLines: [{ orderLineId: line.id, quantity: line.quantity + 1 }],
                        shippingMethods: [{ shippingMethodId: assignedLinesMethodId }],
                    },
                });
                expect((modifyOrder as any).errorCode).toBe(ErrorCode.INELIGIBLE_SHIPPING_METHOD_ERROR);
            } finally {
                assignedLinesMethodEligible = false;
                assignedLinesMaxSubTotal = undefined;
            }
        });

        it('applies the shipping promotions to the new price when modifyOrder does not recalculate shipping', async () => {
            const { createPromotion } = await adminClient.query(createPromotionDocument, {
                input: {
                    enabled: true,
                    conditions: [
                        {
                            code: 'minimum_order_amount',
                            arguments: [
                                { name: 'amount', value: '0' },
                                { name: 'taxInclusive', value: 'false' },
                            ],
                        },
                    ],
                    actions: [{ code: 'free_shipping', arguments: [] }],
                    translations: [{ languageCode: LanguageCode.en, name: 'Free shipping' }],
                },
            });
            try {
                const { modifyOrder } = await adminClient.query(modifyOrderShippingDiscountsDocument, {
                    input: {
                        orderId: placedOrderId,
                        dryRun: true,
                        options: { recalculateShipping: false },
                        shippingMethods: [
                            { shippingMethodId: carrierMethodId, shippingOptionCode: 'economy' },
                        ],
                    },
                });
                const modified = modifyOrder as any;
                expect(modified.shippingLines).toEqual([
                    { priceWithTax: 700, discountedPriceWithTax: 0, shippingOptionCode: 'economy' },
                ]);
                expect(modified.shippingWithTax).toBe(0);
            } finally {
                await adminClient.query(deletePromotionDocument, { id: (createPromotion as any).id });
            }
        });

        it('treats an empty list of shipping methods in modifyOrder as no shipping change', async () => {
            const { order } = await adminClient.query(adminOrderShippingDocument, { id: placedOrderId });
            const line = order?.lines[0];
            if (!line) {
                throw new Error('The placed Order has no lines');
            }
            const { modifyOrder } = await adminClient.query(modifyOrderShippingDocument, {
                input: {
                    orderId: placedOrderId,
                    dryRun: true,
                    adjustOrderLines: [{ orderLineId: line.id, quantity: line.quantity + 1 }],
                    shippingMethods: [],
                },
            });
            expect((modifyOrder as any).shippingLines).toHaveLength(1);
            expect((modifyOrder as any).shippingLines[0].shippingOptionCode).toBe(
                order?.shippingLines[0].shippingOptionCode,
            );
        });

        it('rejects an option which the ShippingMethod does not offer in modifyOrder', async () => {
            const { modifyOrder } = await adminClient.query(modifyOrderShippingDocument, {
                input: {
                    orderId: placedOrderId,
                    dryRun: true,
                    shippingMethods: [{ shippingMethodId: carrierMethodId, shippingOptionCode: 'teleport' }],
                },
            });
            expect((modifyOrder as any).errorCode).toBe(ErrorCode.INELIGIBLE_SHIPPING_METHOD_ERROR);
        });

        it(
            'rejects both shippingMethodIds and shippingMethods in modifyOrder',
            assertThrowsWithMessage(
                () =>
                    adminClient.query(modifyOrderShippingDocument, {
                        input: {
                            orderId: placedOrderId,
                            dryRun: true,
                            shippingMethodIds: [carrierMethodId],
                            shippingMethods: [{ shippingMethodId: carrierMethodId }],
                        },
                    }),
                "Provide at most one of 'shippingMethodIds' and 'shippingMethods'",
            ),
        );

        it('leaves a draft order without a ShippingLine when its option is refused', async () => {
            const { createDraftOrder } = await adminClient.query(createDraftOrderDocument);
            await adminClient.query(addItemToDraftOrderDocument, {
                orderId: createDraftOrder.id,
                input: { productVariantId: 'T_1', quantity: 1 },
            });

            const { setDraftOrderShippingMethod } = await adminClient.query(
                setDraftOrderShippingOptionDocument,
                {
                    orderId: createDraftOrder.id,
                    shippingMethodId: carrierMethodId,
                    shippingOptionCode: 'teleport',
                },
            );

            expect((setDraftOrderShippingMethod as any).errorCode).toBe(
                ErrorCode.INELIGIBLE_SHIPPING_METHOD_ERROR,
            );
            const { order } = await adminClient.query(adminOrderShippingDocument, {
                id: createDraftOrder.id,
            });
            expect(order?.shippingLines).toEqual([]);
        });

        it('sets a ShippingMethod on a draft order without lines', async () => {
            const { createDraftOrder } = await adminClient.query(createDraftOrderDocument);

            const { setDraftOrderShippingMethod } = await adminClient.query(
                setDraftOrderShippingOptionDocument,
                {
                    orderId: createDraftOrder.id,
                    shippingMethodId: carrierMethodId,
                },
            );

            // A ShippingLine without OrderLines is removed by the recalculation, and is not a refusal
            expect((setDraftOrderShippingMethod as any).errorCode).toBeUndefined();
            expect((setDraftOrderShippingMethod as any).shippingLines).toEqual([]);
        });

        it('sets an option on a draft order', async () => {
            const { createDraftOrder } = await adminClient.query(createDraftOrderDocument);
            await adminClient.query(addItemToDraftOrderDocument, {
                orderId: createDraftOrder.id,
                input: { productVariantId: 'T_1', quantity: 1 },
            });

            const { eligibleShippingMethodsForDraftOrder } = await adminClient.query(
                draftOrderShippingOptionsDocument,
                { orderId: createDraftOrder.id },
            );
            const carrier = eligibleShippingMethodsForDraftOrder.find(m => m.id === carrierMethodId);
            expect(carrier?.options.map(o => o.code)).toEqual(['economy', 'standard', 'express']);

            const { setDraftOrderShippingMethod } = await adminClient.query(
                setDraftOrderShippingOptionDocument,
                {
                    orderId: createDraftOrder.id,
                    shippingMethodId: carrierMethodId,
                    shippingOptionCode: 'standard',
                },
            );
            expect((setDraftOrderShippingMethod as any).shippingLines).toEqual([
                {
                    shippingMethod: { id: carrierMethodId },
                    priceWithTax: 1000,
                    shippingOptionCode: 'standard',
                    shippingOptionName: 'Standard',
                },
            ]);
        });
    });
});
