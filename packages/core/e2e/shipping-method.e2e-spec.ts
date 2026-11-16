/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { CurrencyCode, DeletionResult, LanguageCode } from '@vendure/common/lib/generated-types';
import {
    ChangeChannelEvent,
    defaultShippingCalculator,
    defaultShippingEligibilityChecker,
    EventBus,
    ShippingCalculator,
    ShippingMethod,
} from '@vendure/core';
import { createErrorResultGuard, createTestEnvironment, ErrorResultGuard } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { manualFulfillmentHandler } from '../src/config/fulfillment/manual-fulfillment-handler';

import { testSuccessfulPaymentMethod } from './fixtures/test-payment-methods';
import { shippingMethodFragment } from './graphql/fragments-admin';
import { graphql, ResultOf } from './graphql/graphql-admin';
import {
    assignProductVariantToChannelDocument,
    createChannelDocument,
    createPromotionDocument,
    createShippingMethodDocument,
    deleteShippingMethodDocument,
    getOrderDocument,
    getShippingMethodListDocument,
    updateShippingMethodDocument,
} from './graphql/shared-definitions';
import {
    addItemToOrderDocument,
    addPaymentDocument,
    applyCouponCodeDocument,
    getActiveOrderDocument,
    getActiveShippingMethodsDocument,
    setCustomerDocument,
    setShippingAddressDocument,
    setShippingMethodDocument,
    transitionToStateDocument,
} from './graphql/shop-definitions';

const TEST_METADATA = {
    foo: 'bar',
    baz: [1, 2, 3],
};

const calculatorWithMetadata = new ShippingCalculator({
    code: 'calculator-with-metadata',
    description: [{ languageCode: LanguageCode.en, value: 'Has metadata' }],
    args: {},
    calculate: () => {
        return {
            price: 100,
            priceIncludesTax: true,
            taxRate: 0,
            metadata: TEST_METADATA,
        };
    },
});
const shippingMethodGuard: ErrorResultGuard<
    NonNullable<ResultOf<typeof getShippingMethodDocument>['shippingMethod']>
> = createErrorResultGuard(input => !!input);

const activeShippingMethodsGuard: ErrorResultGuard<
    NonNullable<Array<ResultOf<typeof getActiveShippingMethodsDocument>['activeShippingMethods']>>
> = createErrorResultGuard(input => input.length > 0);

describe('ShippingMethod resolver', () => {
    const { server, adminClient, shopClient } = createTestEnvironment({
        ...testConfig(),
        paymentOptions: {
            paymentMethodHandlers: [testSuccessfulPaymentMethod],
        },
        shippingOptions: {
            shippingEligibilityCheckers: [defaultShippingEligibilityChecker],
            shippingCalculators: [defaultShippingCalculator, calculatorWithMetadata],
        },
    });

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
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('shippingEligibilityCheckers', async () => {
        const { shippingEligibilityCheckers } = await adminClient.query(getEligibilityCheckersDocument);

        expect(shippingEligibilityCheckers).toEqual([
            {
                args: [
                    {
                        description: 'Order is eligible only if its total is greater or equal to this value',
                        label: 'Minimum order value',
                        name: 'orderMinimum',
                        type: 'int',
                        ui: {
                            component: 'currency-form-input',
                        },
                    },
                ],
                code: 'default-shipping-eligibility-checker',
                description: 'Default Shipping Eligibility Checker',
            },
        ]);
    });

    it('shippingCalculators', async () => {
        const { shippingCalculators } = await adminClient.query(getCalculatorsDocument);

        expect(shippingCalculators).toEqual([
            {
                args: [
                    {
                        ui: {
                            component: 'currency-form-input',
                        },
                        description: null,
                        label: 'Shipping price',
                        name: 'rate',
                        type: 'int',
                    },
                    {
                        label: 'Price includes tax',
                        name: 'includesTax',
                        type: 'string',
                        description: null,
                        ui: {
                            component: 'select-form-input',
                            options: [
                                {
                                    label: [{ languageCode: LanguageCode.en, value: 'Includes tax' }],
                                    value: 'include',
                                },
                                {
                                    label: [{ languageCode: LanguageCode.en, value: 'Excludes tax' }],
                                    value: 'exclude',
                                },
                                {
                                    label: [
                                        { languageCode: LanguageCode.en, value: 'Auto (based on Channel)' },
                                    ],
                                    value: 'auto',
                                },
                            ],
                        },
                    },
                    {
                        ui: {
                            component: 'number-form-input',
                            min: 0,
                            suffix: '%',
                        },
                        description: null,
                        label: 'Tax rate',
                        name: 'taxRate',
                        type: 'float',
                    },
                ],
                code: 'default-shipping-calculator',
                description: 'Default Flat-Rate Shipping Calculator',
            },
            {
                args: [],
                code: 'calculator-with-metadata',
                description: 'Has metadata',
            },
        ]);
    });

    it('shippingMethods', async () => {
        const { shippingMethods } = await adminClient.query(getShippingMethodListDocument);
        expect(shippingMethods.totalItems).toEqual(3);
        expect(shippingMethods.items[0].code).toBe('standard-shipping');
        expect(shippingMethods.items[1].code).toBe('express-shipping');
        expect(shippingMethods.items[2].code).toBe('express-shipping-taxed');
    });

    it('shippingMethod', async () => {
        const { shippingMethod } = await adminClient.query(getShippingMethodDocument, {
            id: 'T_1',
        });
        shippingMethodGuard.assertSuccess(shippingMethod);
        expect(shippingMethod.code).toBe('standard-shipping');
    });

    it('createShippingMethod', async () => {
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
                    code: calculatorWithMetadata.code,
                    arguments: [],
                },
                translations: [{ languageCode: LanguageCode.en, name: 'new method', description: '' }],
            },
        });

        expect(createShippingMethod).toEqual({
            id: 'T_4',
            code: 'new-method',
            name: 'new method',
            description: '',
            calculator: {
                code: 'calculator-with-metadata',
                args: [],
            },
            checker: {
                code: 'default-shipping-eligibility-checker',
                args: [
                    {
                        name: 'orderMinimum',
                        value: '0',
                    },
                ],
            },
        });
    });

    it('testShippingMethod', async () => {
        const { testShippingMethod } = await adminClient.query(testShippingMethodDocument, {
            input: {
                calculator: {
                    code: calculatorWithMetadata.code,
                    arguments: [],
                },
                checker: {
                    code: defaultShippingEligibilityChecker.code,
                    arguments: [
                        {
                            name: 'orderMinimum',
                            value: '0',
                        },
                    ],
                },
                lines: [{ productVariantId: 'T_1', quantity: 1 }],
                shippingAddress: {
                    streetLine1: '',
                    countryCode: 'GB',
                },
            },
        });

        expect(testShippingMethod).toEqual({
            eligible: true,
            quote: {
                price: 100,
                priceWithTax: 100,
                metadata: TEST_METADATA,
            },
        });
    });

    it('testEligibleShippingMethods', async () => {
        const { testEligibleShippingMethods } = await adminClient.query(testEligibleShippingMethodsDocument, {
            input: {
                lines: [{ productVariantId: 'T_1', quantity: 1 }],
                shippingAddress: {
                    streetLine1: '',
                    countryCode: 'GB',
                },
            },
        });

        expect(testEligibleShippingMethods).toEqual([
            {
                id: 'T_4',
                name: 'new method',
                description: '',
                price: 100,
                priceWithTax: 100,
                metadata: TEST_METADATA,
            },

            {
                id: 'T_1',
                name: 'Standard Shipping',
                description: '',
                price: 500,
                priceWithTax: 500,
                metadata: null,
            },
            {
                id: 'T_2',
                name: 'Express Shipping',
                description: '',
                price: 1000,
                priceWithTax: 1000,
                metadata: null,
            },
            {
                id: 'T_3',
                name: 'Express Shipping (Taxed)',
                description: '',
                price: 1000,
                priceWithTax: 1200,
                metadata: null,
            },
        ]);
    });

    it('updateShippingMethod', async () => {
        const { updateShippingMethod } = await adminClient.query(updateShippingMethodDocument, {
            input: {
                id: 'T_4',
                translations: [{ languageCode: LanguageCode.en, name: 'changed method', description: '' }],
            },
        });

        expect(updateShippingMethod.name).toBe('changed method');
    });

    it('deleteShippingMethod', async () => {
        const listResult1 = await adminClient.query(getShippingMethodListDocument);
        expect(listResult1.shippingMethods.items.map(i => i.id)).toEqual(['T_1', 'T_2', 'T_3', 'T_4']);

        const { deleteShippingMethod } = await adminClient.query(deleteShippingMethodDocument, {
            id: 'T_4',
        });

        expect(deleteShippingMethod).toEqual({
            result: DeletionResult.DELETED,
            message: null,
        });

        const listResult2 = await adminClient.query(getShippingMethodListDocument);
        expect(listResult2.shippingMethods.items.map(i => i.id)).toEqual(['T_1', 'T_2', 'T_3']);
    });

    describe('argument ordering', () => {
        it('createShippingMethod corrects order of arguments', async () => {
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
                        code: defaultShippingCalculator.code,
                        arguments: [
                            { name: 'rate', value: '500' },
                            { name: 'taxRate', value: '20' },
                            { name: 'includesTax', value: 'include' },
                        ],
                    },
                    translations: [{ languageCode: LanguageCode.en, name: 'new method', description: '' }],
                },
            });

            expect(createShippingMethod.calculator).toEqual({
                code: defaultShippingCalculator.code,
                args: [
                    { name: 'rate', value: '500' },
                    { name: 'includesTax', value: 'include' },
                    { name: 'taxRate', value: '20' },
                ],
            });
        });

        it('updateShippingMethod corrects order of arguments', async () => {
            const { updateShippingMethod } = await adminClient.query(updateShippingMethodDocument, {
                input: {
                    id: 'T_5',
                    translations: [],
                    calculator: {
                        code: defaultShippingCalculator.code,
                        arguments: [
                            { name: 'rate', value: '500' },
                            { name: 'taxRate', value: '20' },
                            { name: 'includesTax', value: 'include' },
                        ],
                    },
                },
            });

            expect(updateShippingMethod.calculator).toEqual({
                code: defaultShippingCalculator.code,
                args: [
                    { name: 'rate', value: '500' },
                    { name: 'includesTax', value: 'include' },
                    { name: 'taxRate', value: '20' },
                ],
            });
        });

        it('get shippingMethod preserves correct ordering', async () => {
            const { shippingMethod } = await adminClient.query(getShippingMethodDocument, {
                id: 'T_5',
            });

            expect(shippingMethod?.calculator.args).toEqual([
                { name: 'rate', value: '500' },
                { name: 'includesTax', value: 'include' },
                { name: 'taxRate', value: '20' },
            ]);
        });

        it('testShippingMethod corrects order of arguments', async () => {
            const { testShippingMethod } = await adminClient.query(testShippingMethodDocument, {
                input: {
                    calculator: {
                        code: defaultShippingCalculator.code,
                        arguments: [
                            { name: 'rate', value: '500' },
                            { name: 'taxRate', value: '0' },
                            { name: 'includesTax', value: 'include' },
                        ],
                    },
                    checker: {
                        code: defaultShippingEligibilityChecker.code,
                        arguments: [
                            {
                                name: 'orderMinimum',
                                value: '0',
                            },
                        ],
                    },
                    lines: [{ productVariantId: 'T_1', quantity: 1 }],
                    shippingAddress: {
                        streetLine1: '',
                        countryCode: 'GB',
                    },
                },
            });

            expect(testShippingMethod).toEqual({
                eligible: true,
                quote: {
                    metadata: null,
                    price: 500,
                    priceWithTax: 500,
                },
            });
        });
    });

    it('returns only active shipping methods', async () => {
        // Arrange: Delete all existing shipping methods using deleteShippingMethod
        const { shippingMethods } = await adminClient.query(getShippingMethodListDocument);

        for (const method of shippingMethods.items) {
            await adminClient.query(deleteShippingMethodDocument, {
                id: method.id,
            });
        }

        // Create a new active shipping method
        await adminClient.query(createShippingMethodDocument, {
            input: {
                code: 'active-method',
                fulfillmentHandler: manualFulfillmentHandler.code,
                checker: {
                    code: defaultShippingEligibilityChecker.code,
                    arguments: [{ name: 'orderMinimum', value: '0' }],
                },
                calculator: {
                    code: defaultShippingCalculator.code,
                    arguments: [],
                },
                translations: [
                    {
                        languageCode: LanguageCode.en,
                        name: 'Active Method',
                        description: 'This is an active shipping method',
                    },
                ],
            },
        });

        // Act: Query active shipping methods
        const { activeShippingMethods } = await shopClient.query(getActiveShippingMethodsDocument);

        activeShippingMethodsGuard.assertSuccess(activeShippingMethods);
        // Assert: Ensure only the new active method is returned
        expect(activeShippingMethods).toHaveLength(1);
        expect(activeShippingMethods[0].code).toBe('active-method');
        expect(activeShippingMethods[0].name).toBe('Active Method');
        expect(activeShippingMethods[0].description).toBe('This is an active shipping method');
    });

    // https://github.com/vendure-ecommerce/vendure/issues/4492
    describe('shipping line removal on channel unassign', () => {
        let channelId: string;
        let shippingMethodId: string;

        beforeAll(async () => {
            // Create a new channel
            const { createChannel } = await adminClient.query(createChannelDocument, {
                input: {
                    code: 'shipping-test-channel',
                    token: 'shipping-test-channel-token',
                    defaultLanguageCode: LanguageCode.en,
                    currencyCode: 'USD',
                    pricesIncludeTax: false,
                    defaultShippingZoneId: 'T_1',
                    defaultTaxZoneId: 'T_1',
                },
            });
            channelId = createChannel.id;

            // Create a shipping method and assign it to the new channel
            const { createShippingMethod } = await adminClient.query(createShippingMethodDocument, {
                input: {
                    code: 'channel-test-method',
                    fulfillmentHandler: manualFulfillmentHandler.code,
                    checker: {
                        code: defaultShippingEligibilityChecker.code,
                        arguments: [{ name: 'orderMinimum', value: '0' }],
                    },
                    calculator: {
                        code: defaultShippingCalculator.code,
                        arguments: [
                            { name: 'rate', value: '500' },
                            { name: 'includesTax', value: 'auto' },
                            { name: 'taxRate', value: '0' },
                        ],
                    },
                    translations: [
                        { languageCode: LanguageCode.en, name: 'Channel Test Method', description: '' },
                    ],
                },
            });
            shippingMethodId = createShippingMethod.id;

            await adminClient.query(assignShippingMethodsToChannelDocument, {
                input: {
                    channelId,
                    shippingMethodIds: [shippingMethodId],
                },
            });

            // Assign product variant to the new channel
            await adminClient.query(assignProductVariantToChannelDocument, {
                input: {
                    channelId,
                    productVariantIds: ['T_1'],
                },
            });
        });

        it('recalculates active orders when shipping method is unassigned from channel', async () => {
            shopClient.setChannelToken('shipping-test-channel-token');
            try {
                // Create an active order in the new channel with the shipping method
                await shopClient.asAnonymousUser();
                await shopClient.query(addItemToOrderDocument, {
                    productVariantId: 'T_1',
                    quantity: 1,
                });
                await shopClient.query(setShippingMethodDocument, { id: [shippingMethodId] });

                // Verify shipping line is present and totals include shipping
                const { activeOrder: orderBefore } = await shopClient.query(getActiveOrderDocument);
                expect(orderBefore.shippingLines).toHaveLength(1);
                expect(orderBefore.shippingLines[0].shippingMethod.id).toBe(shippingMethodId);
                expect(orderBefore.shipping).toBe(500);
                expect(orderBefore.total).toBe(Number(orderBefore.subTotal) + 500);

                // Remove the shipping method from the channel
                await adminClient.query(removeShippingMethodsFromChannelDocument, {
                    input: {
                        channelId,
                        shippingMethodIds: [shippingMethodId],
                    },
                });

                // Verify the shipping line has been removed and totals recalculated
                const { activeOrder: orderAfter } = await shopClient.query(getActiveOrderDocument);
                expect(orderAfter.shippingLines).toHaveLength(0);
                expect(orderAfter.shipping).toBe(0);
                expect(orderAfter.shippingWithTax).toBe(0);
                expect(orderAfter.total).toBe(orderAfter.subTotal);
                expect(orderAfter.totalWithTax).toBe(orderAfter.subTotalWithTax);
            } finally {
                shopClient.setChannelToken('e2e-default-channel');
            }
        });

        it('historical orders still resolve shipping method after unassignment', async () => {
            try {
                // Re-assign the shipping method to the channel so we can create a completed order
                await adminClient.query(assignShippingMethodsToChannelDocument, {
                    input: {
                        channelId,
                        shippingMethodIds: [shippingMethodId],
                    },
                });

                // Create a payment method in the test channel
                adminClient.setChannelToken('shipping-test-channel-token');
                await adminClient.query(createPaymentMethodForShippingTestDocument, {
                    input: {
                        code: testSuccessfulPaymentMethod.code,
                        translations: [
                            { languageCode: LanguageCode.en, name: 'Test Payment Method', description: '' },
                        ],
                        enabled: true,
                        handler: {
                            code: testSuccessfulPaymentMethod.code,
                            arguments: [],
                        },
                    },
                });
                adminClient.setChannelToken('e2e-default-channel');

                // Create and complete an order
                shopClient.setChannelToken('shipping-test-channel-token');
                await shopClient.asAnonymousUser();
                await shopClient.query(addItemToOrderDocument, {
                    productVariantId: 'T_1',
                    quantity: 1,
                });
                await shopClient.query(setShippingMethodDocument, { id: [shippingMethodId] });
                await shopClient.query(setCustomerDocument, {
                    input: {
                        firstName: 'Test',
                        lastName: 'Customer',
                        emailAddress: 'shipping-test@test.com',
                    },
                });
                await shopClient.query(setShippingAddressDocument, {
                    input: {
                        streetLine1: '1 Test Street',
                        countryCode: 'GB',
                    },
                });
                await shopClient.query(transitionToStateDocument, { state: 'ArrangingPayment' });
                const { addPaymentToOrder: completedOrder } = await shopClient.query(addPaymentDocument, {
                    input: {
                        method: testSuccessfulPaymentMethod.code,
                        metadata: {},
                    },
                });

                // Remove the shipping method from the channel again
                await adminClient.query(removeShippingMethodsFromChannelDocument, {
                    input: {
                        channelId,
                        shippingMethodIds: [shippingMethodId],
                    },
                });

                // Verify the historical order still resolves the shipping method
                adminClient.setChannelToken('shipping-test-channel-token');
                const { order } = await adminClient.query(getOrderDocument, {
                    id: completedOrder.id,
                });
                expect(order.shippingLines).toHaveLength(1);
                expect(order.shippingLines[0].shippingMethod.id).toBe(shippingMethodId);
                expect(order.shippingLines[0].shippingMethod.name).toBe('Channel Test Method');
            } finally {
                shopClient.setChannelToken('e2e-default-channel');
                adminClient.setChannelToken('e2e-default-channel');
            }
        });
    });

    // https://github.com/vendure-ecommerce/vendure/issues/4494
    describe('shipping line removal - additional scenarios', () => {
        const ROLLBACK_METHOD_CODE = 'rollback-test-method';
        const GBP_CHANNEL_TOKEN = 'gbp-shipping-channel-token';
        const SECOND_CHANNEL_TOKEN = 'second-shipping-channel-token';
        let gbpChannelId: string;
        let secondChannelId: string;
        let multiChannelMethodId: string;
        let rollbackMethodId: string;

        function shippingMethodInput(code: string, name: string, rate = '500') {
            return {
                code,
                fulfillmentHandler: manualFulfillmentHandler.code,
                checker: {
                    code: defaultShippingEligibilityChecker.code,
                    arguments: [{ name: 'orderMinimum', value: '0' }],
                },
                calculator: {
                    code: defaultShippingCalculator.code,
                    arguments: [
                        { name: 'rate', value: rate },
                        { name: 'includesTax', value: 'auto' },
                        { name: 'taxRate', value: '0' },
                    ],
                },
                translations: [{ languageCode: LanguageCode.en, name, description: '' }],
            };
        }

        beforeAll(async () => {
            const { createChannel: gbpChannel } = await adminClient.query(createChannelDocument, {
                input: {
                    code: 'gbp-shipping-channel',
                    token: GBP_CHANNEL_TOKEN,
                    defaultLanguageCode: LanguageCode.en,
                    currencyCode: CurrencyCode.GBP,
                    pricesIncludeTax: false,
                    defaultShippingZoneId: 'T_1',
                    defaultTaxZoneId: 'T_1',
                },
            });
            gbpChannelId = gbpChannel.id;

            const { createChannel: secondChannel } = await adminClient.query(createChannelDocument, {
                input: {
                    code: 'second-shipping-channel',
                    token: SECOND_CHANNEL_TOKEN,
                    defaultLanguageCode: LanguageCode.en,
                    currencyCode: CurrencyCode.USD,
                    pricesIncludeTax: false,
                    defaultShippingZoneId: 'T_1',
                    defaultTaxZoneId: 'T_1',
                },
            });
            secondChannelId = secondChannel.id;

            const { createShippingMethod: multiMethod } = await adminClient.query(
                createShippingMethodDocument,
                { input: shippingMethodInput('multi-channel-method', 'Multi Channel Method') },
            );
            multiChannelMethodId = multiMethod.id;

            const { createShippingMethod: rollbackMethod } = await adminClient.query(
                createShippingMethodDocument,
                { input: shippingMethodInput(ROLLBACK_METHOD_CODE, 'Rollback Method') },
            );
            rollbackMethodId = rollbackMethod.id;

            for (const channelId of [gbpChannelId, secondChannelId]) {
                await adminClient.query(assignShippingMethodsToChannelDocument, {
                    input: { channelId, shippingMethodIds: [multiChannelMethodId] },
                });
                await adminClient.query(assignProductVariantToChannelDocument, {
                    input: { channelId, productVariantIds: ['T_1'] },
                });
            }
            await adminClient.query(assignShippingMethodsToChannelDocument, {
                input: { channelId: secondChannelId, shippingMethodIds: [rollbackMethodId] },
            });

            // Simulate a mid-removal failure to prove the transaction rolls back.
            const eventBus = server.app.get(EventBus);
            eventBus.registerBlockingEventHandler({
                id: 'e2e-4494-rollback-shipping-method-throw',
                event: ChangeChannelEvent,
                handler: async event => {
                    if (
                        event.entityType === ShippingMethod &&
                        event.type === 'removed' &&
                        (event.entity as ShippingMethod).code === ROLLBACK_METHOD_CODE
                    ) {
                        throw new Error('Simulated failure during shipping method removal');
                    }
                },
            });
        });

        async function createActiveOrder(channelToken: string, shippingMethodId: string) {
            shopClient.setChannelToken(channelToken);
            await shopClient.asAnonymousUser();
            await shopClient.query(addItemToOrderDocument, { productVariantId: 'T_1', quantity: 1 });
            await shopClient.query(setShippingMethodDocument, { id: [shippingMethodId] });
            const { activeOrder } = await shopClient.query(getActiveOrderDocument);
            return activeOrder!;
        }

        it('recalculates every affected active order in a channel, not just the first', async () => {
            try {
                const orderA = await createActiveOrder(SECOND_CHANNEL_TOKEN, multiChannelMethodId);
                const orderB = await createActiveOrder(SECOND_CHANNEL_TOKEN, multiChannelMethodId);
                expect(orderA.id).not.toBe(orderB.id);
                expect(orderA.shipping).toBe(500);
                expect(orderB.shipping).toBe(500);

                await adminClient.query(removeShippingMethodsFromChannelDocument, {
                    input: { channelId: secondChannelId, shippingMethodIds: [multiChannelMethodId] },
                });

                adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
                for (const orderId of [orderA.id, orderB.id]) {
                    const { order } = await adminClient.query(getOrderDocument, { id: orderId });
                    expect(order!.shippingLines).toHaveLength(0);
                    expect(order!.shipping).toBe(0);
                    expect(order!.total).toBe(order!.subTotal);
                }
            } finally {
                shopClient.setChannelToken('e2e-default-channel');
                adminClient.setChannelToken('e2e-default-channel');
                // Restore the assignment for later tests.
                await adminClient.query(assignShippingMethodsToChannelDocument, {
                    input: { channelId: secondChannelId, shippingMethodIds: [multiChannelMethodId] },
                });
            }
        });

        it('only recalculates the channel it was unassigned from, preserving currency', async () => {
            try {
                const gbpOrder = await createActiveOrder(GBP_CHANNEL_TOKEN, multiChannelMethodId);
                const usdOrder = await createActiveOrder(SECOND_CHANNEL_TOKEN, multiChannelMethodId);
                expect(gbpOrder.currencyCode).toBe(CurrencyCode.GBP);
                expect(gbpOrder.shipping).toBe(500);
                expect(usdOrder.shipping).toBe(500);

                // Unassign from the GBP channel while the admin acts from the default
                // (USD) channel: recalculation must still use the order's GBP currency.
                await adminClient.query(removeShippingMethodsFromChannelDocument, {
                    input: { channelId: gbpChannelId, shippingMethodIds: [multiChannelMethodId] },
                });

                adminClient.setChannelToken(GBP_CHANNEL_TOKEN);
                const { order: gbpAfter } = await adminClient.query(getOrderDocument, { id: gbpOrder.id });
                expect(gbpAfter!.shippingLines).toHaveLength(0);
                expect(gbpAfter!.shipping).toBe(0);
                expect(gbpAfter!.total).toBe(gbpAfter!.subTotal);
                expect(gbpAfter!.currencyCode).toBe(CurrencyCode.GBP);

                adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
                const { order: usdAfter } = await adminClient.query(getOrderDocument, { id: usdOrder.id });
                expect(usdAfter!.shippingLines).toHaveLength(1);
                expect(usdAfter!.shipping).toBe(500);
            } finally {
                shopClient.setChannelToken('e2e-default-channel');
                adminClient.setChannelToken('e2e-default-channel');
            }
        });

        it('recalculates promotion-adjusted totals after unassignment', async () => {
            const couponCode = 'SHIPPING-4494';
            try {
                const { createShippingMethod: method } = await adminClient.query(
                    createShippingMethodDocument,
                    { input: shippingMethodInput('promo-method', 'Promo Method') },
                );
                const methodId = method.id;
                await adminClient.query(assignShippingMethodsToChannelDocument, {
                    input: { channelId: secondChannelId, shippingMethodIds: [methodId] },
                });

                // The promotion is only active in the channel it is created in.
                adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
                await adminClient.query(createPromotionDocument, {
                    input: {
                        enabled: true,
                        couponCode,
                        translations: [
                            { languageCode: LanguageCode.en, name: '10% off order', description: '' },
                        ],
                        conditions: [],
                        actions: [
                            {
                                code: 'order_percentage_discount',
                                arguments: [{ name: 'discount', value: '10' }],
                            },
                        ],
                    },
                });
                adminClient.setChannelToken('e2e-default-channel');

                shopClient.setChannelToken(SECOND_CHANNEL_TOKEN);
                await shopClient.asAnonymousUser();
                await shopClient.query(addItemToOrderDocument, { productVariantId: 'T_1', quantity: 1 });
                await shopClient.query(setShippingMethodDocument, { id: [methodId] });
                await shopClient.query(applyCouponCodeDocument, { couponCode });

                const { activeOrder: before } = await shopClient.query(getActiveOrderDocument);
                expect(before!.shipping).toBe(500);
                expect(before!.discounts.length).toBeGreaterThan(0);
                const discountedSubTotal = before!.subTotal;

                await adminClient.query(removeShippingMethodsFromChannelDocument, {
                    input: { channelId: secondChannelId, shippingMethodIds: [methodId] },
                });

                shopClient.setChannelToken(SECOND_CHANNEL_TOKEN);
                const { activeOrder: after } = await shopClient.query(getActiveOrderDocument);
                expect(after!.shippingLines).toHaveLength(0);
                expect(after!.shipping).toBe(0);
                expect(after!.discounts.length).toBeGreaterThan(0);
                expect(after!.subTotal).toBe(discountedSubTotal);
                expect(after!.total).toBe(after!.subTotal);
            } finally {
                shopClient.setChannelToken('e2e-default-channel');
                adminClient.setChannelToken('e2e-default-channel');
            }
        });

        it('rolls back the unassignment when the removal handler fails', async () => {
            try {
                const order = await createActiveOrder(SECOND_CHANNEL_TOKEN, rollbackMethodId);
                expect(order.shippingLines).toHaveLength(1);

                await expect(
                    adminClient.query(removeShippingMethodsFromChannelDocument, {
                        input: { channelId: secondChannelId, shippingMethodIds: [rollbackMethodId] },
                    }),
                ).rejects.toThrow();

                // The rolled-back transaction must leave the order untouched.
                shopClient.setChannelToken(SECOND_CHANNEL_TOKEN);
                const { activeOrder } = await shopClient.query(getActiveOrderDocument);
                expect(activeOrder!.shippingLines).toHaveLength(1);
                expect(activeOrder!.shippingLines[0].shippingMethod.id).toBe(rollbackMethodId);
                expect(activeOrder!.shipping).toBe(500);
            } finally {
                shopClient.setChannelToken('e2e-default-channel');
                adminClient.setChannelToken('e2e-default-channel');
            }
        });
    });
});

const getShippingMethodDocument = graphql(
    `
        query GetShippingMethod($id: ID!) {
            shippingMethod(id: $id) {
                ...ShippingMethod
            }
        }
    `,
    [shippingMethodFragment],
);

const getEligibilityCheckersDocument = graphql(`
    query GetEligibilityCheckers {
        shippingEligibilityCheckers {
            code
            description
            args {
                name
                type
                description
                label
                ui
            }
        }
    }
`);

const getCalculatorsDocument = graphql(`
    query GetCalculators {
        shippingCalculators {
            code
            description
            args {
                name
                type
                description
                label
                ui
            }
        }
    }
`);

const testShippingMethodDocument = graphql(`
    query TestShippingMethod($input: TestShippingMethodInput!) {
        testShippingMethod(input: $input) {
            eligible
            quote {
                price
                priceWithTax
                metadata
            }
        }
    }
`);

export const testEligibleShippingMethodsDocument = graphql(`
    query TestEligibleMethods($input: TestEligibleShippingMethodsInput!) {
        testEligibleShippingMethods(input: $input) {
            id
            name
            description
            price
            priceWithTax
            metadata
        }
    }
`);

const assignShippingMethodsToChannelDocument = graphql(`
    mutation AssignShippingMethodsToChannel($input: AssignShippingMethodsToChannelInput!) {
        assignShippingMethodsToChannel(input: $input) {
            id
            name
        }
    }
`);

const createPaymentMethodForShippingTestDocument = graphql(`
    mutation CreatePaymentMethodForShippingTest($input: CreatePaymentMethodInput!) {
        createPaymentMethod(input: $input) {
            id
            code
            name
        }
    }
`);

const removeShippingMethodsFromChannelDocument = graphql(`
    mutation RemoveShippingMethodsFromChannel($input: RemoveShippingMethodsFromChannelInput!) {
        removeShippingMethodsFromChannel(input: $input) {
            id
            name
        }
    }
`);
