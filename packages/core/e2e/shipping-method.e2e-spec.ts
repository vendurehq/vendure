/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { DeletionResult, LanguageCode } from '@vendure/common/lib/generated-types';
import {
    defaultShippingCalculator,
    defaultShippingEligibilityChecker,
    ShippingCalculator,
} from '@vendure/core';
import { createErrorResultGuard, createTestEnvironment, ErrorResultGuard } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { manualFulfillmentHandler } from '../src/config/fulfillment/manual-fulfillment-handler';

import { shippingMethodFragment } from './graphql/fragments-admin';
import { graphql, ResultOf } from './graphql/graphql-admin';
import {
    createShippingMethodDocument,
    deleteShippingMethodDocument,
    getShippingMethodListDocument,
    updateShippingMethodDocument,
} from './graphql/shared-definitions';
import { getActiveShippingMethodsDocument } from './graphql/shop-definitions';

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
        shippingOptions: {
            shippingEligibilityCheckers: [defaultShippingEligibilityChecker],
            shippingCalculators: [defaultShippingCalculator, calculatorWithMetadata],
        },
    });

    beforeAll(async () => {
        await server.init({
            initialData,
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
