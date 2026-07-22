import { CurrencyCode, LanguageCode } from '@vendure/common/lib/generated-types';
import {
    Asset,
    CustomFields,
    Logger,
    mergeConfig,
    OrderService,
    ProductService,
    RequestContextService,
    TransactionalConnection,
} from '@vendure/core';
import { createErrorResultGuard, createTestEnvironment, ErrorResultGuard } from '@vendure/testing';
import { fail } from 'node:assert';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { graphql, ResultOf } from './graphql/graphql-admin';
import { graphql as graphqlShop, ResultOf as ResultOfShop } from './graphql/graphql-shop';
import { assertThrowsWithMessage } from './utils/assert-throws-with-message';
import { fixPostgresTimezone } from './utils/fix-pg-timezone';

fixPostgresTimezone();

const validateInjectorSpy = vi.fn();

const customConfig = mergeConfig(testConfig(), {
    dbConnectionOptions: {
        timezone: 'Z',
    },
    customFields: {
        Product: [
            { name: 'nullable', type: 'string' },
            { name: 'notNullable', type: 'string', nullable: false, defaultValue: '' },
            { name: 'stringWithDefault', type: 'string', defaultValue: 'hello' },
            { name: 'localeStringWithDefault', type: 'localeString', defaultValue: 'hola' },
            { name: 'intWithDefault', type: 'int', defaultValue: 5 },
            { name: 'floatWithDefault', type: 'float', defaultValue: 5.5678 },
            { name: 'booleanWithDefault', type: 'boolean', defaultValue: true },
            {
                name: 'dateTimeWithDefault',
                type: 'datetime',
                defaultValue: new Date('2019-04-30T12:59:16.4158386Z'),
            },
            { name: 'validateString', type: 'string', pattern: '^[0-9][a-z]+$' },
            { name: 'validateLocaleString', type: 'localeString', pattern: '^[0-9][a-z]+$' },
            { name: 'validateInt', type: 'int', min: 0, max: 10 },
            { name: 'validateFloat', type: 'float', min: 0.5, max: 10.5 },
            {
                name: 'validateDateTime',
                type: 'datetime',
                min: '2019-01-01T08:30',
                max: '2019-06-01T08:30',
            },
            {
                name: 'validateFn1',
                type: 'string',
                validate: value => {
                    if (value !== 'valid') {
                        return `The value ['${value as string}'] is not valid`;
                    }
                },
            },
            {
                name: 'validateFn2',
                type: 'string',
                validate: value => {
                    if (value !== 'valid') {
                        return [
                            {
                                languageCode: LanguageCode.en,
                                value: `The value ['${value as string}'] is not valid`,
                            },
                        ];
                    }
                },
            },
            {
                name: 'validateFn3',
                type: 'string',
                validate: (value, injector) => {
                    const connection = injector.get(TransactionalConnection);
                    validateInjectorSpy(connection);
                },
            },
            {
                name: 'validateFn4',
                type: 'string',
                validate: async (value, injector) => {
                    await new Promise(resolve => setTimeout(resolve, 1));
                    return 'async error';
                },
            },
            {
                name: 'validateRelation',
                type: 'relation',
                entity: Asset,
                validate: async value => {
                    await new Promise(resolve => setTimeout(resolve, 1));
                    return 'relation error';
                },
            },
            {
                name: 'stringWithOptions',
                type: 'string',
                options: [{ value: 'small' }, { value: 'medium' }, { value: 'large' }],
            },
            {
                name: 'nullableStringWithOptions',
                type: 'string',
                nullable: true,
                options: [{ value: 'small' }, { value: 'medium' }, { value: 'large' }],
            },
            {
                name: 'nonPublic',
                type: 'string',
                defaultValue: 'hi!',
                public: false,
            },
            {
                name: 'public',
                type: 'string',
                defaultValue: 'ho!',
                public: true,
            },
            {
                name: 'longString',
                type: 'string',
                length: 10000,
            },
            {
                name: 'longLocaleString',
                type: 'localeString',
                length: 10000,
            },
            {
                name: 'readonlyString',
                type: 'string',
                readonly: true,
            },
            {
                name: 'internalString',
                type: 'string',
                internal: true,
            },
            {
                name: 'dashboardHidden',
                type: 'boolean',
                ui: { dashboard: false },
                readonly: true,
                public: true,
            },
            {
                name: 'dashboardHiddenWritable',
                type: 'string',
                ui: { dashboard: false },
            },
            {
                name: 'stringList',
                type: 'string',
                list: true,
            },
            {
                name: 'localeStringList',
                type: 'localeString',
                list: true,
            },
            {
                name: 'stringListWithDefault',
                type: 'string',
                list: true,
                defaultValue: ['cat'],
            },
            {
                name: 'intListWithValidation',
                type: 'int',
                list: true,
                validate: value => {
                    if (!value.includes(42)) {
                        return 'Must include the number 42!';
                    }
                },
            },
            {
                name: 'uniqueString',
                type: 'string',
                unique: true,
            },
        ],
        Facet: [
            {
                name: 'translated',
                type: 'localeString',
            },
        ],
        Customer: [
            {
                name: 'score',
                type: 'int',
                readonly: true,
            },
        ],
        Collection: [
            { name: 'secretKey1', type: 'string', defaultValue: '', public: false, internal: true },
            { name: 'secretKey2', type: 'string', defaultValue: '', public: false, internal: false },
        ],
        OrderLine: [{ name: 'validateInt', type: 'int', min: 0, max: 10 }],
        ProductVariantPrice: [
            {
                name: 'costPrice',
                type: 'int',
            },
        ],
        // Single readonly Address custom field to test
        // https://github.com/vendurehq/vendure/issues/3326
        Address: [
            {
                name: 'hereId',
                type: 'string',
                readonly: true,
                nullable: true,
            },
        ],
    } as CustomFields,
});

describe('Custom fields', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(customConfig);

    // Product guard for nullable results with customFields
    type ProductWithCustomFields = NonNullable<ResultOf<typeof getProductNullableDocument>['product']>;
    const productGuard: ErrorResultGuard<ProductWithCustomFields> = createErrorResultGuard(
        input => input !== null && 'customFields' in input,
    );

    // Collection guard for shop API
    type CollectionResult = NonNullable<ResultOfShop<typeof getCollectionCustomFieldsDocument>['collection']>;
    const collectionGuard: ErrorResultGuard<CollectionResult> = createErrorResultGuard(
        input => input !== null,
    );

    // ProductVariant guard (custom document with price customFields)
    type ProductVariantResult = ResultOf<
        typeof updateProductVariantsWithPriceCustomFieldsDocument
    >['updateProductVariants'][number];
    const productVariantGuard: ErrorResultGuard<ProductVariantResult> = createErrorResultGuard(
        input => input !== null && 'prices' in input,
    );

    // Order guard for shop API validation tests
    type OrderWithLines = { id: string; lines: any[] };
    const orderGuard: ErrorResultGuard<OrderWithLines> = createErrorResultGuard(input => 'lines' in input);

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('globalSettings.serverConfig.customFieldConfig', async () => {
        const { globalSettings } = await adminClient.query(getServerConfigCustomFieldsDocument);

        expect(globalSettings.serverConfig.customFieldConfig).toEqual({
            Product: [
                { name: 'nullable', type: 'string', list: false },
                { name: 'notNullable', type: 'string', list: false },
                { name: 'stringWithDefault', type: 'string', list: false },
                { name: 'localeStringWithDefault', type: 'localeString', list: false },
                { name: 'intWithDefault', type: 'int', list: false },
                { name: 'floatWithDefault', type: 'float', list: false },
                { name: 'booleanWithDefault', type: 'boolean', list: false },
                { name: 'dateTimeWithDefault', type: 'datetime', list: false },
                { name: 'validateString', type: 'string', list: false },
                { name: 'validateLocaleString', type: 'localeString', list: false },
                { name: 'validateInt', type: 'int', list: false },
                { name: 'validateFloat', type: 'float', list: false },
                { name: 'validateDateTime', type: 'datetime', list: false },
                { name: 'validateFn1', type: 'string', list: false },
                { name: 'validateFn2', type: 'string', list: false },
                { name: 'validateFn3', type: 'string', list: false },
                { name: 'validateFn4', type: 'string', list: false },
                {
                    name: 'validateRelation',
                    type: 'relation',
                    list: false,
                    scalarFields: [
                        'id',
                        'createdAt',
                        'updatedAt',
                        'languageCode',
                        'name',
                        'type',
                        'fileSize',
                        'mimeType',
                        'width',
                        'height',
                        'source',
                        'preview',
                        'customFields',
                    ],
                },
                { name: 'stringWithOptions', type: 'string', list: false },
                { name: 'nullableStringWithOptions', type: 'string', list: false },
                { name: 'nonPublic', type: 'string', list: false },
                { name: 'public', type: 'string', list: false },
                { name: 'longString', type: 'string', list: false },
                { name: 'longLocaleString', type: 'localeString', list: false },
                { name: 'readonlyString', type: 'string', list: false },
                // The internal type should not be exposed at all
                // { name: 'internalString', type: 'string' },
                // dashboard: false fields ARE still exposed in the legacy customFieldConfig
                { name: 'dashboardHidden', type: 'boolean', list: false },
                { name: 'dashboardHiddenWritable', type: 'string', list: false },
                { name: 'stringList', type: 'string', list: true },
                { name: 'localeStringList', type: 'localeString', list: true },
                { name: 'stringListWithDefault', type: 'string', list: true },
                { name: 'intListWithValidation', type: 'int', list: true },
                { name: 'uniqueString', type: 'string', list: false },
            ],
        });
    });

    it('globalSettings.serverConfig.entityCustomFields', async () => {
        const { globalSettings } = await adminClient.query(getServerConfigEntityCustomFieldsDocument);

        const productCustomFields = globalSettings.serverConfig.entityCustomFields.find(
            e => e.entityName === 'Product',
        );
        expect(productCustomFields).toEqual({
            entityName: 'Product',
            customFields: [
                { name: 'nullable', type: 'string', list: false },
                { name: 'notNullable', type: 'string', list: false },
                { name: 'stringWithDefault', type: 'string', list: false },
                { name: 'localeStringWithDefault', type: 'localeString', list: false },
                { name: 'intWithDefault', type: 'int', list: false },
                { name: 'floatWithDefault', type: 'float', list: false },
                { name: 'booleanWithDefault', type: 'boolean', list: false },
                { name: 'dateTimeWithDefault', type: 'datetime', list: false },
                { name: 'validateString', type: 'string', list: false },
                { name: 'validateLocaleString', type: 'localeString', list: false },
                { name: 'validateInt', type: 'int', list: false },
                { name: 'validateFloat', type: 'float', list: false },
                { name: 'validateDateTime', type: 'datetime', list: false },
                { name: 'validateFn1', type: 'string', list: false },
                { name: 'validateFn2', type: 'string', list: false },
                { name: 'validateFn3', type: 'string', list: false },
                { name: 'validateFn4', type: 'string', list: false },
                {
                    name: 'validateRelation',
                    type: 'relation',
                    list: false,
                    scalarFields: [
                        'id',
                        'createdAt',
                        'updatedAt',
                        'languageCode',
                        'name',
                        'type',
                        'fileSize',
                        'mimeType',
                        'width',
                        'height',
                        'source',
                        'preview',
                        'customFields',
                    ],
                },
                { name: 'stringWithOptions', type: 'string', list: false },
                { name: 'nullableStringWithOptions', type: 'string', list: false },
                { name: 'nonPublic', type: 'string', list: false },
                { name: 'public', type: 'string', list: false },
                { name: 'longString', type: 'string', list: false },
                { name: 'longLocaleString', type: 'localeString', list: false },
                { name: 'readonlyString', type: 'string', list: false },
                { name: 'stringList', type: 'string', list: true },
                { name: 'localeStringList', type: 'localeString', list: true },
                { name: 'stringListWithDefault', type: 'string', list: true },
                { name: 'intListWithValidation', type: 'int', list: true },
                { name: 'uniqueString', type: 'string', list: false },
                // The internal type should not be exposed at all
                // { name: 'internalString', type: 'string' },
                // The dashboard: false type should not be exposed in entityCustomFields
                // { name: 'dashboardHidden', type: 'boolean' },
            ],
        });
    });

    it('dashboard: false field is still queryable via Admin API', async () => {
        const { product } = await adminClient.query(getProductDashboardHiddenDocument);
        expect(product.customFields.dashboardHidden).toBeNull();
    });

    it('dashboard: false field is still queryable via Shop API', async () => {
        const { product } = await shopClient.query(getShopProductDashboardHiddenDocument);
        expect(product.customFields.dashboardHidden).toBeNull();
    });

    it('ui.dashboard: false field is still writable via Admin API', async () => {
        const { updateProduct } = await adminClient.query(updateProductDashboardHiddenWritableDocument);
        expect(updateProduct.customFields.dashboardHiddenWritable).toBe('set-by-plugin');
    });

    it('get nullable with no default', async () => {
        const { product } = await adminClient.query(getProductNullableDocument, { id: 'T_1' });

        expect(product).toEqual({
            id: 'T_1',
            name: 'Laptop',
            customFields: {
                nullable: null,
            },
        });
    });

    it('get entity with localeString only', async () => {
        const { facet } = await adminClient.query(getFacetCustomFieldsDocument, { id: 'T_1' });

        expect(facet).toEqual({
            id: 'T_1',
            name: 'category',
            customFields: {
                translated: null,
            },
        });
    });

    it('get fields with default values', async () => {
        const { product } = await adminClient.query(getProductWithDefaultsDocument, { id: 'T_1' });

        const customFields = {
            stringWithDefault: 'hello',
            localeStringWithDefault: 'hola',
            intWithDefault: 5,
            floatWithDefault: 5.5678,
            booleanWithDefault: true,
            dateTimeWithDefault: '2019-04-30T12:59:16.415Z',
            // MySQL does not support defaults on TEXT fields, which is what "simple-json" uses
            // internally. See https://stackoverflow.com/q/3466872/772859
            stringListWithDefault: customConfig.dbConnectionOptions.type === 'mysql' ? null : ['cat'],
        };

        expect(product).toEqual({
            id: 'T_1',
            name: 'Laptop',
            customFields,
        });
    });

    it(
        'update non-nullable field',
        assertThrowsWithMessage(async () => {
            await adminClient.query(
                graphql(`
                    mutation {
                        updateProduct(input: { id: "T_1", customFields: { notNullable: null } }) {
                            id
                        }
                    }
                `),
            );
        }, 'The custom field "notNullable" value cannot be set to null'),
    );

    it(
        'throws on attempt to update readonly field',
        assertThrowsWithMessage(async () => {
            await adminClient.query(
                graphql(`
                    mutation {
                        updateProduct(input: { id: "T_1", customFields: { readonlyString: "hello" } }) {
                            id
                        }
                    }
                `),
            );
        }, 'Field "readonlyString" is not defined by type "UpdateProductCustomFieldsInput"'),
    );

    it(
        'throws on attempt to update readonly field when no other custom fields defined',
        assertThrowsWithMessage(async () => {
            await adminClient.query(
                graphql(`
                    mutation {
                        updateCustomer(input: { id: "T_1", customFields: { score: 5 } }) {
                            ... on Customer {
                                id
                            }
                        }
                    }
                `),
            );
        }, 'The custom field "score" is readonly'),
    );

    it(
        'throws on attempt to create readonly field',
        assertThrowsWithMessage(async () => {
            await adminClient.query(
                graphql(`
                    mutation {
                        createProduct(
                            input: {
                                translations: [{ languageCode: en, name: "test" }]
                                customFields: { readonlyString: "hello" }
                            }
                        ) {
                            id
                        }
                    }
                `),
            );
        }, 'Field "readonlyString" is not defined by type "CreateProductCustomFieldsInput"'),
    );

    it('string length allows long strings', async () => {
        const longString = Array.from({ length: 500 }, v => 'hello there!').join(' ');
        const result = await adminClient.query(updateProductLongStringDocument, {
            id: 'T_1',
            stringValue: longString,
        });

        expect(result.updateProduct.customFields.longString).toBe(longString);
    });

    it('string length allows long localeStrings', async () => {
        const longString = Array.from({ length: 500 }, v => 'hello there!').join(' ');
        const result = await adminClient.query(updateProductLongLocaleStringDocument, {
            id: 'T_1',
            stringValue: longString,
        });

        expect(result.updateProduct.customFields.longLocaleString).toBe(longString);
    });

    describe('validation', () => {
        it(
            'invalid string',
            assertThrowsWithMessage(async () => {
                await adminClient.query(
                    graphql(`
                        mutation {
                            updateProduct(input: { id: "T_1", customFields: { validateString: "hello" } }) {
                                id
                            }
                        }
                    `),
                );
            }, 'The custom field "validateString" value ["hello"] does not match the pattern [^[0-9][a-z]+$]'),
        );

        it(
            'invalid string option',
            assertThrowsWithMessage(async () => {
                await adminClient.query(
                    graphql(`
                        mutation {
                            updateProduct(input: { id: "T_1", customFields: { stringWithOptions: "tiny" } }) {
                                id
                            }
                        }
                    `),
                );
            }, "The custom field \"stringWithOptions\" value [\"tiny\"] is invalid. Valid options are ['small', 'medium', 'large']"),
        );

        it('valid string option', async () => {
            const { updateProduct } = await adminClient.query(updateProductStringOptionsDocument, {
                id: 'T_1',
                value: 'medium',
            });
            expect(updateProduct.customFields.stringWithOptions).toBe('medium');
        });

        it('nullable string option with null', async () => {
            const { updateProduct } = await adminClient.query(updateProductNullableStringOptionsDocument, {
                id: 'T_1',
                value: null,
            });
            expect(updateProduct.customFields.nullableStringWithOptions).toBeNull();
        });

        it(
            'invalid localeString',
            assertThrowsWithMessage(async () => {
                await adminClient.query(
                    graphql(`
                        mutation {
                            updateProduct(
                                input: {
                                    id: "T_1"
                                    translations: [
                                        {
                                            id: "T_1"
                                            languageCode: en
                                            customFields: { validateLocaleString: "servus" }
                                        }
                                    ]
                                }
                            ) {
                                id
                            }
                        }
                    `),
                );
            }, 'The custom field "validateLocaleString" value ["servus"] does not match the pattern [^[0-9][a-z]+$]'),
        );

        it(
            'invalid int',
            assertThrowsWithMessage(async () => {
                await adminClient.query(
                    graphql(`
                        mutation {
                            updateProduct(input: { id: "T_1", customFields: { validateInt: 12 } }) {
                                id
                            }
                        }
                    `),
                );
            }, 'The custom field "validateInt" value [12] is greater than the maximum [10]'),
        );

        it(
            'invalid float',
            assertThrowsWithMessage(async () => {
                await adminClient.query(
                    graphql(`
                        mutation {
                            updateProduct(input: { id: "T_1", customFields: { validateFloat: 10.6 } }) {
                                id
                            }
                        }
                    `),
                );
            }, 'The custom field "validateFloat" value [10.6] is greater than the maximum [10.5]'),
        );

        it(
            'invalid datetime',
            assertThrowsWithMessage(async () => {
                await adminClient.query(
                    graphql(`
                        mutation {
                            updateProduct(
                                input: {
                                    id: "T_1"
                                    customFields: { validateDateTime: "2019-01-01T05:25:00.000Z" }
                                }
                            ) {
                                id
                            }
                        }
                    `),
                );
            }, 'The custom field "validateDateTime" value [2019-01-01T05:25:00.000Z] is less than the minimum [2019-01-01T08:30]'),
        );

        it(
            'invalid validate function with string',
            assertThrowsWithMessage(async () => {
                await adminClient.query(
                    graphql(`
                        mutation {
                            updateProduct(input: { id: "T_1", customFields: { validateFn1: "invalid" } }) {
                                id
                            }
                        }
                    `),
                );
            }, "The value ['invalid'] is not valid"),
        );

        it(
            'invalid validate function with localized string',
            assertThrowsWithMessage(async () => {
                await adminClient.query(
                    graphql(`
                        mutation {
                            updateProduct(input: { id: "T_1", customFields: { validateFn2: "invalid" } }) {
                                id
                            }
                        }
                    `),
                );
            }, "The value ['invalid'] is not valid"),
        );

        it(
            'invalid list field',
            assertThrowsWithMessage(async () => {
                await adminClient.query(
                    graphql(`
                        mutation {
                            updateProduct(
                                input: { id: "T_1", customFields: { intListWithValidation: [1, 2, 3] } }
                            ) {
                                id
                            }
                        }
                    `),
                );
            }, 'Must include the number 42!'),
        );

        it('valid list field', async () => {
            const { updateProduct } = await adminClient.query(updateProductIntListDocument, {
                id: 'T_1',
                values: [1, 42, 3],
            });
            expect(updateProduct.customFields.intListWithValidation).toEqual([1, 42, 3]);
        });

        it('can inject providers into validation fn', async () => {
            const { updateProduct } = await adminClient.query(updateProductValidateFn3Document, {
                id: 'T_1',
                value: 'some value',
            });
            expect(updateProduct.customFields.validateFn3).toBe('some value');
            expect(validateInjectorSpy).toHaveBeenCalledTimes(1);
            expect(validateInjectorSpy.mock.calls[0][0] instanceof TransactionalConnection).toBe(true);
        });

        it(
            'supports async validation fn',
            assertThrowsWithMessage(async () => {
                await adminClient.query(
                    graphql(`
                        mutation {
                            updateProduct(input: { id: "T_1", customFields: { validateFn4: "some value" } }) {
                                id
                                customFields {
                                    validateFn4
                                }
                            }
                        }
                    `),
                );
            }, 'async error'),
        );

        // https://github.com/vendurehq/vendure/issues/1000
        it(
            'supports validation of relation types',
            assertThrowsWithMessage(async () => {
                await adminClient.query(
                    graphql(`
                        mutation {
                            updateProduct(input: { id: "T_1", customFields: { validateRelationId: "T_1" } }) {
                                id
                                customFields {
                                    validateFn4
                                }
                            }
                        }
                    `),
                );
            }, 'relation error'),
        );

        // https://github.com/vendurehq/vendure/issues/1091
        it('handles well graphql internal fields', async () => {
            // throws "Cannot read property 'args' of undefined" if broken
            await adminClient.query(
                graphql(`
                    mutation {
                        __typename
                        updateProduct(input: { id: "T_1", customFields: { nullable: "some value" } }) {
                            __typename
                            id
                            customFields {
                                __typename
                                nullable
                            }
                        }
                    }
                `),
            );
        });

        // https://github.com/vendurehq/vendure/issues/1953
        describe('validation of OrderLine custom fields', () => {
            it('addItemToOrder', async () => {
                try {
                    const { addItemToOrder } = await shopClient.query(
                        graphqlShop(`
                        mutation {
                            addItemToOrder(
                                productVariantId: 1
                                quantity: 1
                                customFields: { validateInt: 11 }
                            ) {
                                ... on Order {
                                    id
                                }
                            }
                        }
                    `),
                    );
                    fail('Should have thrown');
                } catch (e) {
                    expect(e.message).toContain(
                        'The custom field "validateInt" value [11] is greater than the maximum [10]',
                    );
                }

                const { addItemToOrder: result } = await shopClient.query(
                    addItemToOrderWithCustomFieldsDocument,
                    {
                        productVariantId: '1',
                        quantity: 1,
                        validateInt: 9,
                    },
                );

                orderGuard.assertSuccess(result);
                expect(result.lines[0].customFields).toEqual({ validateInt: 9 });
            });

            it('adjustOrderLine', async () => {
                try {
                    const { adjustOrderLine } = await shopClient.query(
                        graphqlShop(`
                        mutation {
                            adjustOrderLine(
                                orderLineId: "T_1"
                                quantity: 1
                                customFields: { validateInt: 11 }
                            ) {
                                ... on Order {
                                    id
                                }
                            }
                        }
                    `),
                    );
                    fail('Should have thrown');
                } catch (e) {
                    expect(e.message).toContain(
                        'The custom field "validateInt" value [11] is greater than the maximum [10]',
                    );
                }

                const { adjustOrderLine: result } = await shopClient.query(
                    adjustOrderLineWithCustomFieldsDocument,
                    {
                        orderLineId: 'T_1',
                        quantity: 1,
                        validateInt: 2,
                    },
                );

                orderGuard.assertSuccess(result);
                expect(result.lines[0].customFields).toEqual({ validateInt: 2 });
            });
        });
    });

    describe('public access', () => {
        it(
            'non-public throws for Shop API',
            assertThrowsWithMessage(async () => {
                await shopClient.query(
                    graphqlShop(`
                    query {
                        product(id: "T_1") {
                            id
                            customFields {
                                nonPublic
                            }
                        }
                    }
                `),
                );
            }, 'Cannot query field "nonPublic" on type "ProductCustomFields"'),
        );

        it('publicly accessible via Shop API', async () => {
            const { product } = await shopClient.query(getShopProductPublicCustomFieldDocument, {
                id: 'T_1',
            });

            if (!product) {
                throw new Error('Product not found');
            }
            productGuard.assertSuccess(product);
            expect(product.customFields.public).toBe('ho!');
        });

        it(
            'internal throws for Shop API',
            assertThrowsWithMessage(async () => {
                await shopClient.query(
                    graphqlShop(`
                    query {
                        product(id: "T_1") {
                            id
                            customFields {
                                internalString
                            }
                        }
                    }
                `),
                );
            }, 'Cannot query field "internalString" on type "ProductCustomFields"'),
        );

        it(
            'internal throws for Admin API',
            assertThrowsWithMessage(async () => {
                await adminClient.query(
                    graphql(`
                        query {
                            product(id: "T_1") {
                                id
                                customFields {
                                    internalString
                                }
                            }
                        }
                    `),
                );
            }, 'Cannot query field "internalString" on type "ProductCustomFields"'),
        );

        // https://github.com/vendurehq/vendure/issues/3049
        it('does not leak private fields via JSON type', async () => {
            const { collection } = await shopClient.query(getCollectionCustomFieldsDocument, { id: 'T_1' });

            collectionGuard.assertSuccess(collection);
            expect(collection.customFields).toBe(null);
        });
    });

    describe('sort & filter', () => {
        it('can sort by custom fields', async () => {
            const { products } = await adminClient.query(getProductsSortByNullableDocument);

            expect(products.totalItems).toBe(1);
        });

        // https://github.com/vendurehq/vendure/issues/1581
        it('can sort by localeString custom fields', async () => {
            const { products } = await adminClient.query(getProductsSortByLocaleStringDocument);

            expect(products.totalItems).toBe(1);
        });

        it('can filter by custom fields', async () => {
            const { products } = await adminClient.query(getProductsFilterByStringDocument);

            expect(products.totalItems).toBe(1);
        });

        it('can filter by localeString custom fields', async () => {
            const { products } = await adminClient.query(getProductsFilterByLocaleStringDocument);

            expect(products.totalItems).toBe(1);
        });

        it('can filter by custom list fields', async () => {
            const { products: result1 } = await adminClient.query(getProductsFilterByIntListDocument, {
                value: 42,
            });

            expect(result1.totalItems).toBe(1);
            const { products: result2 } = await adminClient.query(getProductsFilterByIntListDocument, {
                value: 43,
            });

            expect(result2.totalItems).toBe(0);
        });

        it(
            'cannot sort by custom list fields',
            assertThrowsWithMessage(async () => {
                await adminClient.query(
                    graphql(`
                        query {
                            products(options: { sort: { intListWithValidation: ASC } }) {
                                totalItems
                            }
                        }
                    `),
                );
            }, 'Field "intListWithValidation" is not defined by type "ProductSortParameter".'),
        );

        it(
            'cannot filter by internal field in Admin API',
            assertThrowsWithMessage(async () => {
                await adminClient.query(
                    graphql(`
                        query {
                            products(options: { filter: { internalString: { contains: "hello" } } }) {
                                totalItems
                            }
                        }
                    `),
                );
            }, 'Field "internalString" is not defined by type "ProductFilterParameter"'),
        );

        it(
            'cannot filter by internal field in Shop API',
            assertThrowsWithMessage(async () => {
                await shopClient.query(
                    graphqlShop(`
                    query {
                        products(options: { filter: { internalString: { contains: "hello" } } }) {
                            totalItems
                        }
                    }
                `),
                );
            }, 'Field "internalString" is not defined by type "ProductFilterParameter"'),
        );
    });

    describe('product on productVariant entity', () => {
        it('is translated', async () => {
            const { productVariants } = await adminClient.query(getProductVariantsWithCustomFieldsDocument, {
                productId: 'T_1',
            });

            expect(productVariants.items[0].product).toEqual({
                id: 'T_1',
                name: 'Laptop',
                customFields: {
                    localeStringWithDefault: 'hola',
                    stringWithDefault: 'hello',
                },
            });
        });
    });

    describe('unique constraint', () => {
        it('setting unique value works', async () => {
            const result = await adminClient.query(updateProductUniqueStringDocument, {
                id: 'T_1',
                value: 'foo',
            });

            expect(result.updateProduct.customFields.uniqueString).toBe('foo');
        });

        it('setting conflicting value fails', async () => {
            try {
                await adminClient.query(createProductUniqueStringDocument, { uniqueString: 'foo' });
                fail('Should have thrown');
            } catch (e: any) {
                let duplicateKeyErrMessage = 'unassigned';
                switch (customConfig.dbConnectionOptions.type) {
                    case 'mariadb':
                    case 'mysql':
                        duplicateKeyErrMessage = "Duplicate entry 'foo' for key";
                        break;
                    case 'postgres':
                        duplicateKeyErrMessage = 'duplicate key value violates unique constraint';
                        break;
                    case 'sqlite':
                    case 'sqljs':
                        duplicateKeyErrMessage = 'UNIQUE constraint failed: product.customFieldsUniquestring';
                        break;
                }
                expect(e.message).toContain(duplicateKeyErrMessage);
            }
        });
    });

    it('on ProductVariantPrice', async () => {
        const { updateProductVariants } = await adminClient.query(
            updateProductVariantsWithPriceCustomFieldsDocument,
            {
                input: [
                    {
                        id: 'T_1',
                        prices: [
                            {
                                price: 129900,
                                currencyCode: 'USD',
                                customFields: {
                                    costPrice: 100,
                                },
                            },
                        ],
                    },
                ],
            },
        );

        productVariantGuard.assertSuccess(updateProductVariants[0]);
        if (!updateProductVariants[0]) {
            throw new Error('Update product variants failed');
        }
        expect(updateProductVariants[0].prices).toEqual([
            {
                currencyCode: 'USD',
                price: 129900,
                customFields: {
                    costPrice: 100,
                },
            },
        ]);
    });

    // https://github.com/vendurehq/vendure/issues/3909
    it('persists custom fields when creating a new ProductVariantPrice', async () => {
        // First, add EUR to the channel's available currencies
        await adminClient.query(
            graphql(`
                mutation UpdateChannel($input: UpdateChannelInput!) {
                    updateChannel(input: $input) {
                        ... on Channel {
                            id
                            availableCurrencyCodes
                        }
                    }
                }
            `),
            {
                input: {
                    id: 'T_1',
                    availableCurrencyCodes: [CurrencyCode.USD, CurrencyCode.EUR],
                },
            },
        );

        // Now create a new price in EUR with custom fields
        const { updateProductVariants } = await adminClient.query(
            graphql(`
                mutation UpdateProductVariants($input: [UpdateProductVariantInput!]!) {
                    updateProductVariants(input: $input) {
                        id
                        prices {
                            currencyCode
                            price
                            customFields {
                                costPrice
                            }
                        }
                    }
                }
            `),
            {
                input: [
                    {
                        id: 'T_1',
                        prices: [
                            {
                                price: 129900,
                                currencyCode: 'USD',
                                customFields: {
                                    costPrice: 100,
                                },
                            },
                            {
                                price: 99900,
                                currencyCode: 'EUR',
                                customFields: {
                                    costPrice: 200,
                                },
                            },
                        ],
                    },
                ],
            },
        );

        expect(updateProductVariants[0].prices).toContainEqual({
            currencyCode: 'EUR',
            price: 99900,
            customFields: {
                costPrice: 200,
            },
        });
    });

    describe('setting custom fields directly via a service method', () => {
        it('OrderService.addItemToOrder warns on unknown custom field', async () => {
            const orderService = server.app.get(OrderService);
            const requestContextService = server.app.get(RequestContextService);
            const ctx = await requestContextService.create({
                apiType: 'admin',
            });

            const order = await orderService.create(ctx);

            const warnSpy = vi.spyOn(Logger, 'warn');

            await orderService.addItemToOrder(ctx, order.id, 1, 1, {
                customFieldWhichDoesNotExist: 'test value',
            });

            expect(warnSpy).toHaveBeenCalledWith(
                'Custom field customFieldWhichDoesNotExist not found for entity OrderLine',
            );
        });

        it('OrderService.addItemToOrder does not warn on known custom field', async () => {
            const orderService = server.app.get(OrderService);
            const requestContextService = server.app.get(RequestContextService);
            const ctx = await requestContextService.create({
                apiType: 'admin',
            });

            const order = await orderService.create(ctx);

            const warnSpy = vi.spyOn(Logger, 'warn');

            await orderService.addItemToOrder(ctx, order.id, 1, 1, {
                validateInt: 1,
            });

            expect(warnSpy).not.toHaveBeenCalled();
        });

        it('OrderService.addItemToOrder warns on multiple unknown custom fields', async () => {
            const orderService = server.app.get(OrderService);
            const requestContextService = server.app.get(RequestContextService);
            const ctx = await requestContextService.create({
                apiType: 'admin',
            });

            const order = await orderService.create(ctx);

            const warnSpy = vi.spyOn(Logger, 'warn');

            await orderService.addItemToOrder(ctx, order.id, 1, 1, {
                unknownField1: 'foo',
                unknownField2: 'bar',
            });

            expect(warnSpy).toHaveBeenCalledWith('Custom field unknownField1 not found for entity OrderLine');
            expect(warnSpy).toHaveBeenCalledWith('Custom field unknownField2 not found for entity OrderLine');
        });

        it('OrderService.addItemToOrder does not warn when no custom fields are provided', async () => {
            const orderService = server.app.get(OrderService);
            const requestContextService = server.app.get(RequestContextService);
            const ctx = await requestContextService.create({
                apiType: 'admin',
            });

            const order = await orderService.create(ctx);

            const warnSpy = vi.spyOn(Logger, 'warn');

            await orderService.addItemToOrder(ctx, order.id, 1, 1);

            expect(warnSpy).not.toHaveBeenCalled();
        });

        it('warns on unknown custom field in ProductTranslation entity', async () => {
            const productService = server.app.get(ProductService);
            const requestContextService = server.app.get(RequestContextService);
            const ctx = await requestContextService.create({
                apiType: 'admin',
            });
            const warnSpy = vi.spyOn(Logger, 'warn');

            await productService.create(ctx, {
                translations: [
                    {
                        languageCode: LanguageCode.en,
                        name: 'test',
                        slug: 'test',
                        description: '',
                        customFields: { customFieldWhichDoesNotExist: 'foo' },
                    },
                ],
            });

            expect(warnSpy).toHaveBeenCalledWith(
                'Custom field customFieldWhichDoesNotExist not found for entity ProductTranslation',
            );
        });

        it('does not warn when Translation has a valid custom field', async () => {
            const productService = server.app.get(ProductService);
            const requestContextService = server.app.get(RequestContextService);
            const ctx = await requestContextService.create({
                apiType: 'admin',
            });
            const warnSpy = vi.spyOn(Logger, 'warn');

            await productService.create(ctx, {
                translations: [
                    {
                        languageCode: LanguageCode.en,
                        name: 'test',
                        slug: 'test',
                        description: '',
                        customFields: { localeStringWithDefault: 'foo' },
                    },
                ],
            });

            expect(warnSpy).not.toHaveBeenCalled();
        });
    });
});

const getServerConfigCustomFieldsDocument = graphql(`
    query GetServerConfigCustomFields {
        globalSettings {
            serverConfig {
                customFieldConfig {
                    Product {
                        ... on CustomField {
                            name
                            type
                            list
                        }
                        ... on RelationCustomFieldConfig {
                            scalarFields
                        }
                    }
                }
            }
        }
    }
`);

const getServerConfigEntityCustomFieldsDocument = graphql(`
    query GetServerConfigEntityCustomFields {
        globalSettings {
            serverConfig {
                entityCustomFields {
                    entityName
                    customFields {
                        ... on CustomField {
                            name
                            type
                            list
                        }
                        ... on RelationCustomFieldConfig {
                            scalarFields
                        }
                    }
                }
            }
        }
    }
`);

const getProductNullableDocument = graphql(`
    query GetProductNullable($id: ID!) {
        product(id: $id) {
            id
            name
            customFields {
                nullable
            }
        }
    }
`);

const getProductWithDefaultsDocument = graphql(`
    query GetProductWithDefaults($id: ID!) {
        product(id: $id) {
            id
            name
            customFields {
                stringWithDefault
                localeStringWithDefault
                intWithDefault
                floatWithDefault
                booleanWithDefault
                dateTimeWithDefault
                stringListWithDefault
            }
        }
    }
`);

const updateProductLongStringDocument = graphql(`
    mutation UpdateProductLongString($id: ID!, $stringValue: String!) {
        updateProduct(input: { id: $id, customFields: { longString: $stringValue } }) {
            id
            customFields {
                longString
            }
        }
    }
`);

const updateProductLongLocaleStringDocument = graphql(`
    mutation UpdateProductLongLocaleString($id: ID!, $stringValue: String!) {
        updateProduct(
            input: {
                id: $id
                translations: [{ languageCode: en, customFields: { longLocaleString: $stringValue } }]
            }
        ) {
            id
            customFields {
                longLocaleString
            }
        }
    }
`);

const updateProductStringOptionsDocument = graphql(`
    mutation UpdateProductStringOptions($id: ID!, $value: String!) {
        updateProduct(input: { id: $id, customFields: { stringWithOptions: $value } }) {
            id
            customFields {
                stringWithOptions
            }
        }
    }
`);

const updateProductNullableStringOptionsDocument = graphql(`
    mutation UpdateProductNullableStringOptions($id: ID!, $value: String) {
        updateProduct(input: { id: $id, customFields: { nullableStringWithOptions: $value } }) {
            id
            customFields {
                nullableStringWithOptions
            }
        }
    }
`);

const updateProductIntListDocument = graphql(`
    mutation UpdateProductIntList($id: ID!, $values: [Int!]!) {
        updateProduct(input: { id: $id, customFields: { intListWithValidation: $values } }) {
            id
            customFields {
                intListWithValidation
            }
        }
    }
`);

const updateProductValidateFn3Document = graphql(`
    mutation UpdateProductValidateFn3($id: ID!, $value: String!) {
        updateProduct(input: { id: $id, customFields: { validateFn3: $value } }) {
            id
            customFields {
                validateFn3
            }
        }
    }
`);

const updateProductUniqueStringDocument = graphql(`
    mutation UpdateProductUniqueString($id: ID!, $value: String!) {
        updateProduct(input: { id: $id, customFields: { uniqueString: $value } }) {
            id
            customFields {
                uniqueString
            }
        }
    }
`);

const createProductUniqueStringDocument = graphql(`
    mutation CreateProductUniqueString($uniqueString: String!) {
        createProduct(
            input: {
                translations: [{ languageCode: en, name: "test 2", slug: "test-2", description: "" }]
                customFields: { uniqueString: $uniqueString }
            }
        ) {
            id
        }
    }
`);

const getProductVariantsWithCustomFieldsDocument = graphql(`
    query GetProductVariantsWithCustomFields($productId: ID!) {
        productVariants(productId: $productId) {
            items {
                product {
                    name
                    id
                    customFields {
                        localeStringWithDefault
                        stringWithDefault
                    }
                }
            }
        }
    }
`);

const getFacetCustomFieldsDocument = graphql(`
    query GetFacetCustomFields($id: ID!) {
        facet(id: $id) {
            id
            name
            customFields {
                translated
            }
        }
    }
`);

const getCollectionCustomFieldsDocument = graphqlShop(`
    query GetCollectionCustomFields($id: ID!) {
        collection(id: $id) {
            id
            customFields
        }
    }
`);

const getProductsSortByNullableDocument = graphql(`
    query GetProductsSortByNullable {
        products(options: { sort: { nullable: ASC } }) {
            totalItems
        }
    }
`);

const getProductsSortByLocaleStringDocument = graphql(`
    query GetProductsSortByLocaleString {
        products(options: { sort: { localeStringWithDefault: ASC } }) {
            totalItems
        }
    }
`);

const getProductsFilterByStringDocument = graphql(`
    query GetProductsFilterByString {
        products(options: { filter: { stringWithDefault: { contains: "hello" } } }) {
            totalItems
        }
    }
`);

const getProductsFilterByLocaleStringDocument = graphql(`
    query GetProductsFilterByLocaleString {
        products(options: { filter: { localeStringWithDefault: { contains: "hola" } } }) {
            totalItems
        }
    }
`);

const getProductsFilterByIntListDocument = graphql(`
    query GetProductsFilterByIntList($value: Float!) {
        products(options: { filter: { intListWithValidation: { inList: $value } } }) {
            totalItems
        }
    }
`);

const addItemToOrderWithCustomFieldsDocument = graphqlShop(`
    mutation AddItemToOrderWithCustomFields($productVariantId: ID!, $quantity: Int!, $validateInt: Int!) {
        addItemToOrder(productVariantId: $productVariantId, quantity: $quantity, customFields: { validateInt: $validateInt }) {
            ... on Order {
                id
                lines {
                    customFields {
                        validateInt
                    }
                }
            }
        }
    }
`);

const adjustOrderLineWithCustomFieldsDocument = graphqlShop(`
    mutation AdjustOrderLineWithCustomFields($orderLineId: ID!, $quantity: Int!, $validateInt: Int!) {
        adjustOrderLine(orderLineId: $orderLineId, quantity: $quantity, customFields: { validateInt: $validateInt }) {
            ... on Order {
                id
                lines {
                    customFields {
                        validateInt
                    }
                }
            }
        }
    }
`);

const updateProductVariantsWithPriceCustomFieldsDocument = graphql(`
    mutation UpdateProductVariantsWithPriceCustomFields($input: [UpdateProductVariantInput!]!) {
        updateProductVariants(input: $input) {
            id
            prices {
                currencyCode
                price
                customFields {
                    costPrice
                }
            }
        }
    }
`);

const getShopProductPublicCustomFieldDocument = graphqlShop(`
    query GetShopProductPublicCustomField($id: ID!) {
        product(id: $id) {
            id
            customFields {
                public
            }
        }
    }
`);

const getProductDashboardHiddenDocument = graphql(`
    query GetProductDashboardHidden {
        product(id: "T_1") {
            id
            customFields {
                dashboardHidden
            }
        }
    }
`);

const getShopProductDashboardHiddenDocument = graphqlShop(`
    query GetShopProductDashboardHidden {
        product(id: "T_1") {
            id
            customFields {
                dashboardHidden
            }
        }
    }
`);

const updateProductDashboardHiddenWritableDocument = graphql(`
    mutation UpdateProductDashboardHiddenWritable {
        updateProduct(input: { id: "T_1", customFields: { dashboardHiddenWritable: "set-by-plugin" } }) {
            id
            customFields {
                dashboardHiddenWritable
            }
        }
    }
`);
