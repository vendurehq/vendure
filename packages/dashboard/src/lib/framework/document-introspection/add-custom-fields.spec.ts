import { CustomFieldConfig, CustomFields } from '@vendure/common/lib/generated-types';
import { graphql } from 'gql.tada';
import { DocumentNode, FieldNode, FragmentDefinitionNode, Kind, print } from 'graphql';
import { beforeEach, describe, expect, it } from 'vitest';

import { addCustomFields, addCustomFieldsToFragment } from './add-custom-fields.js';

/* eslint-disable @typescript-eslint/no-non-null-assertion */
describe('addCustomFields()', () => {
    /**
     * Normalizes the indentation of a string to make it easier to compare with the expected output
     */
    function normalizeIndentation(str: string): string {
        const lines = str.replace(/    /g, '  ').split('\n');
        const indentLength = lines[1].search(/\S|$/); // Find the first non-whitespace character
        return lines
            .map(line => line.slice(indentLength))
            .join('\n')
            .trim()
            .replace(/"/g, '');
    }

    describe('Query handling', () => {
        it('Adds customFields to entity query', () => {
            const documentNode = graphql(`
                query GetProduct {
                    product {
                        id
                        name
                    }
                }
            `);
            const customFieldsConfig = new Map<string, CustomFieldConfig[]>();
            customFieldsConfig.set('Product', [
                { name: 'custom1', type: 'string', list: false },
                { name: 'custom2', type: 'boolean', list: false },
            ]);
            const result = addCustomFields(documentNode, { customFieldsMap: customFieldsConfig });

            expect(print(result)).toBe(
                normalizeIndentation(`
                query GetProduct {
                    product {
                        id
                        name
                        customFields {
                            custom1
                            custom2
                        }
                    }
                }
            `),
            );
        });

        it('Adds customFields to paginated list', () => {
            const documentNode = graphql(`
                query GetProducts {
                    products {
                        items {
                            id
                            name
                        }
                    }
                }
            `);
            const customFieldsConfig = new Map<string, CustomFieldConfig[]>();
            customFieldsConfig.set('Product', [
                { name: 'custom1', type: 'string', list: false },
                { name: 'custom2', type: 'boolean', list: false },
            ]);
            const result = addCustomFields(documentNode, { customFieldsMap: customFieldsConfig });
            expect(print(result)).toBe(
                normalizeIndentation(`
                query GetProducts {
                    products {
                        items {
                            id
                            name
                            customFields {
                                custom1
                                custom2
                            }
                        }
                    }
                }
            `),
            );
        });
    });

    describe('Fragment handling', () => {
        const productWithVariantsFragment = graphql(`
            fragment ProductWithVariants on Product {
                id
                translations {
                    languageCode
                    name
                }
            }
        `);

        const productVariantFragment = graphql(`
            fragment ProductVariant on ProductVariant {
                id
            }
        `);

        const productOptionGroupFragment = graphql(`
            fragment ProductOptionGroup on ProductOptionGroup {
                id
            }
        `);

        const productOptionFragment = graphql(`
            fragment ProductOption on ProductOption {
                id
            }
        `);

        const userFragment = graphql(`
            fragment User on User {
                id
            }
        `);

        const customerFragment = graphql(`
            fragment Customer on Customer {
                id
            }
        `);

        const addressFragment = graphql(`
            fragment Address on Address {
                id
            }
        `);

        let documentNode: DocumentNode;

        beforeEach(() => {
            documentNode = graphql(
                `
                    query GetProductWithVariants {
                        product {
                            ...ProductWithVariants
                        }
                    }
                `,
                [productWithVariantsFragment],
            );
        });

        it('Adds customFields to Product fragment', () => {
            const customFieldsConfig = new Map<string, CustomFieldConfig[]>();
            customFieldsConfig.set('Product', [
                { name: 'custom1', type: 'string', list: false },
                { name: 'custom2', type: 'boolean', list: false },
            ]);

            const result = addCustomFields(documentNode, { customFieldsMap: customFieldsConfig });
            const productFragmentDef = result.definitions[1] as FragmentDefinitionNode;
            const customFieldsDef = productFragmentDef.selectionSet.selections[2] as FieldNode;
            expect(productFragmentDef.selectionSet.selections.length).toBe(3);
            expect(customFieldsDef.selectionSet!.selections.length).toBe(2);
            expect((customFieldsDef.selectionSet!.selections[0] as FieldNode).name.value).toBe('custom1');
            expect((customFieldsDef.selectionSet!.selections[1] as FieldNode).name.value).toBe('custom2');
        });

        it('Adds customFields to Product translations', () => {
            const customFieldsConfig = new Map<string, CustomFieldConfig[]>();
            customFieldsConfig.set('Product', [
                { name: 'customLocaleString', type: 'localeString', list: false },
            ]);

            const result = addCustomFields(documentNode, { customFieldsMap: customFieldsConfig });
            const productFragmentDef = result.definitions[1] as FragmentDefinitionNode;
            const translationsField = productFragmentDef.selectionSet.selections[1] as FieldNode;
            const customTranslationFieldsDef = translationsField.selectionSet!.selections[2] as FieldNode;
            expect(translationsField.selectionSet!.selections.length).toBe(3);
            expect((customTranslationFieldsDef.selectionSet!.selections[0] as FieldNode).name.value).toBe(
                'customLocaleString',
            );
        });

        function addsCustomFieldsToType(type: keyof CustomFields, fragment: DocumentNode) {
            const customFieldsConfig = new Map<string, CustomFieldConfig[]>();
            customFieldsConfig.set(type, [{ name: 'custom', type: 'boolean', list: false }]);

            const result = addCustomFields(fragment, { customFieldsMap: customFieldsConfig });
            const fragmentDef = result.definitions[0] as FragmentDefinitionNode;
            const customFieldsDef = fragmentDef.selectionSet.selections[1] as FieldNode;
            expect(fragmentDef.selectionSet.selections.length).toBe(2);
            expect(customFieldsDef.selectionSet!.selections.length).toBe(1);
            expect((customFieldsDef.selectionSet!.selections[0] as FieldNode).name.value).toBe('custom');
        }

        it('Does not duplicate customFields selection set', () => {
            const customFieldsConfig = new Map<string, CustomFieldConfig[]>();
            customFieldsConfig.set('Product', [{ name: 'custom', type: 'boolean', list: false }]);
            const result1 = addCustomFields(documentNode, { customFieldsMap: customFieldsConfig });
            const result2 = addCustomFields(result1, { customFieldsMap: customFieldsConfig });

            const fragmentDef = result2.definitions[1] as FragmentDefinitionNode;
            const customFieldSelections = fragmentDef.selectionSet.selections.filter(
                s => s.kind === Kind.FIELD && s.name.value === 'customFields',
            );
            expect(customFieldSelections.length).toBe(1);
        });

        it('Adds customFields to ProductVariant fragment', () => {
            addsCustomFieldsToType('ProductVariant', productVariantFragment);
        });

        it('Adds customFields to ProductOptionGroup fragment', () => {
            addsCustomFieldsToType('ProductOptionGroup', productOptionGroupFragment);
        });

        it('Adds customFields to ProductOption fragment', () => {
            addsCustomFieldsToType('ProductOption', productOptionFragment);
        });

        it('Adds customFields to User fragment', () => {
            addsCustomFieldsToType('User', userFragment);
        });

        it('Adds customFields to Customer fragment', () => {
            addsCustomFieldsToType('Customer', customerFragment);
        });

        it('Adds customFields to Address fragment', () => {
            addsCustomFieldsToType('Address', addressFragment);
        });
    });

    describe('Nested entity handling', () => {
        it('User example: Should not add custom fields to Asset fragment used in nested featuredAsset', () => {
            const assetFragment = graphql(`
                fragment Asset on Asset {
                    id
                    createdAt
                    updatedAt
                    name
                    fileSize
                    mimeType
                    type
                    preview
                    source
                    width
                    height
                    focalPoint {
                        x
                        y
                    }
                }
            `);

            const documentNode = graphql(
                `
                    query CollectionList($options: CollectionListOptions) {
                        collections(options: $options) {
                            items {
                                id
                                createdAt
                                updatedAt
                                featuredAsset {
                                    ...Asset
                                }
                                name
                                slug
                                breadcrumbs {
                                    id
                                    name
                                    slug
                                }
                                children {
                                    id
                                    name
                                }
                                position
                                isPrivate
                                parentId
                                productVariants {
                                    totalItems
                                }
                            }
                            totalItems
                        }
                    }
                `,
                [assetFragment],
            );

            const customFieldsConfig = new Map<string, CustomFieldConfig[]>();
            customFieldsConfig.set('Collection', [
                { name: 'featuredProducts', type: 'relation', list: true, scalarFields: ['id', 'name'] },
                { name: 'alternativeAsset', type: 'relation', list: false, scalarFields: ['id', 'name'] },
            ]);
            customFieldsConfig.set('Asset', [
                { name: 'assetCustomField1', type: 'string', list: false },
                { name: 'assetCustomField2', type: 'string', list: false },
                { name: 'assetCustomField3', type: 'string', list: false },
            ]);

            const result = addCustomFields(documentNode, { customFieldsMap: customFieldsConfig });
            const printed = print(result);

            // Should add customFields ONLY to Collection items (top-level entity)
            expect(printed).toContain('customFields {');
            expect(printed).toContain('featuredProducts {');
            expect(printed).toContain('alternativeAsset {');

            // Should NOT add customFields to Asset fragment (only used in nested context)
            const fragmentMatch = printed.match(/fragment Asset on Asset\s*\{[^}]*\}/s);
            expect(fragmentMatch).toBeTruthy();
            expect(fragmentMatch![0]).not.toContain('customFields');
            expect(fragmentMatch![0]).not.toContain('assetCustomField1');

            // Should NOT add customFields to children (nested Collection entities)
            const childrenMatch = printed.match(/children\s*\{[^}]+\}/s);
            expect(childrenMatch).toBeTruthy();
            expect(childrenMatch![0]).not.toContain('customFields');

            // Should NOT add customFields to breadcrumbs
            const breadcrumbsMatch = printed.match(/breadcrumbs\s*\{[^}]+\}/s);
            expect(breadcrumbsMatch).toBeTruthy();
            expect(breadcrumbsMatch![0]).not.toContain('customFields');
        });

        it('Should only add custom fields to top-level entity, not nested related entities', () => {
            const documentNode = graphql(`
                query CollectionList($options: CollectionListOptions) {
                    collections(options: $options) {
                        items {
                            id
                            name
                            slug
                            featuredAsset {
                                id
                                preview
                            }
                            children {
                                id
                                name
                                slug
                            }
                            breadcrumbs {
                                id
                                name
                                slug
                            }
                        }
                        totalItems
                    }
                }
            `);

            const customFieldsConfig = new Map<string, CustomFieldConfig[]>();
            customFieldsConfig.set('Collection', [
                { name: 'featuredProducts', type: 'relation', list: true, scalarFields: ['id', 'name'] },
                { name: 'alternativeAsset', type: 'relation', list: false, scalarFields: ['id', 'name'] },
            ]);
            customFieldsConfig.set('Asset', [
                { name: 'assetCustomField1', type: 'string', list: false },
                { name: 'assetCustomField2', type: 'string', list: false },
            ]);

            const result = addCustomFields(documentNode, { customFieldsMap: customFieldsConfig });
            const printed = print(result);

            // Should add customFields to top-level Collection (items)
            expect(printed).toContain('customFields {');
            expect(printed).toContain('featuredProducts {');
            expect(printed).toContain('alternativeAsset {');

            // Should NOT add customFields to nested Collection entities (children, breadcrumbs)
            const childrenMatch = printed.match(/children\s*\{[^}]+\}/s);
            const breadcrumbsMatch = printed.match(/breadcrumbs\s*\{[^}]+\}/s);

            expect(childrenMatch).toBeTruthy();
            expect(breadcrumbsMatch).toBeTruthy();
            expect(childrenMatch![0]).not.toContain('customFields');
            expect(breadcrumbsMatch![0]).not.toContain('customFields');

            // Should NOT add customFields to nested Asset entity (featuredAsset)
            const featuredAssetMatch = printed.match(/featuredAsset\s*\{[^}]+\}/s);
            expect(featuredAssetMatch).toBeTruthy();
            expect(featuredAssetMatch![0]).not.toContain('customFields');
            expect(featuredAssetMatch![0]).not.toContain('assetCustomField1');
        });

        it('Should NOT add custom fields to fragments that are only used in nested contexts', () => {
            const assetFragment = graphql(`
                fragment Asset on Asset {
                    id
                    name
                    preview
                }
            `);

            const documentNode = graphql(
                `
                    query ProductList($options: ProductListOptions) {
                        products(options: $options) {
                            items {
                                id
                                name
                                featuredAsset {
                                    ...Asset
                                }
                                variants {
                                    id
                                    name
                                    assets {
                                        ...Asset
                                    }
                                }
                            }
                            totalItems
                        }
                    }
                `,
                [assetFragment],
            );

            const customFieldsConfig = new Map<string, CustomFieldConfig[]>();
            customFieldsConfig.set('Product', [{ name: 'productCustomField', type: 'string', list: false }]);
            customFieldsConfig.set('Asset', [{ name: 'assetCustomField', type: 'string', list: false }]);
            customFieldsConfig.set('ProductVariant', [
                { name: 'variantCustomField', type: 'string', list: false },
            ]);

            const result = addCustomFields(documentNode, { customFieldsMap: customFieldsConfig });
            const printed = print(result);

            // Should add customFields to Product (top-level query entity)
            expect(printed).toContain('customFields {');
            expect(printed).toContain('productCustomField');

            // Should NOT add customFields to Asset fragment (only used in nested contexts)
            expect(printed).not.toMatch(/fragment Asset on Asset\s*\{[^}]*customFields/s);

            // Should NOT add customFields to nested ProductVariant entities
            const variantsMatch = printed.match(/variants\s*\{[^}]+\}/s);
            expect(variantsMatch).toBeTruthy();
            expect(variantsMatch![0]).not.toContain('customFields');
            expect(variantsMatch![0]).not.toContain('variantCustomField');
        });

        it('Should add custom fields to fragments used at top level', () => {
            const productFragment = graphql(`
                fragment ProductDetails on Product {
                    id
                    name
                    slug
                }
            `);

            const documentNode = graphql(
                `
                    query ProductList($options: ProductListOptions) {
                        products(options: $options) {
                            items {
                                ...ProductDetails
                                featuredAsset {
                                    id
                                    preview
                                }
                            }
                            totalItems
                        }
                    }
                `,
                [productFragment],
            );

            const customFieldsConfig = new Map<string, CustomFieldConfig[]>();
            customFieldsConfig.set('Product', [{ name: 'productCustomField', type: 'string', list: false }]);
            customFieldsConfig.set('Asset', [{ name: 'assetCustomField', type: 'string', list: false }]);

            const result = addCustomFields(documentNode, { customFieldsMap: customFieldsConfig });
            const printed = print(result);

            // Should add customFields to ProductDetails fragment (used at top level in items)
            expect(printed).toContain('fragment ProductDetails on Product');
            expect(printed).toContain('productCustomField');

            // Should NOT add customFields to featuredAsset (nested entity)
            const featuredAssetMatch = printed.match(/featuredAsset\s*\{[^}]+\}/s);
            expect(featuredAssetMatch).toBeTruthy();
            expect(featuredAssetMatch![0]).not.toContain('customFields');
        });

        it('Should handle complex nested structure with multiple entity types', () => {
            const documentNode = graphql(`
                query ComplexQuery {
                    orders {
                        items {
                            id
                            code
                            customer {
                                id
                                firstName
                                addresses {
                                    id
                                    streetLine1
                                    country {
                                        id
                                        name
                                    }
                                }
                            }
                            lines {
                                id
                                productVariant {
                                    id
                                    name
                                    product {
                                        id
                                        name
                                    }
                                }
                            }
                        }
                    }
                }
            `);

            const customFieldsConfig = new Map<string, CustomFieldConfig[]>();
            customFieldsConfig.set('Order', [{ name: 'orderCustomField', type: 'string', list: false }]);
            customFieldsConfig.set('Customer', [
                { name: 'customerCustomField', type: 'string', list: false },
            ]);
            customFieldsConfig.set('Address', [{ name: 'addressCustomField', type: 'string', list: false }]);
            customFieldsConfig.set('Product', [{ name: 'productCustomField', type: 'string', list: false }]);

            const result = addCustomFields(documentNode, { customFieldsMap: customFieldsConfig });
            const printed = print(result);

            // Should only add customFields to top-level Order entity
            expect(printed).toContain('customFields {');
            expect(printed).toContain('orderCustomField');

            // Should NOT add customFields to any nested entities
            expect(printed).not.toMatch(/customer\s*\{[^}]*customFields/s);
            expect(printed).not.toMatch(/addresses\s*\{[^}]*customFields/s);
            expect(printed).not.toMatch(/country\s*\{[^}]*customFields/s);
            expect(printed).not.toMatch(/productVariant\s*\{[^}]*customFields/s);
            expect(printed).not.toMatch(/product\s*\{[^}]*customFields/s);
        });
    });

    describe('includeNestedFragments option', () => {
        it('Should add custom fields to nested fragments when explicitly included', () => {
            const assetFragment = graphql(`
                fragment Asset on Asset {
                    id
                    preview
                }
            `);

            const documentNode = graphql(
                `
                    query ProductList($options: ProductListOptions) {
                        products(options: $options) {
                            items {
                                id
                                name
                                featuredAsset {
                                    ...Asset
                                }
                            }
                        }
                    }
                `,
                [assetFragment],
            );

            const customFieldsConfig = new Map<string, CustomFieldConfig[]>();
            customFieldsConfig.set('Product', [{ name: 'productCustomField', type: 'string', list: false }]);
            customFieldsConfig.set('Asset', [{ name: 'assetCustomField', type: 'string', list: false }]);

            const result = addCustomFields(documentNode, {
                customFieldsMap: customFieldsConfig,
                includeNestedFragments: ['Asset'], // Explicitly include the nested Asset fragment
            });
            const printed = print(result);

            // Should add customFields to Product (top-level)
            expect(printed).toContain('productCustomField');

            // Should ALSO add customFields to Asset (nested, but explicitly included)
            expect(printed).toContain('fragment Asset on Asset');
            expect(printed).toContain('assetCustomField');
        });

        it('Should handle multiple nested fragments in includeNestedFragments', () => {
            const assetFragment = graphql(`
                fragment Asset on Asset {
                    id
                    preview
                }
            `);

            const orderLineFragment = graphql(`
                fragment OrderLine on OrderLine {
                    id
                    quantity
                }
            `);

            const documentNode = graphql(
                `
                    query GetOrder($id: ID!) {
                        order(id: $id) {
                            id
                            code
                            lines {
                                ...OrderLine
                            }
                            featuredAsset {
                                ...Asset
                            }
                        }
                    }
                `,
                [orderLineFragment, assetFragment],
            );

            const customFieldsConfig = new Map<string, CustomFieldConfig[]>();
            customFieldsConfig.set('Order', [{ name: 'orderCustomField', type: 'string', list: false }]);
            customFieldsConfig.set('OrderLine', [
                { name: 'orderLineCustomField', type: 'string', list: false },
            ]);
            customFieldsConfig.set('Asset', [{ name: 'assetCustomField', type: 'string', list: false }]);

            const result = addCustomFields(documentNode, {
                customFieldsMap: customFieldsConfig,
                includeNestedFragments: ['OrderLine', 'Asset'], // Include both nested fragments
            });
            const printed = print(result);

            // Should add customFields to all three
            expect(printed).toContain('orderCustomField');
            expect(printed).toContain('orderLineCustomField');
            expect(printed).toContain('assetCustomField');
        });

        it('Should only add custom fields to specified nested fragments, not all nested fragments', () => {
            const assetFragment = graphql(`
                fragment Asset on Asset {
                    id
                    preview
                }
            `);

            const orderLineFragment = graphql(`
                fragment OrderLine on OrderLine {
                    id
                    quantity
                }
            `);

            const documentNode = graphql(
                `
                    query GetOrder($id: ID!) {
                        order(id: $id) {
                            id
                            lines {
                                ...OrderLine
                            }
                            featuredAsset {
                                ...Asset
                            }
                        }
                    }
                `,
                [orderLineFragment, assetFragment],
            );

            const customFieldsConfig = new Map<string, CustomFieldConfig[]>();
            customFieldsConfig.set('Order', [{ name: 'orderCustomField', type: 'string', list: false }]);
            customFieldsConfig.set('OrderLine', [
                { name: 'orderLineCustomField', type: 'string', list: false },
            ]);
            customFieldsConfig.set('Asset', [{ name: 'assetCustomField', type: 'string', list: false }]);

            const result = addCustomFields(documentNode, {
                customFieldsMap: customFieldsConfig,
                includeNestedFragments: ['OrderLine'], // Only include OrderLine, not Asset
            });
            const printed = print(result);

            // Should add customFields to Order (top-level) and OrderLine (explicitly included)
            expect(printed).toContain('orderCustomField');
            expect(printed).toContain('orderLineCustomField');

            // Should NOT add customFields to Asset (nested and not included)
            expect(printed).not.toContain('assetCustomField');
        });

        it('Should add custom fields to Address fragment nested in customer detail query via includeNestedFragments', () => {
            const addressFragment = graphql(`
                fragment Address on Address {
                    id
                    fullName
                    company
                    streetLine1
                    streetLine2
                    city
                    province
                    postalCode
                    phoneNumber
                    defaultShippingAddress
                    defaultBillingAddress
                }
            `);

            const documentNode = graphql(
                `
                    query GetCustomerDetail($id: ID!) {
                        customer(id: $id) {
                            id
                            firstName
                            lastName
                            addresses {
                                ...Address
                            }
                            customFields
                        }
                    }
                `,
                [addressFragment],
            );

            const customFieldsConfig = new Map<string, CustomFieldConfig[]>();
            customFieldsConfig.set('Customer', [
                { name: 'customerCustomField', type: 'string', list: false },
            ]);
            customFieldsConfig.set('Address', [
                { name: 'registrationNumber', type: 'string', list: false },
                { name: 'vatNumber', type: 'string', list: false },
            ]);

            const result = addCustomFields(documentNode, {
                customFieldsMap: customFieldsConfig,
                includeNestedFragments: ['Address'],
            });
            const printed = print(result);

            // Should add customFields to Customer (top-level)
            expect(printed).toContain('customerCustomField');

            // Should also add customFields to Address (nested, but explicitly included)
            expect(printed).toContain('registrationNumber');
            expect(printed).toContain('vatNumber');
        });

        it('Works with the timing issue - called later when globalCustomFieldsMap is populated', () => {
            const orderLineFragment = graphql(`
                fragment OrderLine on OrderLine {
                    id
                    quantity
                }
            `);

            const orderDetailFragment = graphql(
                `
                    fragment OrderDetail on Order {
                        id
                        code
                        lines {
                            ...OrderLine
                        }
                    }
                `,
                [orderLineFragment],
            );

            const orderDetailDocument = graphql(
                `
                    query GetOrder($id: ID!) {
                        order(id: $id) {
                            ...OrderDetail
                        }
                    }
                `,
                [orderDetailFragment],
            );

            // Initially, globalCustomFieldsMap is empty (simulating module load time)
            const customFieldsConfig = new Map<string, CustomFieldConfig[]>();
            // Documents are created...

            // Later, when server config is loaded and custom fields are available
            customFieldsConfig.set('Order', [{ name: 'orderCustomField', type: 'string', list: false }]);
            customFieldsConfig.set('OrderLine', [
                { name: 'orderLineCustomField', type: 'string', list: false },
            ]);

            // Now when addCustomFields is called (e.g., in a component), it has access to custom fields
            const result = addCustomFields(orderDetailDocument, {
                customFieldsMap: customFieldsConfig,
                includeNestedFragments: ['OrderLine'], // Explicitly include nested OrderLine fragment
            });
            const printed = print(result);

            // Should add customFields to both Order and OrderLine
            expect(printed).toContain('orderCustomField');
            expect(printed).toContain('orderLineCustomField');
        });
    });

    describe('Empty custom fields handling', () => {
        // https://github.com/vendurehq/vendure/issues/4650
        // When all custom fields have ui.dashboard: false, the server returns an empty array
        // for that entity. The dashboard should remove the bare `customFields` field from the
        // query to avoid a GraphQL error ("must have a selection of subfields").
        it('Should remove bare customFields field when entity has no custom fields in the map', () => {
            const documentNode = graphql(`
                query GetOrder($id: ID!) {
                    order(id: $id) {
                        id
                        code
                        customFields
                    }
                }
            `);

            // Simulate: Order entity exists in the map but with no custom fields
            // (all were filtered out due to ui.dashboard: false)
            const customFieldsConfig = new Map<string, CustomFieldConfig[]>();
            customFieldsConfig.set('Order', []);

            const result = addCustomFields(documentNode, {
                customFieldsMap: customFieldsConfig,
            });
            const printed = print(result);

            // customFields should be removed entirely to avoid the empty selection set error
            expect(printed).not.toContain('customFields');
            expect(printed).toContain('id');
            expect(printed).toContain('code');
        });

        // https://github.com/vendurehq/vendure/issues/4650
        it('Should remove bare customFields field when entity has no custom fields in the map at all', () => {
            const documentNode = graphql(`
                query GetOrder($id: ID!) {
                    order(id: $id) {
                        id
                        code
                        customFields
                    }
                }
            `);

            // Simulate: Order entity is not in the map at all
            const customFieldsConfig = new Map<string, CustomFieldConfig[]>();

            const result = addCustomFields(documentNode, {
                customFieldsMap: customFieldsConfig,
            });
            const printed = print(result);

            // customFields should be removed entirely
            expect(printed).not.toContain('customFields');
        });
    });
});

describe('addCustomFieldsToFragment()', () => {
    /**
     * Normalizes the indentation of a string to make it easier to compare with the expected output
     */
    function normalizeIndentation(str: string): string {
        const lines = str.replace(/    /g, '  ').split('\n');
        const indentLength = lines[1].search(/\S|$/); // Find the first non-whitespace character
        return lines
            .map(line => line.slice(indentLength))
            .join('\n')
            .trim()
            .replace(/"/g, '');
    }

    describe('Basic functionality', () => {
        it('Adds customFields to a simple fragment', () => {
            const fragmentDocument = graphql(`
                fragment Product on Product {
                    id
                    name
                }
            `);
            const customFieldsConfig = new Map<string, CustomFieldConfig[]>();
            customFieldsConfig.set('Product', [
                { name: 'custom1', type: 'string', list: false },
                { name: 'custom2', type: 'boolean', list: false },
            ]);

            const result = addCustomFieldsToFragment(fragmentDocument, {
                customFieldsMap: customFieldsConfig,
            });

            expect(print(result)).toBe(
                normalizeIndentation(`
                fragment Product on Product {
                    id
                    name
                    customFields {
                        custom1
                        custom2
                    }
                }
            `),
            );
        });

        it('Adds customFields with includeCustomFields filter', () => {
            const fragmentDocument = graphql(`
                fragment Product on Product {
                    id
                    name
                }
            `);
            const customFieldsConfig = new Map<string, CustomFieldConfig[]>();
            customFieldsConfig.set('Product', [
                { name: 'custom1', type: 'string', list: false },
                { name: 'custom2', type: 'boolean', list: false },
                { name: 'custom3', type: 'int', list: false },
            ]);

            const result = addCustomFieldsToFragment(fragmentDocument, {
                customFieldsMap: customFieldsConfig,
                includeCustomFields: ['custom1', 'custom3'],
            });

            expect(print(result)).toBe(
                normalizeIndentation(`
                fragment Product on Product {
                    id
                    name
                    customFields {
                        custom1
                        custom3
                    }
                }
            `),
            );
        });

        it('Handles fragment with no custom fields configured', () => {
            const fragmentDocument = graphql(`
                fragment Product on Product {
                    id
                    name
                }
            `);
            const customFieldsConfig = new Map<string, CustomFieldConfig[]>();

            const result = addCustomFieldsToFragment(fragmentDocument, {
                customFieldsMap: customFieldsConfig,
            });

            // Should return the fragment unchanged
            expect(print(result)).toBe(
                normalizeIndentation(`
                fragment Product on Product {
                    id
                    name
                }
            `),
            );
        });

        // https://github.com/vendurehq/vendure/issues/4650
        it('Removes bare customFields from fragment when entity has empty custom fields array', () => {
            const fragmentDocument = graphql(`
                fragment Order on Order {
                    id
                    code
                    customFields
                }
            `);
            const customFieldsConfig = new Map<string, CustomFieldConfig[]>();
            customFieldsConfig.set('Order', []);

            const result = addCustomFieldsToFragment(fragmentDocument, {
                customFieldsMap: customFieldsConfig,
            });

            expect(print(result)).toBe(
                normalizeIndentation(`
                fragment Order on Order {
                    id
                    code
                }
            `),
            );
        });

        // https://github.com/vendurehq/vendure/issues/4650
        it('Removes bare customFields from fragment when entity is not in custom fields map', () => {
            const fragmentDocument = graphql(`
                fragment Order on Order {
                    id
                    code
                    customFields
                }
            `);
            const customFieldsConfig = new Map<string, CustomFieldConfig[]>();

            const result = addCustomFieldsToFragment(fragmentDocument, {
                customFieldsMap: customFieldsConfig,
            });

            expect(print(result)).toBe(
                normalizeIndentation(`
                fragment Order on Order {
                    id
                    code
                }
            `),
            );
        });
    });

    describe('Validation', () => {
        it('Throws error when given a query document', () => {
            const documentNode = graphql(`
                query GetProduct {
                    product {
                        id
                        name
                    }
                }
            `);
            const customFieldsConfig = new Map<string, CustomFieldConfig[]>();
            customFieldsConfig.set('Product', [{ name: 'custom', type: 'string', list: false }]);

            expect(() =>
                addCustomFieldsToFragment(documentNode, { customFieldsMap: customFieldsConfig }),
            ).toThrow('expects a fragment-only document');
        });

        it('Only modifies the first fragment when multiple fragments are present', () => {
            const productFragment = graphql(`
                fragment Product on Product {
                    id
                }
            `);
            const variantFragment = graphql(`
                fragment Variant on ProductVariant {
                    id
                }
            `);

            // Create a document with both fragments (Product first, then Variant)
            const multiFragmentDoc = {
                kind: Kind.DOCUMENT,
                definitions: [...productFragment.definitions, ...variantFragment.definitions],
            } as DocumentNode;

            const customFieldsConfig = new Map<string, CustomFieldConfig[]>();
            customFieldsConfig.set('Product', [{ name: 'productCustom', type: 'string', list: false }]);
            customFieldsConfig.set('ProductVariant', [
                { name: 'variantCustom', type: 'string', list: false },
            ]);

            const result = addCustomFieldsToFragment(multiFragmentDoc, {
                customFieldsMap: customFieldsConfig,
            });
            const printed = print(result);

            // Should add customFields to Product (first fragment)
            expect(printed).toContain('fragment Product on Product');
            expect(printed).toContain('productCustom');

            // Should NOT add customFields to Variant (dependency fragment)
            expect(printed).toContain('fragment Variant on ProductVariant');
            expect(printed).not.toContain('variantCustom');
        });

        it('Throws error when given an empty document', () => {
            const emptyDoc = {
                kind: Kind.DOCUMENT,
                definitions: [],
            } as DocumentNode;

            const customFieldsConfig = new Map<string, CustomFieldConfig[]>();

            expect(() =>
                addCustomFieldsToFragment(emptyDoc, { customFieldsMap: customFieldsConfig }),
            ).toThrow('expects a document with at least one fragment definition');
        });
    });

    describe('Advanced field types', () => {
        it('Handles relation custom fields', () => {
            const fragmentDocument = graphql(`
                fragment Product on Product {
                    id
                    name
                }
            `);
            const customFieldsConfig = new Map<string, CustomFieldConfig[]>();
            customFieldsConfig.set('Product', [
                {
                    name: 'relatedProduct',
                    type: 'relation',
                    list: false,
                    scalarFields: ['id', 'name', 'slug'],
                },
            ]);

            const result = addCustomFieldsToFragment(fragmentDocument, {
                customFieldsMap: customFieldsConfig,
            });

            expect(print(result)).toBe(
                normalizeIndentation(`
                fragment Product on Product {
                    id
                    name
                    customFields {
                        relatedProduct {
                            id
                            name
                            slug
                        }
                    }
                }
            `),
            );
        });

        it('Handles struct custom fields', () => {
            const fragmentDocument = graphql(`
                fragment Product on Product {
                    id
                    name
                }
            `);
            const customFieldsConfig = new Map<string, CustomFieldConfig[]>();
            customFieldsConfig.set('Product', [
                {
                    name: 'dimensions',
                    type: 'struct',
                    list: false,
                    fields: [
                        { name: 'width', type: 'int' },
                        { name: 'height', type: 'int' },
                        { name: 'depth', type: 'int' },
                    ],
                },
            ]);

            const result = addCustomFieldsToFragment(fragmentDocument, {
                customFieldsMap: customFieldsConfig,
            });

            expect(print(result)).toBe(
                normalizeIndentation(`
                fragment Product on Product {
                    id
                    name
                    customFields {
                        dimensions {
                            width
                            height
                            depth
                        }
                    }
                }
            `),
            );
        });

        it('Handles localized custom fields in translations', () => {
            const fragmentDocument = graphql(`
                fragment Product on Product {
                    id
                    translations {
                        languageCode
                        name
                    }
                }
            `);
            const customFieldsConfig = new Map<string, CustomFieldConfig[]>();
            customFieldsConfig.set('Product', [
                { name: 'customDescription', type: 'localeString', list: false },
                { name: 'customSeoTitle', type: 'localeText', list: false },
            ]);

            const result = addCustomFieldsToFragment(fragmentDocument, {
                customFieldsMap: customFieldsConfig,
            });

            const printed = print(result);
            // Should add localized fields to translations
            expect(printed).toContain('translations {');
            expect(printed).toMatch(/translations\s*\{[^}]*customFields/s);

            const fragmentDef = result.definitions[0] as FragmentDefinitionNode;
            const translationsField = fragmentDef.selectionSet.selections.find(
                s => s.kind === Kind.FIELD && s.name.value === 'translations',
            ) as FieldNode;
            const customFieldsInTranslations = translationsField.selectionSet!.selections.find(
                s => s.kind === Kind.FIELD && s.name.value === 'customFields',
            ) as FieldNode;

            expect(customFieldsInTranslations).toBeTruthy();
            expect(customFieldsInTranslations.selectionSet!.selections.length).toBe(2);
        });
    });

    describe('Special type handling', () => {
        it('Handles OrderAddress as alias of Address', () => {
            const fragmentDocument = graphql(`
                fragment OrderAddress on OrderAddress {
                    id
                    streetLine1
                }
            `);
            const customFieldsConfig = new Map<string, CustomFieldConfig[]>();
            // Custom fields are configured for Address, not OrderAddress
            customFieldsConfig.set('Address', [{ name: 'buildingNumber', type: 'string', list: false }]);

            const result = addCustomFieldsToFragment(fragmentDocument, {
                customFieldsMap: customFieldsConfig,
            });

            // Should still add custom fields because OrderAddress is aliased to Address
            expect(print(result)).toContain('customFields {');
            expect(print(result)).toContain('buildingNumber');
        });

        it('Handles Country as alias of Region', () => {
            const fragmentDocument = graphql(`
                fragment Country on Country {
                    id
                    name
                }
            `);
            const customFieldsConfig = new Map<string, CustomFieldConfig[]>();
            // Custom fields are configured for Region, not Country
            customFieldsConfig.set('Region', [{ name: 'regionCode', type: 'string', list: false }]);

            const result = addCustomFieldsToFragment(fragmentDocument, {
                customFieldsMap: customFieldsConfig,
            });

            // Should still add custom fields because Country is aliased to Region
            expect(print(result)).toContain('customFields {');
            expect(print(result)).toContain('regionCode');
        });
    });

    describe('Memoization', () => {
        it('Returns the same instance for the same inputs', () => {
            const fragmentDocument = graphql(`
                fragment Product on Product {
                    id
                    name
                }
            `);
            const customFieldsConfig = new Map<string, CustomFieldConfig[]>();
            customFieldsConfig.set('Product', [{ name: 'custom', type: 'string', list: false }]);

            const result1 = addCustomFieldsToFragment(fragmentDocument, {
                customFieldsMap: customFieldsConfig,
            });
            const result2 = addCustomFieldsToFragment(fragmentDocument, {
                customFieldsMap: customFieldsConfig,
            });

            // Should return the exact same instance (identity equality)
            expect(result1).toBe(result2);
        });

        it('Returns different instances for different options', () => {
            const fragmentDocument = graphql(`
                fragment Product on Product {
                    id
                    name
                }
            `);
            const customFieldsConfig = new Map<string, CustomFieldConfig[]>();
            customFieldsConfig.set('Product', [
                { name: 'custom1', type: 'string', list: false },
                { name: 'custom2', type: 'boolean', list: false },
            ]);

            const result1 = addCustomFieldsToFragment(fragmentDocument, {
                customFieldsMap: customFieldsConfig,
                includeCustomFields: ['custom1'],
            });
            const result2 = addCustomFieldsToFragment(fragmentDocument, {
                customFieldsMap: customFieldsConfig,
                includeCustomFields: ['custom2'],
            });

            // Should return different instances for different options
            expect(result1).not.toBe(result2);
            expect(print(result1)).toContain('custom1');
            expect(print(result1)).not.toContain('custom2');
            expect(print(result2)).toContain('custom2');
            expect(print(result2)).not.toContain('custom1');
        });
    });

    describe('Fragment spreads handling', () => {
        it('Should only add custom fields to the top-level fragment, not to referenced fragments', () => {
            const orderLineFragment = graphql(`
                fragment OrderLine on OrderLine {
                    id
                    quantity
                }
            `);

            const orderDetailFragment = graphql(
                `
                    fragment OrderDetail on Order {
                        id
                        code
                        lines {
                            ...OrderLine
                        }
                    }
                `,
                [orderLineFragment],
            );

            const customFieldsConfig = new Map<string, CustomFieldConfig[]>();
            customFieldsConfig.set('Order', [{ name: 'orderCustomField', type: 'string', list: false }]);
            customFieldsConfig.set('OrderLine', [
                { name: 'orderLineCustomField', type: 'string', list: false },
            ]);

            // Apply to the OrderDetail fragment only
            const result = addCustomFieldsToFragment(orderDetailFragment, {
                customFieldsMap: customFieldsConfig,
            });

            const printed = print(result);

            // Should add customFields to OrderDetail (top-level fragment)
            expect(printed).toContain('fragment OrderDetail on Order');
            expect(printed).toContain('orderCustomField');

            // Should include the OrderLine fragment definition (dependency) but NOT add customFields to it
            expect(printed).toContain('...OrderLine');
            expect(printed).toContain('fragment OrderLine on OrderLine');
            expect(printed).not.toContain('orderLineCustomField');
        });

        it('Should work with deeply nested fragment spreads', () => {
            const assetFragment = graphql(`
                fragment Asset on Asset {
                    id
                    preview
                }
            `);

            const orderLineFragment = graphql(
                `
                    fragment OrderLine on OrderLine {
                        id
                        quantity
                        featuredAsset {
                            ...Asset
                        }
                    }
                `,
                [assetFragment],
            );

            const orderDetailFragment = graphql(
                `
                    fragment OrderDetail on Order {
                        id
                        code
                        lines {
                            ...OrderLine
                        }
                    }
                `,
                [orderLineFragment],
            );

            const customFieldsConfig = new Map<string, CustomFieldConfig[]>();
            customFieldsConfig.set('Order', [{ name: 'orderCustomField', type: 'string', list: false }]);
            customFieldsConfig.set('OrderLine', [
                { name: 'orderLineCustomField', type: 'string', list: false },
            ]);
            customFieldsConfig.set('Asset', [{ name: 'assetCustomField', type: 'string', list: false }]);

            const result = addCustomFieldsToFragment(orderDetailFragment, {
                customFieldsMap: customFieldsConfig,
            });

            const printed = print(result);

            // Should ONLY add customFields to OrderDetail
            expect(printed).toContain('orderCustomField');
            expect(printed).not.toContain('orderLineCustomField');
            expect(printed).not.toContain('assetCustomField');

            // Should still contain the fragment definitions (dependencies) but without custom fields
            expect(printed).toContain('...OrderLine');
            expect(printed).toContain('fragment OrderLine on OrderLine');
            expect(printed).toContain('fragment Asset on Asset');
        });
    });

    describe('Composability with addCustomFields()', () => {
        it('Can be used inline in graphql() dependency array (like the original pattern)', () => {
            const productFragment = graphql(`
                fragment Product on Product {
                    id
                    name
                }
            `);

            const customFieldsConfig = new Map<string, CustomFieldConfig[]>();
            customFieldsConfig.set('Product', [
                { name: 'custom1', type: 'string', list: false },
                { name: 'custom2', type: 'boolean', list: false },
            ]);

            // Use addCustomFieldsToFragment directly in the array - this is the pattern from orders.graphql.ts
            const queryDocument = graphql(
                `
                    query GetProduct {
                        product {
                            ...Product
                        }
                    }
                `,
                [addCustomFieldsToFragment(productFragment, { customFieldsMap: customFieldsConfig })],
            );

            // The query should include the modified fragment with custom fields
            const printed = print(queryDocument);
            expect(printed).toContain('customFields {');
            expect(printed).toContain('custom1');
            expect(printed).toContain('custom2');
        });

        it('addCustomFieldsToFragment produces same result as addCustomFields for single fragments', () => {
            const productFragment = graphql(`
                fragment Product on Product {
                    id
                    name
                }
            `);

            const customFieldsConfig = new Map<string, CustomFieldConfig[]>();
            customFieldsConfig.set('Product', [
                { name: 'custom1', type: 'string', list: false },
                { name: 'custom2', type: 'boolean', list: false },
            ]);

            const resultFromFragment = addCustomFieldsToFragment(productFragment, {
                customFieldsMap: customFieldsConfig,
            });
            const resultFromFull = addCustomFields(productFragment, { customFieldsMap: customFieldsConfig });

            // Both should produce the same output
            expect(print(resultFromFragment)).toBe(print(resultFromFull));
        });

        it('Works with fragments that have dependencies when used inline', () => {
            const orderLineFragment = graphql(`
                fragment OrderLine on OrderLine {
                    id
                    quantity
                }
            `);

            const orderDetailFragment = graphql(
                `
                    fragment OrderDetail on Order {
                        id
                        code
                        lines {
                            ...OrderLine
                        }
                    }
                `,
                [orderLineFragment],
            );

            const customFieldsConfig = new Map<string, CustomFieldConfig[]>();
            customFieldsConfig.set('Order', [{ name: 'orderCustomField', type: 'string', list: false }]);
            customFieldsConfig.set('OrderLine', [
                { name: 'orderLineCustomField', type: 'string', list: false },
            ]);

            // This is exactly the pattern used in orders.graphql.ts
            const queryDocument = graphql(
                `
                    query GetOrder($id: ID!) {
                        order(id: $id) {
                            ...OrderDetail
                        }
                    }
                `,
                [addCustomFieldsToFragment(orderDetailFragment, { customFieldsMap: customFieldsConfig })],
            );

            const printed = print(queryDocument);

            // Should add custom fields to OrderDetail
            expect(printed).toContain('fragment OrderDetail on Order');
            expect(printed).toContain('orderCustomField');

            // Should NOT add custom fields to OrderLine (dependency)
            expect(printed).toContain('fragment OrderLine on OrderLine');
            expect(printed).not.toContain('orderLineCustomField');

            // Verify the query structure is correct
            expect(printed).toContain('query GetOrder');
            expect(printed).toContain('order(id: $id)');
            expect(printed).toContain('...OrderDetail');
        });

        it('Can be used to compose fragments in query documents', () => {
            const productFragment = graphql(`
                fragment Product on Product {
                    id
                    name
                }
            `);

            const customFieldsConfig = new Map<string, CustomFieldConfig[]>();
            customFieldsConfig.set('Product', [
                { name: 'custom1', type: 'string', list: false },
                { name: 'custom2', type: 'boolean', list: false },
            ]);

            // Use addCustomFieldsToFragment to modify the fragment
            const modifiedFragment = addCustomFieldsToFragment(productFragment, {
                customFieldsMap: customFieldsConfig,
            });

            // Then compose it into a query
            const queryDocument = graphql(
                `
                    query GetProduct {
                        product {
                            ...Product
                        }
                    }
                `,
                [modifiedFragment],
            );

            // The query should include the modified fragment with custom fields
            const printed = print(queryDocument);
            expect(printed).toContain('customFields {');
            expect(printed).toContain('custom1');
            expect(printed).toContain('custom2');
        });

        it('Can selectively modify different fragments with different custom fields', () => {
            const productFragment = graphql(`
                fragment Product on Product {
                    id
                    name
                }
            `);

            const variantFragment = graphql(`
                fragment Variant on ProductVariant {
                    id
                    sku
                }
            `);

            const customFieldsConfig = new Map<string, CustomFieldConfig[]>();
            customFieldsConfig.set('Product', [
                { name: 'productCustom1', type: 'string', list: false },
                { name: 'productCustom2', type: 'boolean', list: false },
            ]);
            customFieldsConfig.set('ProductVariant', [
                { name: 'variantCustom1', type: 'string', list: false },
            ]);

            // Selectively modify each fragment with different custom fields
            const modifiedProductFragment = addCustomFieldsToFragment(productFragment, {
                customFieldsMap: customFieldsConfig,
                includeCustomFields: ['productCustom1'], // Only include productCustom1
            });

            const modifiedVariantFragment = addCustomFieldsToFragment(variantFragment, {
                customFieldsMap: customFieldsConfig,
                includeCustomFields: ['variantCustom1'],
            });

            // Compose into a query
            const queryDocument = graphql(
                `
                    query GetProductWithVariants {
                        product {
                            ...Product
                            variants {
                                ...Variant
                            }
                        }
                    }
                `,
                [modifiedProductFragment, modifiedVariantFragment],
            );

            const printed = print(queryDocument);
            // Product fragment should have only productCustom1
            expect(printed).toContain('productCustom1');
            expect(printed).not.toContain('productCustom2');
            // Variant fragment should have variantCustom1
            expect(printed).toContain('variantCustom1');
        });
    });
});
