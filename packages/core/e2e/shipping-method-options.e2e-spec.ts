import { ErrorCode, LanguageCode } from '@vendure/common/lib/generated-types';
import {
    manualFulfillmentHandler,
    ShippingCalculationResult,
    ShippingCalculator,
    ShippingEligibilityChecker,
} from '@vendure/core';
import { createErrorResultGuard, createTestEnvironment, ErrorResultGuard } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { testSuccessfulPaymentMethod } from './fixtures/test-payment-methods';
import { graphql as adminGraphql } from './graphql/graphql-admin';
import { graphql, ResultOf, VariablesOf } from './graphql/graphql-shop';
import { createShippingMethodDocument } from './graphql/shared-definitions';
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

/**
 * Stands in for a carrier API: one result per service, priced by the quantity in the Order,
 * deliberately not in price order.
 */
const carrierCalculator = new ShippingCalculator({
    code: 'carrier-calculator',
    description: [{ languageCode: LanguageCode.en, value: 'Carrier rates' }],
    args: {},
    calculate: (_ctx, order): ShippingCalculationResult[] => {
        const quantity = order.lines.reduce((sum, line) => sum + line.quantity, 0);
        return allCarrierServices
            .filter(service => offeredServiceCodes.includes(service.code))
            .map(service => ({
                code: returnDuplicateCodes ? 'same' : service.code,
                name: service.name,
                price: service.basePrice + quantity * 100,
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
    calculate: () => ({ price: 2000, priceIncludesTax: false, taxRate: 0 }),
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

describe('ShippingMethod with several options', () => {
    const { server, adminClient, shopClient } = createTestEnvironment({
        ...testConfig(),
        shippingOptions: {
            shippingEligibilityCheckers: [alwaysEligible],
            shippingCalculators: [carrierCalculator, flatRateCalculator],
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
    let orderLineId: string;

    const setShippingMethods = async (variables: VariablesOf<typeof setShippingMethodsDocument>) => {
        const { setOrderShippingMethod } = await shopClient.query(setShippingMethodsDocument, variables);
        return setOrderShippingMethod;
    };

    const createMethod = async (code: string, calculatorCode: string) => {
        const { createShippingMethod } = await adminClient.query(createShippingMethodDocument, {
            input: {
                code,
                fulfillmentHandler: manualFulfillmentHandler.code,
                checker: { code: alwaysEligible.code, arguments: [] },
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
            "Provide either the 'shippingMethodId' or the 'shippingMethods' argument, but not both",
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

    it(
        'fails when a calculator returns several results without unique codes',
        assertThrowsWithMessage(async () => {
            returnDuplicateCodes = true;
            try {
                await shopClient.query(eligibleShippingMethodsWithOptionsDocument);
            } finally {
                returnDuplicateCodes = false;
            }
        }, 'do not each have a unique "code"'),
    );

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
