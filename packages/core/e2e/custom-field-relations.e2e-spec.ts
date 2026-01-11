import {
    assertFound,
    Asset,
    Collection,
    Country,
    CustomFields,
    defaultShippingCalculator,
    defaultShippingEligibilityChecker,
    Facet,
    FacetValue,
    manualFulfillmentHandler,
    mergeConfig,
    Product,
    ProductOption,
    ProductOptionGroup,
    ProductVariant,
    RequestContext,
    ShippingMethod,
    TransactionalConnection,
    Session,
    AuthenticatedSession,
    AnonymousSession
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { testSuccessfulPaymentMethod } from './fixtures/test-payment-methods';
import { TestPlugin1636_1664 } from './fixtures/test-plugins/issue-1636-1664/issue-1636-1664-plugin';
import { PluginIssue2453 } from './fixtures/test-plugins/issue-2453/plugin-issue2453';
import { TestCustomEntity, WithCustomEntity } from './fixtures/test-plugins/with-custom-entity';
import { AddItemToOrderMutationVariables } from './graphql/generated-e2e-shop-types';
import { ADD_ITEM_TO_ORDER } from './graphql/shop-definitions';
import { sortById } from './utils/test-order-utils';

const entitiesWithCustomFields: Array<keyof CustomFields> = [
    'Address',
    'Administrator',
    'Asset',
    'Channel',
    'Collection',
    'Customer',
    'CustomerGroup',
    'Facet',
    'FacetValue',
    'Fulfillment',
    'GlobalSettings',
    'Order',
    'OrderLine',
    'PaymentMethod',
    'Product',
    'ProductOption',
    'ProductOptionGroup',
    'ProductVariant',
    'Promotion',
    'Region',
    'Seller',
    'Session',
    'ShippingMethod',
    'TaxCategory',
    'TaxRate',
    'User',
    'Zone',
];

const customFieldConfig: CustomFields = {};
for (const entity of entitiesWithCustomFields) {
    customFieldConfig[entity] = [
        { name: 'primitive', type: 'string', list: false, defaultValue: 'test' },
        { name: 'single', type: 'relation', entity: Asset, graphQLType: 'Asset', list: false },
        { name: 'multi', type: 'relation', entity: Asset, graphQLType: 'Asset', list: true },
    ];
}
customFieldConfig.Product?.push(
    { name: 'cfCollection', type: 'relation', entity: Collection, list: false },
    { name: 'cfCountry', type: 'relation', entity: Country, list: false },
    { name: 'cfFacetValue', type: 'relation', entity: FacetValue, list: false },
    { name: 'cfFacet', type: 'relation', entity: Facet, list: false },
    { name: 'cfProductOptionGroup', type: 'relation', entity: ProductOptionGroup, list: false },
    { name: 'cfProductOption', type: 'relation', entity: ProductOption, list: false },
    { name: 'cfProductVariant', type: 'relation', entity: ProductVariant, list: false },
    { name: 'cfProduct', type: 'relation', entity: Product, list: false },
    { name: 'cfShippingMethod', type: 'relation', entity: ShippingMethod, list: false },
    { name: 'cfInternalAsset', type: 'relation', entity: Asset, list: false, internal: true },
);
customFieldConfig.ProductVariant?.push({
    name: 'cfRelatedProducts',
    type: 'relation',
    entity: Product,
    list: true,
    internal: false,
    public: true,
});

const customConfig = mergeConfig(testConfig(), {
    paymentOptions: {
        paymentMethodHandlers: [testSuccessfulPaymentMethod],
    },
    dbConnectionOptions: {
        timezone: 'Z',
    },
    customFields: customFieldConfig,
    plugins: [TestPlugin1636_1664, WithCustomEntity, PluginIssue2453],
});

describe('Custom field relations', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(customConfig);

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 3,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('customFieldConfig query returns entity and scalar fields', async () => {
        const { globalSettings } = await adminClient.query(gql`
            query {
                globalSettings {
                    serverConfig {
                        customFieldConfig {
                            Customer {
                                ... on RelationCustomFieldConfig {
                                    name
                                    entity
                                    scalarFields
                                }
                            }
                        }
                    }
                }
            }
        `);

        const single = globalSettings.serverConfig.customFieldConfig.Customer[1];
        expect(single.entity).toBe('Asset');
        expect(single.scalarFields).toEqual([
            'id',
            'createdAt',
            'updatedAt',
            'name',
            'type',
            'fileSize',
            'mimeType',
            'width',
            'height',
            'source',
            'preview',
        ]);
    });

    describe('special data resolution', () => {
        let productId: string;
        const productCustomFieldRelationsSelection = `
        id
        customFields {
            cfCollection {
                languageCode
                name
            }
            cfCountry {
                languageCode
                name
            }
            cfFacetValue {
                languageCode
                name
            }
            cfFacet {
                languageCode
                name
            }
            cfProductOptionGroup {
                languageCode
                name
            }
            cfProductOption {
                languageCode
                name
            }
            cfProductVariant {
                languageCode
                name
            }
            cfProduct {
                languageCode
                name
            }
            cfShippingMethod {
                languageCode
                name
            }
        }`;

        function assertTranslatableCustomFieldValues(product: { customFields: any }) {
            expect(product.customFields.cfCollection).toEqual({
                languageCode: 'en',
                name: '__root_collection__',
            });
            expect(product.customFields.cfCountry).toEqual({ languageCode: 'en', name: 'Australia' });
            expect(product.customFields.cfFacetValue).toEqual({
                languageCode: 'en',
                name: 'electronics',
            });
            expect(product.customFields.cfFacet).toEqual({ languageCode: 'en', name: 'category' });
            expect(product.customFields.cfProductOptionGroup).toEqual({
                languageCode: 'en',
                name: 'screen size',
            });
            expect(product.customFields.cfProductOption).toEqual({
                languageCode: 'en',
                name: '13 inch',
            });
            expect(product.customFields.cfProductVariant).toEqual({
                languageCode: 'en',
                name: 'Laptop 13 inch 8GB',
            });
            expect(product.customFields.cfProduct).toEqual({ languageCode: 'en', name: 'Laptop' });
            expect(product.customFields.cfShippingMethod).toEqual({
                languageCode: 'en',
                name: 'Standard Shipping',
            });
        }

        it('translatable entities get translated', async () => {
            const { createProduct } = await adminClient.query(gql`
                mutation {
                    createProduct(
                        input: {
                            translations: [
                                {
                                    languageCode: en
                                    name: "Test product"
                                    description: ""
                                    slug: "test-product"
                                }
                            ]
                            customFields: {
                                cfCollectionId: "T_1"
                                cfCountryId: "T_1"
                                cfFacetValueId: "T_1"
                                cfFacetId: "T_1"
                                cfProductOptionGroupId: "T_1"
                                cfProductOptionId: "T_1"
                                cfProductVariantId: "T_1"
                                cfProductId: "T_1"
                                cfShippingMethodId: "T_1"
                            }
                        }
                    ) { ${productCustomFieldRelationsSelection} }
                }
            `);

            productId = createProduct.id;
            assertTranslatableCustomFieldValues(createProduct);
        });

        it('translatable entities get translated on findOneInChannel', async () => {
            const { product } = await adminClient.query(gql`
                query {
                    product(id: "${productId}") { ${productCustomFieldRelationsSelection} }
                }
            `);

            assertTranslatableCustomFieldValues(product);
        });

        // https://github.com/vendurehq/vendure/issues/2453
        it('translatable eager-loaded relation works (issue 2453)', async () => {
            const { collections } = await adminClient.query(gql`
                query {
                    collections(options: { sort: { name: DESC } }) {
                        totalItems
                        items {
                            id
                            name
                            customFields {
                                campaign {
                                    name
                                    languageCode
                                }
                            }
                        }
                    }
                }
            `);

            expect(collections.totalItems).toBe(3);
            expect(collections.items.find((c: any) => c.id === 'T_3')).toEqual({
                customFields: {
                    campaign: {
                        languageCode: 'en',
                        name: 'Clearance Up to 70% Off frames',
                    },
                },
                id: 'T_3',
                name: 'children collection',
            });
        });

        it('ProductVariant prices get resolved', async () => {
            const { product } = await adminClient.query(gql`
                query {
                    product(id: "${productId}") {
                        id
                        customFields {
                            cfProductVariant {
                                price
                                currencyCode
                                priceWithTax
                            }
                        }
                    }
                }`);

            expect(product.customFields.cfProductVariant).toEqual({
                price: 129900,
                currencyCode: 'USD',
                priceWithTax: 155880,
            });
        });
    });

    it('ProductVariant without a specified property value returns null', async () => {
        const { createProduct } = await adminClient.query(gql`
            mutation {
                createProduct(
                    input: {
                        translations: [
                            {
                                languageCode: en
                                name: "Product with empty custom fields"
                                description: ""
                                slug: "product-with-empty-custom-fields"
                            }
                        ]
                    }
                ) {
                    id
                }
            }
        `);

        const { product } = await adminClient.query(gql`
            query {
                product(id: "${createProduct.id}") {
                    id
                    customFields {
                        cfProductVariant{
                            price
                            currencyCode
                            priceWithTax
                        }
                    }
                }
            }`);

        expect(product.customFields.cfProductVariant).toEqual(null);
    });

    describe('entity-specific implementation', () => {
        function assertCustomFieldIds(customFields: any, single: string, multi: string[]) {
            expect(customFields.single).toEqual({ id: single });
            expect(customFields.multi.sort(sortById)).toEqual(multi.map(id => ({ id })));
        }

        const customFieldsSelection = `
            customFields {
                primitive
                single {
                    id
                }
                multi {
                    id
                }
            }`;

        describe('Address entity', () => {
            it('admin createCustomerAddress', async () => {
                const { createCustomerAddress } = await adminClient.query(gql`
                    mutation {
                        createCustomerAddress(
                            customerId: "T_1"
                            input: {
                                countryCode: "GB"
                                streetLine1: "Test Street"
                                customFields: { singleId: "T_1", multiIds: ["T_1", "T_2"] }
                            }
                        ) {
                            id
                            ${customFieldsSelection}
                        }
                    }
                `);

                assertCustomFieldIds(createCustomerAddress.customFields, 'T_1', ['T_1', 'T_2']);
            });

            it('shop createCustomerAddress', async () => {
                await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
                const { createCustomerAddress } = await shopClient.query(gql`
                    mutation {
                        createCustomerAddress(
                            input: {
                                countryCode: "GB"
                                streetLine1: "Test Street"
                                customFields: { singleId: "T_1", multiIds: ["T_1", "T_2"] }
                            }
                        ) {
                            id
                            ${customFieldsSelection}
                        }
                    }
                `);

                assertCustomFieldIds(createCustomerAddress.customFields, 'T_1', ['T_1', 'T_2']);
            });

            it('admin updateCustomerAddress', async () => {
                const { updateCustomerAddress } = await adminClient.query(gql`
                    mutation {
                        updateCustomerAddress(
                            input: { id: "T_1", customFields: { singleId: "T_2", multiIds: ["T_3", "T_4"] } }
                        ) {
                            id
                            ${customFieldsSelection}
                        }
                    }
                `);

                assertCustomFieldIds(updateCustomerAddress.customFields, 'T_2', ['T_3', 'T_4']);
            });

            it('shop updateCustomerAddress', async () => {
                const { updateCustomerAddress } = await shopClient.query(gql`
                    mutation {
                        updateCustomerAddress(
                            input: { id: "T_1", customFields: { singleId: "T_3", multiIds: ["T_4", "T_2"] } }
                        ) {
                            id
                            ${customFieldsSelection}
                        }
                    }
                `);

                assertCustomFieldIds(updateCustomerAddress.customFields, 'T_3', ['T_2', 'T_4']);
            });
        });

        describe('Collection entity', () => {
            let collectionId: string;
            it('admin createCollection', async () => {
                const { createCollection } = await adminClient.query(gql`
                    mutation {
                        createCollection(
                            input: {
                                translations: [
                                    { languageCode: en, name: "Test", description: "test", slug: "test" }
                                ]
                                filters: []
                                customFields: { singleId: "T_1", multiIds: ["T_1", "T_2"] }
                            }
                        ) {
                            id
                            ${customFieldsSelection}
                        }
                    }
                `);
                assertCustomFieldIds(createCollection.customFields, 'T_1', ['T_1', 'T_2']);
                collectionId = createCollection.id;
            });

            it('admin updateCollection', async () => {
                const { updateCollection } = await adminClient.query(gql`
                    mutation {
                        updateCollection(
                            input: {
                                id: "${collectionId}"
                                customFields: { singleId: "T_2", multiIds: ["T_3", "T_4"] }
                            }
                        ) {
                            id
                            ${customFieldsSelection}
                        }
                    }
                `);

                assertCustomFieldIds(updateCollection.customFields, 'T_2', ['T_3', 'T_4']);
            });

            // https://github.com/vendurehq/vendure/issues/2840
            it('updating custom field relation on Collection does not delete primitive values', async () => {
                const { updateCollection } = await adminClient.query(gql`
                    mutation {
                        updateCollection(
                            input: {
                                id: "${collectionId}"
                                customFields: { singleId: "T_3" }
                            }
                        ) {
                            id
                            ${customFieldsSelection}
                        }
                    }
                `);
                expect(updateCollection.customFields.single).toEqual({ id: 'T_3' });
                expect(updateCollection.customFields.primitive).toBe('test');
            });
        });

        describe('Customer entity', () => {
            let customerId: string;
            it('admin createCustomer', async () => {
                const { createCustomer } = await adminClient.query(gql`
                    mutation {
                        createCustomer(
                            input: {
                                emailAddress: "test@test.com"
                                firstName: "Test"
                                lastName: "Person"
                                customFields: { singleId: "T_1", multiIds: ["T_1", "T_2"] }
                            }
                        ) {
                            ... on Customer {
                                id
                                ${customFieldsSelection}
                            }
                        }
                    }
                `);

                assertCustomFieldIds(createCustomer.customFields, 'T_1', ['T_1', 'T_2']);
                customerId = createCustomer.id;
            });

            it('admin updateCustomer', async () => {
                const { updateCustomer } = await adminClient.query(gql`
                    mutation {
                        updateCustomer(
                            input: {
                                id: "${customerId}"
                                customFields: { singleId: "T_2", multiIds: ["T_3", "T_4"] }
                            }
                        ) {
                            ...on Customer {
                                id
                                ${customFieldsSelection}
                            }
                        }
                    }
                `);
                assertCustomFieldIds(updateCustomer.customFields, 'T_2', ['T_3', 'T_4']);
            });

            it('shop updateCustomer', async () => {
                const { updateCustomer } = await shopClient.query(gql`
                    mutation {
                        updateCustomer(input: { customFields: { singleId: "T_4", multiIds: ["T_2", "T_4"] } }) {
                            id
                            ${customFieldsSelection}
                        }
                    }
                `);
                assertCustomFieldIds(updateCustomer.customFields, 'T_4', ['T_2', 'T_4']);
            });
        });

        describe('Facet entity', () => {
            let facetId: string;
            it('admin createFacet', async () => {
                const { createFacet } = await adminClient.query(gql`
                    mutation {
                        createFacet(
                            input: {
                                code: "test"
                                isPrivate: false
                                translations: [{ languageCode: en, name: "test" }]
                                customFields: { singleId: "T_1", multiIds: ["T_1", "T_2"] }
                            }
                        ) {
                            id
                            ${customFieldsSelection}
                        }
                    }
                `);

                assertCustomFieldIds(createFacet.customFields, 'T_1', ['T_1', 'T_2']);
                facetId = createFacet.id;
            });

            it('admin updateFacet', async () => {
                const { updateFacet } = await adminClient.query(gql`
                    mutation {
                        updateFacet(
                            input: {
                                id: "${facetId}"
                                customFields: { singleId: "T_2", multiIds: ["T_3", "T_4"] }
                            }
                        ) {
                            id
                            ${customFieldsSelection}
                        }
                    }
                `);
                assertCustomFieldIds(updateFacet.customFields, 'T_2', ['T_3', 'T_4']);
            });

            // https://github.com/vendurehq/vendure/issues/2840
            it('updating custom field relation on Facet does not delete primitive values', async () => {
                const { updateFacet } = await adminClient.query(gql`
                    mutation {
                        updateFacet(
                            input: {
                                id: "${facetId}"
                                customFields: { singleId: "T_3" }
                            }
                        ) {
                            id
                            ${customFieldsSelection}
                        }
                    }
                `);
                expect(updateFacet.customFields.single).toEqual({ id: 'T_3' });
                expect(updateFacet.customFields.primitive).toBe('test');
            });
        });

        describe('FacetValue entity', () => {
            let facetValueId: string;
            it('admin createFacetValues', async () => {
                const { createFacetValues } = await adminClient.query(gql`
                    mutation {
                        createFacetValues(
                            input: {
                                code: "test"
                                facetId: "T_1"
                                translations: [{ languageCode: en, name: "test" }]
                                customFields: { singleId: "T_1", multiIds: ["T_1", "T_2"] }
                            }
                        ) {
                            id
                            ${customFieldsSelection}
                        }
                    }
                `);

                assertCustomFieldIds(createFacetValues[0].customFields, 'T_1', ['T_1', 'T_2']);
                facetValueId = createFacetValues[0].id;
            });

            it('admin updateFacetValues', async () => {
                const { updateFacetValues } = await adminClient.query(gql`
                    mutation {
                        updateFacetValues(
                            input: {
                                id: "${facetValueId}"
                                customFields: { singleId: "T_2", multiIds: ["T_3", "T_4"] }
                            }
                        ) {
                            id
                            ${customFieldsSelection}
                        }
                    }
                `);
                assertCustomFieldIds(updateFacetValues[0].customFields, 'T_2', ['T_3', 'T_4']);
            });

            // https://github.com/vendurehq/vendure/issues/2840
            it('updating custom field relation on FacetValue does not delete primitive values', async () => {
                const { updateFacetValues } = await adminClient.query(gql`
                    mutation {
                        updateFacetValues(
                            input: {
                                id: "${facetValueId}"
                                customFields: { singleId: "T_3" }
                            }
                        ) {
                            id
                            ${customFieldsSelection}
                        }
                    }
                `);
                expect(updateFacetValues[0].customFields.single).toEqual({ id: 'T_3' });
                expect(updateFacetValues[0].customFields.primitive).toBe('test');
            });
        });

        describe('GlobalSettings entity', () => {
            it('admin updateGlobalSettings', async () => {
                const { updateGlobalSettings } = await adminClient.query(gql`
                    mutation {
                        updateGlobalSettings(
                            input: {
                                customFields: { singleId: "T_2", multiIds: ["T_3", "T_4"] }
                            }
                        ) {
                            ... on GlobalSettings {
                                id
                                ${customFieldsSelection}
                            }
                        }
                    }
                `);
                assertCustomFieldIds(updateGlobalSettings.customFields, 'T_2', ['T_3', 'T_4']);
            });
        });

        describe('Order entity', () => {
            let orderId: string;

            beforeAll(async () => {
                const { addItemToOrder } = await shopClient.query<any, AddItemToOrderMutationVariables>(
                    ADD_ITEM_TO_ORDER,
                    {
                        productVariantId: 'T_1',
                        quantity: 1,
                    },
                );

                orderId = addItemToOrder.id;
            });

            it('shop setOrderCustomFields', async () => {
                const { setOrderCustomFields } = await shopClient.query(gql`
                    mutation {
                        setOrderCustomFields(
                            input: {
                                customFields: { singleId: "T_2", multiIds: ["T_3", "T_4"] }
                            }
                        ) {
                            ... on Order {
                                id
                                ${customFieldsSelection}
                            }
                        }
                    }
                `);

                assertCustomFieldIds(setOrderCustomFields.customFields, 'T_2', ['T_3', 'T_4']);
            });

            it('admin setOrderCustomFields', async () => {
                const { setOrderCustomFields } = await adminClient.query(gql`
                    mutation {
                        setOrderCustomFields(
                            input: {
                                id: "${orderId}"
                                customFields: { singleId: "T_1", multiIds: ["T_1", "T_2"] }
                            }
                        ) {
                            ... on Order {
                                id
                                ${customFieldsSelection}
                            }
                        }
                    }
                `);

                assertCustomFieldIds(setOrderCustomFields.customFields, 'T_1', ['T_1', 'T_2']);
            });

            // https://github.com/vendurehq/vendure/issues/1664#issuecomment-1320872627
            it('admin order query with eager-loaded custom field relation', async () => {
                const { order } = await adminClient.query(gql`
                    query {
                        order(id: 1) {
                            id
                            customFields {
                                productOwner {
                                    id
                                }
                            }
                        }
                    }
                `);

                // we're just making sure it does not throw here.
                expect(order).toEqual({
                    customFields: {
                        productOwner: null,
                    },
                    id: 'T_1',
                });
            });
        });

        describe('OrderLine entity', () => {
            it('shop addItemToOrder', async () => {
                const { addItemToOrder } = await shopClient.query(
                    gql`mutation {
                        addItemToOrder(productVariantId: "T_1", quantity: 1, customFields: { singleId: "T_1", multiIds: ["T_1", "T_2"] }) {
                            ... on Order {
                                id
                                ${customFieldsSelection}
                            }
                        }
                    }`,
                );

                assertCustomFieldIds(addItemToOrder.customFields, 'T_1', ['T_1', 'T_2']);
            });
        });

        describe('Product, ProductVariant entity', () => {
            let productId: string;
            it('admin createProduct', async () => {
                const { createProduct } = await adminClient.query(gql`
                    mutation {
                        createProduct(
                            input: {
                                translations: [{ languageCode: en, name: "test" slug: "test" description: "test" }]
                                customFields: { singleId: "T_1", multiIds: ["T_1", "T_2"] }
                            }
                        ) {
                            id
                            ${customFieldsSelection}
                        }
                    }
                `);

                assertCustomFieldIds(createProduct.customFields, 'T_1', ['T_1', 'T_2']);
                productId = createProduct.id;
            });

            it('admin updateProduct', async () => {
                const { updateProduct } = await adminClient.query(gql`
                    mutation {
                        updateProduct(
                            input: {
                                id: "${productId}"
                                customFields: { singleId: "T_2", multiIds: ["T_3", "T_4"] }
                            }
                        ) {
                            id
                            ${customFieldsSelection}
                        }
                    }
                `);
                assertCustomFieldIds(updateProduct.customFields, 'T_2', ['T_3', 'T_4']);
            });

            // https://github.com/vendurehq/vendure/issues/2840
            it('updating custom field relation on Product does not delete primitive values', async () => {
                const { updateProduct } = await adminClient.query(gql`
                    mutation {
                        updateProduct(
                            input: {
                                id: "${productId}"
                                customFields: { singleId: "T_3" }
                            }
                        ) {
                            id
                            ${customFieldsSelection}
                        }
                    }
                `);
                expect(updateProduct.customFields.single).toEqual({ id: 'T_3' });
                expect(updateProduct.customFields.primitive).toBe('test');
            });

            let productVariantId: string;
            it('admin createProductVariant', async () => {
                const { createProductVariants } = await adminClient.query(gql`
                    mutation {
                        createProductVariants(
                            input: [{
                                sku: "TEST01"
                                productId: "${productId}"
                                translations: [{ languageCode: en, name: "test" }]
                                customFields: { singleId: "T_1", multiIds: ["T_1", "T_2"] }
                            }]
                        ) {
                            id
                            ${customFieldsSelection}
                        }
                    }
                `);

                assertCustomFieldIds(createProductVariants[0].customFields, 'T_1', ['T_1', 'T_2']);
                productVariantId = createProductVariants[0].id;
            });

            it('admin updateProductVariant', async () => {
                const { updateProductVariants } = await adminClient.query(gql`
                    mutation {
                        updateProductVariants(
                            input: [{
                                id: "${productVariantId}"
                                customFields: { singleId: "T_2", multiIds: ["T_3", "T_4"] }
                            }]
                        ) {
                            id
                            ${customFieldsSelection}
                        }
                    }
                `);
                assertCustomFieldIds(updateProductVariants[0].customFields, 'T_2', ['T_3', 'T_4']);
            });

            // https://github.com/vendurehq/vendure/issues/2840
            it('updating custom field relation on ProductVariant does not delete primitive values', async () => {
                const { updateProductVariants } = await adminClient.query(gql`
                    mutation {
                        updateProductVariants(
                            input: [{
                                id: "${productVariantId}"
                                customFields: { singleId: "T_3" }
                            }]
                        ) {
                            id
                            ${customFieldsSelection}
                        }
                    }
                `);
                expect(updateProductVariants[0].customFields.single).toEqual({ id: 'T_3' });
                expect(updateProductVariants[0].customFields.primitive).toBe('test');
            });

            describe('issue 1664', () => {
                // https://github.com/vendurehq/vendure/issues/1664
                it('successfully gets product by id with eager-loading custom field relation', async () => {
                    const { product } = await shopClient.query(gql`
                        query {
                            product(id: "T_1") {
                                id
                                customFields {
                                    cfVendor {
                                        featuredProduct {
                                            id
                                        }
                                    }
                                }
                            }
                        }
                    `);

                    expect(product).toBeDefined();
                });

                // https://github.com/vendurehq/vendure/issues/1664
                it('successfully gets product by id with nested eager-loading custom field relation', async () => {
                    const { customer } = await adminClient.query(gql`
                        query {
                            customer(id: "T_1") {
                                id
                                firstName
                                lastName
                                emailAddress
                                phoneNumber
                                user {
                                    customFields {
                                        cfVendor {
                                            id
                                        }
                                    }
                                }
                            }
                        }
                    `);

                    expect(customer).toBeDefined();
                });

                // https://github.com/vendurehq/vendure/issues/1664
                it('successfully gets product.variants with nested custom field relation', async () => {
                    await adminClient.query(gql`
                        mutation {
                            updateProductVariants(
                                input: [{ id: "T_1", customFields: { cfRelatedProductsIds: ["T_2"] } }]
                            ) {
                                id
                            }
                        }
                    `);

                    const { product } = await adminClient.query(gql`
                        query {
                            product(id: "T_1") {
                                variants {
                                    id
                                    customFields {
                                        cfRelatedProducts {
                                            featuredAsset {
                                                id
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    `);

                    expect(product).toBeDefined();
                    expect(product.variants[0].customFields.cfRelatedProducts).toEqual([
                        {
                            featuredAsset: { id: 'T_2' },
                        },
                    ]);
                });

                it('successfully gets product by slug with eager-loading custom field relation', async () => {
                    const { product } = await shopClient.query(gql`
                        query {
                            product(slug: "laptop") {
                                id
                                customFields {
                                    cfVendor {
                                        featuredProduct {
                                            id
                                        }
                                    }
                                }
                            }
                        }
                    `);

                    expect(product).toBeDefined();
                });

                it('does not error on custom field relation with eager custom field relation', async () => {
                    const { product } = await adminClient.query(gql`
                        query {
                            product(slug: "laptop") {
                                name
                                customFields {
                                    owner {
                                        id
                                        code
                                        customFields {
                                            profile {
                                                id
                                                name
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    `);

                    expect(product).toBeDefined();
                });
            });
        });

        describe('ProductOptionGroup, ProductOption entity', () => {
            let productOptionGroupId: string;
            it('admin createProductOptionGroup', async () => {
                const { createProductOptionGroup } = await adminClient.query(gql`
                    mutation {
                        createProductOptionGroup(
                            input: {
                                code: "test"
                                options: []
                                translations: [{ languageCode: en, name: "test" }]
                                customFields: { singleId: "T_1", multiIds: ["T_1", "T_2"] }
                            }
                        ) {
                            id
                            ${customFieldsSelection}
                        }
                    }
                `);

                assertCustomFieldIds(createProductOptionGroup.customFields, 'T_1', ['T_1', 'T_2']);
                productOptionGroupId = createProductOptionGroup.id;
            });

            it('admin updateProductOptionGroup', async () => {
                const { updateProductOptionGroup } = await adminClient.query(gql`
                    mutation {
                        updateProductOptionGroup(
                            input: {
                                id: "${productOptionGroupId}"
                                customFields: { singleId: "T_2", multiIds: ["T_3", "T_4"] }
                            }
                        ) {
                            id
                            ${customFieldsSelection}
                        }
                    }
                `);
                assertCustomFieldIds(updateProductOptionGroup.customFields, 'T_2', ['T_3', 'T_4']);
            });

            // https://github.com/vendurehq/vendure/issues/2840
            it('updating custom field relation on ProductOptionGroup does not delete primitive values', async () => {
                const { updateProductOptionGroup } = await adminClient.query(gql`
                    mutation {
                        updateProductOptionGroup(
                            input: {
                                id: "${productOptionGroupId}"
                                customFields: { singleId: "T_3" }
                            }
                        ) {
                            id
                            ${customFieldsSelection}
                        }
                    }
                `);
                expect(updateProductOptionGroup.customFields.single).toEqual({ id: 'T_3' });
                expect(updateProductOptionGroup.customFields.primitive).toBe('test');
            });

            let productOptionId: string;
            it('admin createProductOption', async () => {
                const { createProductOption } = await adminClient.query(gql`
                    mutation {
                        createProductOption(
                            input: {
                                productOptionGroupId: "${productOptionGroupId}"
                                code: "test-option"
                                translations: [{ languageCode: en, name: "test-option" }]
                                customFields: { singleId: "T_1", multiIds: ["T_1", "T_2"] }
                            }
                        ) {
                            id
                            ${customFieldsSelection}
                        }
                    }
                `);

                assertCustomFieldIds(createProductOption.customFields, 'T_1', ['T_1', 'T_2']);
                productOptionId = createProductOption.id;
            });

            it('admin updateProductOption', async () => {
                const { updateProductOption } = await adminClient.query(gql`
                    mutation {
                        updateProductOption(
                            input: {
                                id: "${productOptionId}"
                                customFields: { singleId: "T_2", multiIds: ["T_3", "T_4"] }
                            }
                        ) {
                            id
                            ${customFieldsSelection}
                        }
                    }
                `);
                assertCustomFieldIds(updateProductOption.customFields, 'T_2', ['T_3', 'T_4']);
            });

            // https://github.com/vendurehq/vendure/issues/2840
            it('updating custom field relation on ProductOption does not delete primitive values', async () => {
                const { updateProductOption } = await adminClient.query(gql`
                    mutation {
                        updateProductOption(
                            input: {
                                id: "${productOptionId}"
                                customFields: { singleId: "T_3" }
                            }
                        ) {
                            id
                            ${customFieldsSelection}
                        }
                    }
                `);
                expect(updateProductOption.customFields.single).toEqual({ id: 'T_3' });
                expect(updateProductOption.customFields.primitive).toBe('test');
            });
        });

        describe('ShippingMethod entity', () => {
            let shippingMethodId: string;
            it('admin createShippingMethod', async () => {
                const { createShippingMethod } = await adminClient.query(gql`
                    mutation {
                        createShippingMethod(
                            input: {
                                code: "test"
                                calculator: {
                                    code: "${defaultShippingCalculator.code}"
                                    arguments: [
                                        { name: "rate" value: "10"},
                                        { name: "includesTax" value: "true"},
                                        { name: "taxRate" value: "10"},
                                    ]
                                }
                                checker: {
                                    code: "${defaultShippingEligibilityChecker.code}"
                                    arguments: [
                                        { name: "orderMinimum" value: "0"},
                                    ]
                                }
                                fulfillmentHandler: "${manualFulfillmentHandler.code}"
                                translations: [{ languageCode: en, name: "test" description: "test" }]
                                customFields: { singleId: "T_1", multiIds: ["T_1", "T_2"] }
                            }
                        ) {
                            id
                            ${customFieldsSelection}
                        }
                    }
                `);

                assertCustomFieldIds(createShippingMethod.customFields, 'T_1', ['T_1', 'T_2']);
                shippingMethodId = createShippingMethod.id;
            });

            it('admin updateShippingMethod', async () => {
                const { updateShippingMethod } = await adminClient.query(gql`
                    mutation {
                        updateShippingMethod(
                            input: {
                                id: "${shippingMethodId}"
                                translations: []
                                customFields: { singleId: "T_2", multiIds: ["T_3", "T_4"] }
                            }
                        ) {
                            id
                            ${customFieldsSelection}
                        }
                    }
                `);
                assertCustomFieldIds(updateShippingMethod.customFields, 'T_2', ['T_3', 'T_4']);
            });

            // https://github.com/vendurehq/vendure/issues/2840
            it('updating custom field relation on ShippingMethod does not delete primitive values', async () => {
                const { updateShippingMethod } = await adminClient.query(gql`
                    mutation {
                        updateShippingMethod(
                            input: {
                                id: "${shippingMethodId}"
                                translations: []
                                customFields: { singleId: "T_3" }
                            }
                        ) {
                            id
                            ${customFieldsSelection}
                        }
                    }
                `);
                expect(updateShippingMethod.customFields.single).toEqual({ id: 'T_3' });
                expect(updateShippingMethod.customFields.primitive).toBe('test');
            });

            it('shop eligibleShippingMethods (ShippingMethodQuote)', async () => {
                const { eligibleShippingMethods } = await shopClient.query(gql`
                    query {
                        eligibleShippingMethods {
                            id
                            name
                            code
                            description
                            ${customFieldsSelection}
                        }
                    }
                `);
                const testShippingMethodQuote = eligibleShippingMethods.find(
                    (quote: any) => quote.code === 'test',
                );
                assertCustomFieldIds(testShippingMethodQuote.customFields, 'T_3', ['T_3', 'T_4']);
            });
        });

        describe('PaymentMethod entity', () => {
            let paymentMethodId: string;
            it('admin createShippingMethod', async () => {
                const { createPaymentMethod } = await adminClient.query(gql`
                    mutation {
                        createPaymentMethod(
                            input: {
                                code: "test"
                                enabled: true
                                handler: {
                                    code: "${testSuccessfulPaymentMethod.code}"
                                    arguments: []
                                }
                                customFields: { singleId: "T_1", multiIds: ["T_1", "T_2"] },
                                translations: [{ languageCode: en, name: "test" }]
                            }
                        ) {
                            id
                            ${customFieldsSelection}
                        }
                    }
                `);

                assertCustomFieldIds(createPaymentMethod.customFields, 'T_1', ['T_1', 'T_2']);
                paymentMethodId = createPaymentMethod.id;
            });

            it('admin updatePaymentMethod', async () => {
                const { updatePaymentMethod } = await adminClient.query(gql`
                    mutation {
                        updatePaymentMethod(
                            input: {
                                id: "${paymentMethodId}"
                                customFields: { singleId: "T_2", multiIds: ["T_3", "T_4"] },
                            }
                        ) {
                            id
                            ${customFieldsSelection}
                        }
                    }
                `);
                assertCustomFieldIds(updatePaymentMethod.customFields, 'T_2', ['T_3', 'T_4']);
            });

            // https://github.com/vendurehq/vendure/issues/2840
            it('updating custom field relation on PaymentMethod does not delete primitive values', async () => {
                const { updatePaymentMethod } = await adminClient.query(gql`
                    mutation {
                        updatePaymentMethod(
                            input: {
                                id: "${paymentMethodId}"
                                customFields: { singleId: "T_3" }
                            }
                        ) {
                            id
                            ${customFieldsSelection}
                        }
                    }
                `);
                expect(updatePaymentMethod.customFields.single).toEqual({ id: 'T_3' });
                expect(updatePaymentMethod.customFields.primitive).toBe('test');
            });

            it('shop eligiblePaymentMethods (PaymentMethodQuote)', async () => {
                const { eligiblePaymentMethods } = await shopClient.query(gql`
                    query {
                        eligiblePaymentMethods {
                            id
                            name
                            description
                            ${customFieldsSelection}
                        }
                    }
                `);
                assertCustomFieldIds(eligiblePaymentMethods[0].customFields, 'T_3', ['T_3', 'T_4']);
            });
        });

        describe('Asset entity', () => {
            it('set custom field relations on Asset', async () => {
                const { updateAsset } = await adminClient.query(gql`
                    mutation {
                        updateAsset(
                            input: {
                                id: "T_1",
                                customFields: { singleId: "T_2", multiIds: ["T_3", "T_4"] }
                            }
                        ) {
                            id
                            ${customFieldsSelection}
                        }
                    }
                `);

                assertCustomFieldIds(updateAsset.customFields, 'T_2', ['T_3', 'T_4']);
            });

            it('findOne on Asset', async () => {
                const { asset } = await adminClient.query(gql`
                    query {
                        asset(id: "T_1") {
                            id
                            ${customFieldsSelection}
                        }
                    }
                `);
                expect(asset.customFields.single.id).toBe('T_2');
                expect(asset.customFields.multi.length).toEqual(2);
            });

            // https://github.com/vendurehq/vendure/issues/1636
            it('calling TransactionalConnection.findOneInChannel() returns custom field relations', async () => {
                TestPlugin1636_1664.testResolverSpy.mockReset();
                await shopClient.query(gql`
                    query {
                        getAssetTest(id: "T_1")
                    }
                `);
                const args = TestPlugin1636_1664.testResolverSpy.mock.calls[0];
                expect(args[0].customFields.single.id).toEqual(2);
                expect(args[0].customFields.multi.length).toEqual(2);
            });
        });
    });

    it('null values', async () => {
        const { updateCustomerAddress } = await adminClient.query(gql`
            mutation {
                updateCustomerAddress(
                    input: { id: "T_1", customFields: { singleId: null, multiIds: ["T_1", "null"] } }
                ) {
                    id
                    customFields {
                        single {
                            id
                        }
                        multi {
                            id
                        }
                    }
                }
            }
        `);

        expect(updateCustomerAddress.customFields.single).toEqual(null);
        expect(updateCustomerAddress.customFields.multi).toEqual([{ id: 'T_1' }]);
    });

    describe('bi-direction relations', () => {
        let customEntityRepository: Repository<TestCustomEntity>;
        let customEntity: TestCustomEntity;
        let collectionIdInternal: number;

        beforeAll(async () => {
            customEntityRepository = server.app
                .get(TransactionalConnection)
                .getRepository(RequestContext.empty(), TestCustomEntity);

            const customEntityId = (await customEntityRepository.save({})).id;

            const { createCollection } = await adminClient.query(gql`
                    mutation {
                        createCollection(
                            input: {
                                translations: [
                                    { languageCode: en, name: "Test", description: "test", slug: "test" }
                                ]
                                filters: []
                                customFields: { customEntityListIds: [${customEntityId}] customEntityId: ${customEntityId} }
                            }
                        ) {
                            id
                        }
                    }
                `);
            collectionIdInternal = parseInt(createCollection.id.replace('T_', ''), 10);

            customEntity = await assertFound(
                customEntityRepository.findOne({
                    where: { id: customEntityId },
                    relations: {
                        customEntityInverse: true,
                        customEntityListInverse: true,
                    },
                }),
            );
        });

        it('can create inverse relation for list=false', () => {
            expect(customEntity.customEntityInverse).toEqual([
                expect.objectContaining({ id: collectionIdInternal }),
            ]);
        });

        it('can create inverse relation for list=true', () => {
            expect(customEntity.customEntityListInverse).toEqual([
                expect.objectContaining({ id: collectionIdInternal }),
            ]);
        });
    });

    it('load relations on custom field session entity', async () => {
        const connection = server.app.get(TransactionalConnection);
        const sessions = await connection.rawConnection.getRepository(AnonymousSession).find({
            relations: {
                customFields: {
                    single: true,
                },
            },
            take: 2,
        });

        // TODO: exploring behaviour how to load customFields from session, tested on Session directly and it is returning customFields, AnonymousSession and AuthenticatedSession ends in WHERE error. Necessary to check this deeper.
        console.log('sessions:');
        console.log(sessions);
    });
});
