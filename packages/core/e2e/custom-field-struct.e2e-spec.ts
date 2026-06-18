import { mergeConfig } from '@vendure/core';
import { createErrorResultGuard, createTestEnvironment, ErrorResultGuard } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { graphql } from './graphql/graphql-admin';
import { graphql as graphqlShop, ResultOf } from './graphql/graphql-shop';
import { assertThrowsWithMessage } from './utils/assert-throws-with-message';
import { fixPostgresTimezone } from './utils/fix-pg-timezone';

fixPostgresTimezone();

const customConfig = mergeConfig(testConfig(), {
    dbConnectionOptions: {
        timezone: 'Z',
    },
    customFields: {
        Product: [
            {
                name: 'attributes',
                type: 'struct',
                fields: [
                    { name: 'color', type: 'string' },
                    { name: 'size', type: 'string' },
                    { name: 'material', type: 'string' },
                    { name: 'weight', type: 'int' },
                    { name: 'isDownloadable', type: 'boolean' },
                    { name: 'releaseDate', type: 'datetime' },
                ],
            },
        ],
        Customer: [
            {
                name: 'coupons',
                type: 'struct',
                list: true,
                fields: [
                    { name: 'code', type: 'string' },
                    { name: 'discount', type: 'int' },
                    { name: 'used', type: 'boolean' },
                ],
            },
            {
                name: 'company',
                type: 'struct',
                fields: [{ name: 'phoneNumbers', type: 'string', list: true }],
            },
            {
                name: 'withValidation',
                type: 'struct',
                fields: [
                    { name: 'stringWithPattern', type: 'string', pattern: '^[0-9][a-z]+$' },
                    { name: 'numberWithRange', type: 'int', min: 1, max: 10 },
                    {
                        name: 'stringWithValidationFn',
                        type: 'string',
                        validate: (value: string) => {
                            if (value !== 'valid') {
                                return `The value ['${value}'] is not valid`;
                            }
                        },
                    },
                ],
            },
        ],
        OrderLine: [
            {
                type: 'struct',
                name: 'fromBundle',
                fields: [
                    { name: 'bundleId', type: 'string' },
                    { name: 'bundleName', type: 'string' },
                ],
            },
        ],
        Address: [
            {
                name: 'geoLocation',
                type: 'struct',
                fields: [
                    { name: 'latitude', type: 'float' },
                    { name: 'longitude', type: 'float' },
                ],
            },
        ],
        // https://github.com/vendurehq/vendure/issues/3381
        GlobalSettings: [
            {
                name: 'tipsPercentage',
                type: 'struct',
                list: true,
                fields: [
                    { name: 'percentage', type: 'float' },
                    { name: 'name', type: 'string' },
                    { name: 'isDefault', type: 'boolean' },
                ],
            },
        ],
    },
});

const productGuard: ErrorResultGuard<
    NonNullable<ResultOf<typeof getProductWithStructAttributesDocument>['product']>
> = createErrorResultGuard(input => !!input);

describe('Custom field struct type', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(customConfig);

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

    it('globalSettings.serverConfig.customFieldConfig resolves struct fields', async () => {
        const { globalSettings } = await adminClient.query(getGlobalSettingsCustomFieldConfigDocument);

        expect(globalSettings.serverConfig.customFieldConfig.Product).toEqual([
            {
                name: 'attributes',
                type: 'struct',
                list: false,
                fields: [
                    { name: 'color', type: 'string', list: false },
                    { name: 'size', type: 'string', list: false },
                    { name: 'material', type: 'string', list: false },
                    { name: 'weight', type: 'int', list: false },
                    { name: 'isDownloadable', type: 'boolean', list: false },
                    { name: 'releaseDate', type: 'datetime', list: false },
                ],
            },
        ]);
    });

    it('globalSettings.serverConfig.entityCustomFields resolves struct fields', async () => {
        const { globalSettings } = await adminClient.query(getGlobalSettingsEntityCustomFieldsDocument);

        const productEntry = globalSettings.serverConfig.entityCustomFields.find(
            (e: any) => e.entityName === 'Product',
        );
        expect(productEntry).toEqual({
            entityName: 'Product',
            customFields: [
                {
                    name: 'attributes',
                    type: 'struct',
                    list: false,
                    fields: [
                        { name: 'color', type: 'string', list: false },
                        { name: 'size', type: 'string', list: false },
                        { name: 'material', type: 'string', list: false },
                        { name: 'weight', type: 'int', list: false },
                        { name: 'isDownloadable', type: 'boolean', list: false },
                        { name: 'releaseDate', type: 'datetime', list: false },
                    ],
                },
            ],
        });
    });

    it('struct fields initially null', async () => {
        const result = await adminClient.query(getProductWithStructAttributesDocument);

        productGuard.assertSuccess(result.product);

        expect(result.product.customFields.attributes).toEqual({
            color: null,
            size: null,
            material: null,
            weight: null,
            isDownloadable: null,
            releaseDate: null,
        });
    });

    it('update all fields in struct', async () => {
        const result = await adminClient.query(updateProductWithAllStructFieldsDocument);

        expect(result.updateProduct.customFields.attributes).toEqual({
            color: 'red',
            size: 'L',
            material: 'cotton',
            weight: 123,
            isDownloadable: true,
            releaseDate: '2021-01-01T12:00:00.000Z',
        });
    });

    it('partial update of struct fields nulls missing fields', async () => {
        const result = await adminClient.query(updateProductWithPartialStructFieldsDocument);

        expect(result.updateProduct.customFields.attributes).toEqual({
            color: 'red',
            size: 'L',
            material: 'cotton',
            weight: null,
            isDownloadable: null,
            releaseDate: null,
        });
    });

    it('updating OrderLine custom fields', async () => {
        const result = await shopClient.query(addItemToOrderWithBundleDocument);
        orderGuard.assertSuccess(result.addItemToOrder);

        expect(result.addItemToOrder.lines[0].customFields).toEqual({
            fromBundle: {
                bundleId: 'bundle-1',
                bundleName: 'Bundle 1',
            },
        });
    });

    it('updating Address custom fields', async () => {
        const result = await adminClient.query(updateCustomerAddressWithGeoLocationDocument);

        expect(result.updateCustomerAddress.customFields).toEqual({
            geoLocation: {
                latitude: 1.23,
                longitude: 4.56,
            },
        });
    });

    it('updating OrderAddress custom fields', async () => {
        const result = await shopClient.query(setOrderShippingAddressWithGeoLocationDocument, {
            input: {
                fullName: 'name',
                streetLine1: '12 the street',
                city: 'foo',
                postalCode: '123456',
                countryCode: 'US',
                customFields: {
                    geoLocation: {
                        latitude: 1.23,
                        longitude: 4.56,
                    },
                },
            },
        });
        orderShippingGuard.assertSuccess(result.setOrderShippingAddress);

        expect((result.setOrderShippingAddress.shippingAddress as any).customFields).toEqual({
            geoLocation: {
                latitude: 1.23,
                longitude: 4.56,
            },
        });
    });

    describe('struct list', () => {
        it('is initially an empty array', async () => {
            const result = await adminClient.query(getCustomerCouponsDocument);
            customerQueryGuard.assertSuccess(result.customer);
            expect(result.customer.customFields.coupons).toEqual([]);
        });

        it('sets list values', async () => {
            const result = await adminClient.query(updateCustomerCouponsDocument);
            customerGuard.assertSuccess(result.updateCustomer);

            expect(result.updateCustomer.customFields).toEqual({
                coupons: [
                    { code: 'ABC', discount: 10, used: false },
                    { code: 'DEF', discount: 20, used: true },
                ],
            });
        });
    });

    describe('struct field list', () => {
        it('is initially an empty array', async () => {
            const result = await adminClient.query(getCustomerCompanyDocument);
            customerQueryGuard.assertSuccess(result.customer);
            expect(result.customer.customFields.company).toEqual({
                phoneNumbers: [],
            });
        });

        it('set list field values', async () => {
            const result = await adminClient.query(updateCustomerCompanyDocument);
            customerGuard.assertSuccess(result.updateCustomer);

            expect(result.updateCustomer.customFields.company).toEqual({
                phoneNumbers: ['123', '456'],
            });
        });
    });

    describe('struct field validation', () => {
        it(
            'string pattern',
            assertThrowsWithMessage(async () => {
                await adminClient.query(updateCustomerWithInvalidPatternDocument);
            }, `The custom field "stringWithPattern" value ["abc"] does not match the pattern [^[0-9][a-z]+$]`),
        );

        it(
            'number range',
            assertThrowsWithMessage(async () => {
                await adminClient.query(updateCustomerWithInvalidRangeDocument);
            }, `The custom field "numberWithRange" value [15] is greater than the maximum [10]`),
        );
        it(
            'validate function',
            assertThrowsWithMessage(async () => {
                await adminClient.query(updateCustomerWithInvalidValidationDocument);
            }, `The value ['bad'] is not valid`),
        );
    });
});

// Error Result Guards
type OrderWithCustomFields = Extract<
    ResultOf<typeof addItemToOrderWithBundleDocument>['addItemToOrder'],
    { id: string }
>;
const orderGuard: ErrorResultGuard<OrderWithCustomFields> = createErrorResultGuard(input => !!input.lines);

type OrderWithShippingAddress = Extract<
    ResultOf<typeof setOrderShippingAddressWithGeoLocationDocument>['setOrderShippingAddress'],
    { id: string }
>;

const orderShippingGuard: ErrorResultGuard<OrderWithShippingAddress> = createErrorResultGuard(
    input => !!input.shippingAddress,
);

type CustomerWithCoupons = Extract<
    ResultOf<typeof updateCustomerCouponsDocument>['updateCustomer'],
    { id: string }
>;
const customerGuard: ErrorResultGuard<CustomerWithCoupons> = createErrorResultGuard(
    input => !!input.customFields,
);

type CustomerQueryResult = NonNullable<ResultOf<typeof getCustomerCouponsDocument>['customer']>;
const customerQueryGuard: ErrorResultGuard<CustomerQueryResult> = createErrorResultGuard(input => !!input);

// GraphQL Documents
const getGlobalSettingsCustomFieldConfigDocument = graphql(`
    query GetGlobalSettingsCustomFieldConfig {
        globalSettings {
            serverConfig {
                customFieldConfig {
                    Product {
                        ... on CustomField {
                            name
                            type
                            list
                        }
                        ... on StructCustomFieldConfig {
                            fields {
                                ... on StructField {
                                    name
                                    type
                                    list
                                }
                            }
                        }
                    }
                }
            }
        }
    }
`);

const getGlobalSettingsEntityCustomFieldsDocument = graphql(`
    query GetGlobalSettingsEntityCustomFields {
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
                        ... on StructCustomFieldConfig {
                            fields {
                                ... on StructField {
                                    name
                                    type
                                    list
                                }
                            }
                        }
                    }
                }
            }
        }
    }
`);

const getProductWithStructAttributesDocument = graphql(`
    query GetProductWithStructAttributes {
        product(id: "T_1") {
            id
            customFields {
                attributes {
                    color
                    size
                    material
                    weight
                    isDownloadable
                    releaseDate
                }
            }
        }
    }
`);

const updateProductWithAllStructFieldsDocument = graphql(`
    mutation UpdateProductWithAllStructFields {
        updateProduct(
            input: {
                id: "T_1"
                customFields: {
                    attributes: {
                        color: "red"
                        size: "L"
                        material: "cotton"
                        weight: 123
                        isDownloadable: true
                        releaseDate: "2021-01-01T12:00:00.000Z"
                    }
                }
            }
        ) {
            id
            customFields {
                attributes {
                    color
                    size
                    material
                    weight
                    isDownloadable
                    releaseDate
                }
            }
        }
    }
`);

const updateProductWithPartialStructFieldsDocument = graphql(`
    mutation UpdateProductWithPartialStructFields {
        updateProduct(
            input: {
                id: "T_1"
                customFields: { attributes: { color: "red", size: "L", material: "cotton" } }
            }
        ) {
            id
            customFields {
                attributes {
                    color
                    size
                    material
                    weight
                    isDownloadable
                    releaseDate
                }
            }
        }
    }
`);

const addItemToOrderWithBundleDocument = graphqlShop(`
    mutation AddItemToOrderWithBundle {
        addItemToOrder(
            productVariantId: "T_1"
            quantity: 1
            customFields: { fromBundle: { bundleId: "bundle-1", bundleName: "Bundle 1" } }
        ) {
            ... on Order {
                id
                lines {
                    id
                    customFields {
                        fromBundle {
                            bundleId
                            bundleName
                        }
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

const updateCustomerAddressWithGeoLocationDocument = graphql(`
    mutation UpdateCustomerAddressWithGeoLocation {
        updateCustomerAddress(
            input: { id: "T_1", customFields: { geoLocation: { latitude: 1.23, longitude: 4.56 } } }
        ) {
            id
            customFields {
                geoLocation {
                    latitude
                    longitude
                }
            }
        }
    }
`);

const setOrderShippingAddressWithGeoLocationDocument = graphqlShop(`
    mutation SetOrderShippingAddressWithGeoLocation($input: CreateAddressInput!) {
        setOrderShippingAddress(input: $input) {
            ... on Order {
                id
                shippingAddress {
                    customFields {
                        geoLocation {
                            latitude
                            longitude
                        }
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

const getCustomerCouponsDocument = graphql(`
    query GetCustomerCoupons {
        customer(id: "T_1") {
            customFields {
                coupons {
                    code
                    discount
                    used
                }
            }
        }
    }
`);

const updateCustomerCouponsDocument = graphql(`
    mutation UpdateCustomerCoupons {
        updateCustomer(
            input: {
                id: "T_1"
                customFields: {
                    coupons: [
                        { code: "ABC", discount: 10, used: false }
                        { code: "DEF", discount: 20, used: true }
                    ]
                }
            }
        ) {
            ... on Customer {
                id
                customFields {
                    coupons {
                        code
                        discount
                        used
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

const getCustomerCompanyDocument = graphql(`
    query GetCustomerCompany {
        customer(id: "T_1") {
            id
            customFields {
                company {
                    phoneNumbers
                }
            }
        }
    }
`);

const updateCustomerCompanyDocument = graphql(`
    mutation UpdateCustomerCompany {
        updateCustomer(input: { id: "T_1", customFields: { company: { phoneNumbers: ["123", "456"] } } }) {
            ... on Customer {
                id
                customFields {
                    company {
                        phoneNumbers
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

const updateCustomerWithInvalidPatternDocument = graphql(`
    mutation UpdateCustomerWithInvalidPattern {
        updateCustomer(input: { id: "T_1", customFields: { withValidation: { stringWithPattern: "abc" } } }) {
            ... on Customer {
                id
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`);

const updateCustomerWithInvalidRangeDocument = graphql(`
    mutation UpdateCustomerWithInvalidRange {
        updateCustomer(input: { id: "T_1", customFields: { withValidation: { numberWithRange: 15 } } }) {
            ... on Customer {
                id
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`);

const updateCustomerWithInvalidValidationDocument = graphql(`
    mutation UpdateCustomerWithInvalidValidation {
        updateCustomer(
            input: { id: "T_1", customFields: { withValidation: { stringWithValidationFn: "bad" } } }
        ) {
            ... on Customer {
                id
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`);
