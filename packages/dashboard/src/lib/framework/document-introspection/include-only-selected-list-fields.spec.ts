import { DocumentNode, parse, print } from 'graphql';
import { describe, expect, it, vi } from 'vitest';

import { includeOnlySelectedListFields } from './include-only-selected-list-fields.js';

vi.mock('virtual:admin-api-schema', () => {
    return import('./testing-utils.js').then(m => m.getMockSchemaInfo());
});

describe('includeOnlySelectedListFields', () => {
    const createTestDocument = (itemsFields: string): DocumentNode => {
        return parse(`
            query ProductList($options: ProductListOptions) {
                products(options: $options) {
                    items {
                        ${itemsFields}
                    }
                    totalItems
                }
            }
        `);
    };

    const normalizeQuery = (query: string): string => {
        // Remove extra whitespace and normalize for comparison
        return query.replace(/\s+/g, ' ').trim();
    };

    describe('basic field selection', () => {
        it('should return original document when no columns are selected', () => {
            const document = createTestDocument('id name slug');
            const result = includeOnlySelectedListFields(document, []);

            expect(print(result)).toEqual(print(document));
        });

        it('should filter to only selected fields', () => {
            const document = createTestDocument(`
                id
                name
                slug
                enabled
                createdAt
                updatedAt
            `);

            const result = includeOnlySelectedListFields(document, [
                { name: 'id', isCustomField: false },
                { name: 'name', isCustomField: false },
            ]);

            const resultQuery = normalizeQuery(print(result));
            expect(resultQuery).toContain('items { id name }');
            expect(resultQuery).not.toContain('slug');
            expect(resultQuery).not.toContain('enabled');
            expect(resultQuery).not.toContain('createdAt');
            expect(resultQuery).not.toContain('updatedAt');
        });

        it('should handle single field selection', () => {
            const document = createTestDocument(`
                id
                name
                slug
                enabled
            `);

            const result = includeOnlySelectedListFields(document, [{ name: 'name', isCustomField: false }]);

            const resultQuery = normalizeQuery(print(result));
            expect(resultQuery).toContain('items { name }');
            expect(resultQuery).not.toContain('slug');
            expect(resultQuery).not.toContain('enabled');
        });

        it('should preserve nested field structures', () => {
            const document = createTestDocument(`
                id
                name
                featuredAsset {
                    id
                    preview
                    source
                }
                slug
            `);

            const result = includeOnlySelectedListFields(document, [
                { name: 'id', isCustomField: false },
                { name: 'featuredAsset', isCustomField: false },
            ]);

            const resultQuery = normalizeQuery(print(result));
            expect(resultQuery).toContain('items { id featuredAsset { id preview source } }');
            expect(resultQuery).not.toContain('name');
            expect(resultQuery).not.toContain('slug');
        });

        it('should preserve __typename if present in original', () => {
            const document = createTestDocument(`
                __typename
                id
                name
                slug
            `);

            const result = includeOnlySelectedListFields(document, [{ name: 'name', isCustomField: false }]);

            const resultQuery = normalizeQuery(print(result));
            expect(resultQuery).toContain('__typename');
            expect(resultQuery).toContain('name');
            expect(resultQuery).not.toContain('slug');
        });
    });

    describe('custom fields handling', () => {
        it('should include custom fields when specified', () => {
            const document = createTestDocument(`
                id
                name
                customFields {
                    shortDescription
                    isEcoFriendly
                    warrantyMonths
                }
            `);

            const result = includeOnlySelectedListFields(document, [
                { name: 'id', isCustomField: false },
                { name: 'shortDescription', isCustomField: true },
                { name: 'isEcoFriendly', isCustomField: true },
            ]);

            const resultQuery = normalizeQuery(print(result));
            expect(resultQuery).toContain('items { id customFields { shortDescription isEcoFriendly } }');
            expect(resultQuery).not.toContain('warrantyMonths');
            expect(resultQuery).not.toContain('name');
        });

        it('should exclude customFields entirely if no custom fields are selected', () => {
            const document = createTestDocument(`
                id
                name
                customFields {
                    shortDescription
                    isEcoFriendly
                }
            `);

            const result = includeOnlySelectedListFields(document, [
                { name: 'id', isCustomField: false },
                { name: 'name', isCustomField: false },
            ]);

            const resultQuery = normalizeQuery(print(result));
            expect(resultQuery).toContain('items { id name }');
            expect(resultQuery).not.toContain('customFields');
        });

        it('should handle mixed regular and custom field selection', () => {
            const document = createTestDocument(`
                id
                name
                slug
                enabled
                customFields {
                    shortDescription
                    warrantyMonths
                    isEcoFriendly
                }
            `);

            const result = includeOnlySelectedListFields(document, [
                { name: 'name', isCustomField: false },
                { name: 'enabled', isCustomField: false },
                { name: 'shortDescription', isCustomField: true },
            ]);

            const resultQuery = normalizeQuery(print(result));
            expect(resultQuery).toContain('name');
            expect(resultQuery).toContain('enabled');
            expect(resultQuery).toContain('customFields { shortDescription }');
            expect(resultQuery).not.toContain('warrantyMonths');
            expect(resultQuery).not.toContain('isEcoFriendly');
            expect(resultQuery).not.toContain('slug');
        });
    });

    describe('fragment handling', () => {
        it('should preserve inline fragments', () => {
            const document = parse(`
                query ProductList($options: ProductListOptions) {
                    products(options: $options) {
                        items {
                            id
                            name
                            ... on Product {
                                slug
                                description
                            }
                        }
                        totalItems
                    }
                }
            `);

            const result = includeOnlySelectedListFields(document, [
                { name: 'id', isCustomField: false },
                { name: 'name', isCustomField: false },
            ]);

            const resultQuery = normalizeQuery(print(result));
            expect(resultQuery).toContain('... on Product');
        });

        it('should preserve fragment spreads when they contain selected fields', () => {
            const document = parse(`
                query ProductList($options: ProductListOptions) {
                    products(options: $options) {
                        items {
                            id
                            ...ProductFields
                        }
                        totalItems
                    }
                }

                fragment ProductFields on Product {
                    name
                    slug
                    enabled
                }
            `);

            const result = includeOnlySelectedListFields(document, [
                { name: 'id', isCustomField: false },
                { name: 'name', isCustomField: false },
            ]);

            const resultQuery = normalizeQuery(print(result));
            expect(resultQuery).toContain('...ProductFields');
            expect(resultQuery).toContain('fragment ProductFields');
            expect(resultQuery).toContain(' name');
            // Fragment should be filtered to only include selected fields
            expect(resultQuery).not.toContain('slug');
            expect(resultQuery).not.toContain('enabled');
        });
    });

    describe('edge cases', () => {
        it('should add id field if no fields selected to maintain valid query', () => {
            const document = createTestDocument(`
                id
                name
                slug
            `);

            // Select a field that doesn't exist in the document
            const result = includeOnlySelectedListFields(document, [
                { name: 'nonExistentField', isCustomField: false },
            ]);

            const resultQuery = normalizeQuery(print(result));
            expect(resultQuery).toContain('items { id }');
            expect(resultQuery).not.toContain('name');
            expect(resultQuery).not.toContain('slug');
        });

        it('should handle document without items selectionSet', () => {
            const document = parse(`
                query ProductList($options: ProductListOptions) {
                    products(options: $options) {
                        items
                        totalItems
                    }
                }
            `);

            const result = includeOnlySelectedListFields(document, [
                { name: 'id', isCustomField: false },
                { name: 'name', isCustomField: false },
            ]);

            const resultQuery = normalizeQuery(print(result));
            expect(resultQuery).toContain('items');
            expect(resultQuery).toContain('totalItems');
        });

        it('should handle multiple queries in document', () => {
            const document = parse(`
                query ProductList($options: ProductListOptions) {
                    products(options: $options) {
                        items {
                            id
                            name
                            slug
                        }
                        totalItems
                    }
                }

                query ProductCount {
                    products {
                        totalItems
                    }
                }
            `);

            const result = includeOnlySelectedListFields(document, [{ name: 'id', isCustomField: false }]);

            // Should only modify the first query's items field
            const resultQuery = normalizeQuery(print(result));
            expect(resultQuery).toContain('query ProductList');
            expect(resultQuery).toContain('query ProductCount');
        });

        it('should handle deeply nested structures', () => {
            const document = createTestDocument(`
                id
                name
                slug
                variants {
                    id
                    name
                    options {
                        id
                        code
                        name
                    }
                }
            `);

            const result = includeOnlySelectedListFields(document, [
                { name: 'id', isCustomField: false },
                { name: 'variants', isCustomField: false },
            ]);

            const resultQuery = normalizeQuery(print(result));
            expect(resultQuery).toContain('variants');
            expect(resultQuery).toContain('options');
            // The nested name fields within variants are preserved, but root level name and slug should not be
            expect(resultQuery).not.toContain('slug');
            // Check that the structure is preserved correctly
            expect(resultQuery).toContain('variants { id name options');
        });

        it('should preserve totalItems and other pagination fields', () => {
            const document = parse(`
                query ProductList($options: ProductListOptions) {
                    products(options: $options) {
                        items {
                            id
                            name
                            slug
                        }
                        totalItems
                        hasNextPage
                        hasPreviousPage
                    }
                }
            `);

            const result = includeOnlySelectedListFields(document, [{ name: 'id', isCustomField: false }]);

            const resultQuery = normalizeQuery(print(result));
            expect(resultQuery).toContain('totalItems');
            expect(resultQuery).toContain('hasNextPage');
            expect(resultQuery).toContain('hasPreviousPage');
            expect(resultQuery).toContain('items { id }');
            expect(resultQuery).not.toContain('name');
            expect(resultQuery).not.toContain('slug');
        });

        it('should handle empty customFields selection gracefully', () => {
            const document = createTestDocument(`
                id
                name
                customFields {
                    field1
                    field2
                }
            `);

            const result = includeOnlySelectedListFields(document, [
                { name: 'id', isCustomField: false },
                { name: 'nonExistentCustomField', isCustomField: true },
            ]);

            const resultQuery = normalizeQuery(print(result));
            expect(resultQuery).toContain('items { id }');
            expect(resultQuery).not.toContain('customFields');
            expect(resultQuery).not.toContain('name');
        });

        it('should handle queries with aliases', () => {
            const document = parse(`
                query ProductList($options: ProductListOptions) {
                    allProducts: products(options: $options) {
                        items {
                            productId: id
                            productName: name
                            slug
                        }
                        totalItems
                    }
                }
            `);

            const result = includeOnlySelectedListFields(document, [
                { name: 'id', isCustomField: false },
                { name: 'name', isCustomField: false },
            ]);

            const resultQuery = normalizeQuery(print(result));
            // Note: aliases make this more complex - the function looks at field names
            expect(resultQuery).toContain('productId: id');
            expect(resultQuery).toContain('productName: name');
            expect(resultQuery).not.toContain('slug');
        });
    });

    describe('fragment-based items selection', () => {
        it('should handle items defined in fragments - user example case', () => {
            const document = parse(`
                query FacetList($options: FacetListOptions, $facetValueListOptions: FacetValueListOptions) {
                    facets(options: $options) {
                        items {
                            ...FacetWithValueList
                        }
                        totalItems
                    }
                }

                fragment FacetWithValueList on Facet {
                    id
                    createdAt
                    updatedAt
                    name
                    code
                    isPrivate
                    valueList(options: $facetValueListOptions) {
                        totalItems
                        items {
                            ...FacetValue
                        }
                    }
                }

                fragment FacetValue on FacetValue {
                    id
                    createdAt
                    updatedAt
                    languageCode
                    code
                    name
                    translations {
                        id
                        languageCode
                        name
                    }
                    facet {
                        id
                        createdAt
                        updatedAt
                        name
                        code
                    }
                }
            `);

            const result = includeOnlySelectedListFields(document, [
                { name: 'id', isCustomField: false },
                { name: 'name', isCustomField: false },
                { name: 'code', isCustomField: false },
            ]);

            const resultQuery = normalizeQuery(print(result));

            // Should include selected fields
            expect(resultQuery).toContain('...FacetWithValueList');
            expect(resultQuery).toContain('fragment FacetWithValueList');

            // Fragment should be filtered to only include selected fields
            expect(resultQuery).toContain('id');
            expect(resultQuery).toContain(' name');
            expect(resultQuery).toContain(' code');

            // Should exclude non-selected fields from fragment
            expect(resultQuery).not.toContain('createdAt');
            expect(resultQuery).not.toContain('updatedAt');
            expect(resultQuery).not.toContain('isPrivate');
            expect(resultQuery).not.toContain('valueList');

            // Should remove unused FacetValue fragment
            expect(resultQuery).not.toContain('fragment FacetValue');
            expect(resultQuery).not.toContain('...FacetValue');
        });

        it('should handle nested fragments in items fragments', () => {
            const document = parse(`
                query ProductList($options: ProductListOptions) {
                    products(options: $options) {
                        items {
                            ...ProductWithAssets
                        }
                        totalItems
                    }
                }

                fragment ProductWithAssets on Product {
                    id
                    name
                    slug
                    featuredAsset {
                        ...AssetInfo
                    }
                    assets {
                        ...AssetInfo
                    }
                }

                fragment AssetInfo on Asset {
                    id
                    name
                    preview
                    source
                    width
                    height
                }
            `);

            const result = includeOnlySelectedListFields(document, [
                { name: 'name', isCustomField: false },
                { name: 'featuredAsset', isCustomField: false },
            ]);

            const resultQuery = normalizeQuery(print(result));

            // Should include selected fields
            expect(resultQuery).toContain('...ProductWithAssets');
            expect(resultQuery).toContain('fragment ProductWithAssets');

            // Should include used nested fragments
            expect(resultQuery).toContain('fragment AssetInfo');
            expect(resultQuery).toContain('...AssetInfo');

            // Fragment should be filtered
            expect(resultQuery).toContain(' name');
            expect(resultQuery).toContain('featuredAsset');

            // Should exclude non-selected fields
            expect(resultQuery).not.toContain('slug');
            expect(resultQuery).not.toContain('assets');
        });

        it('should handle mixed direct fields and fragment spreads in items', () => {
            const document = parse(`
                query ProductList($options: ProductListOptions) {
                    products(options: $options) {
                        items {
                            id
                            enabled
                            ...ProductCore
                            customFields {
                                shortDescription
                                warrantyMonths
                            }
                        }
                        totalItems
                    }
                }

                fragment ProductCore on Product {
                    name
                    slug
                    description
                    featuredAsset {
                        id
                        preview
                    }
                }
            `);

            const result = includeOnlySelectedListFields(document, [
                { name: 'id', isCustomField: false },
                { name: 'name', isCustomField: false },
                { name: 'featuredAsset', isCustomField: false },
                { name: 'shortDescription', isCustomField: true },
            ]);

            const resultQuery = normalizeQuery(print(result));

            // Should include direct fields
            expect(resultQuery).toContain('id');

            // Should include fragment with filtered content
            expect(resultQuery).toContain('...ProductCore');
            expect(resultQuery).toContain('fragment ProductCore');
            expect(resultQuery).toContain(' name');
            expect(resultQuery).toContain('featuredAsset');

            // Should include filtered custom fields
            expect(resultQuery).toContain('customFields { shortDescription }');

            // Should exclude non-selected fields
            expect(resultQuery).not.toContain('enabled');
            expect(resultQuery).not.toContain('slug');
            expect(resultQuery).not.toContain('description');
            expect(resultQuery).not.toContain('warrantyMonths');
        });

        it('should handle items with only fragment spreads', () => {
            const document = parse(`
                query CustomerList($options: CustomerListOptions) {
                    customers(options: $options) {
                        items {
                            ...CustomerBasic
                            ...CustomerContact
                        }
                        totalItems
                    }
                }

                fragment CustomerBasic on Customer {
                    id
                    title
                    firstName
                    lastName
                    emailAddress
                }

                fragment CustomerContact on Customer {
                    phoneNumber
                    addresses {
                        id
                        streetLine1
                        city
                        country {
                            code
                            name
                        }
                    }
                }
            `);

            const result = includeOnlySelectedListFields(document, [
                { name: 'firstName', isCustomField: false },
                { name: 'lastName', isCustomField: false },
                { name: 'emailAddress', isCustomField: false },
            ]);

            const resultQuery = normalizeQuery(print(result));

            // Should include fragment with selected fields
            expect(resultQuery).toContain('...CustomerBasic');
            expect(resultQuery).toContain('fragment CustomerBasic');
            expect(resultQuery).toContain('firstName');
            expect(resultQuery).toContain('lastName');
            expect(resultQuery).toContain('emailAddress');

            // Should exclude unused fragment
            expect(resultQuery).not.toContain('...CustomerContact');
            expect(resultQuery).not.toContain('fragment CustomerContact');

            // Should exclude non-selected fields from used fragment
            expect(resultQuery).not.toContain('title');
            expect(resultQuery).not.toContain('phoneNumber');
            expect(resultQuery).not.toContain('addresses');
        });

        it('should handle deeply nested fragment spreads in items', () => {
            const document = parse(`
                query ProductList($options: ProductListOptions) {
                    products(options: $options) {
                        items {
                            ...ProductWithVariants
                        }
                        totalItems
                    }
                }

                fragment ProductWithVariants on Product {
                    id
                    name
                    variants {
                        id
                        name
                        options {
                            ...ProductOptionDetail
                        }
                    }
                }

                fragment ProductOptionDetail on ProductOption {
                    id
                    code
                    name
                    group {
                        id
                        name
                        code
                    }
                }
            `);

            const result = includeOnlySelectedListFields(document, [
                { name: 'name', isCustomField: false },
                { name: 'variants', isCustomField: false },
            ]);

            const resultQuery = normalizeQuery(print(result));

            // Should include main fragment
            expect(resultQuery).toContain('...ProductWithVariants');
            expect(resultQuery).toContain('fragment ProductWithVariants');

            // Should include nested structures
            expect(resultQuery).toContain(' name');
            expect(resultQuery).toContain('variants');
            expect(resultQuery).toContain('options');

            // Should include nested fragment
            expect(resultQuery).toContain('fragment ProductOptionDetail');
            expect(resultQuery).toContain('...ProductOptionDetail');
        });

        it('should handle fragment spreads with custom fields in items', () => {
            const document = parse(`
                query ProductList($options: ProductListOptions) {
                    products(options: $options) {
                        items {
                            ...ProductWithCustomFields
                        }
                        totalItems
                    }
                }

                fragment ProductWithCustomFields on Product {
                    id
                    name
                    slug
                    customFields {
                        shortDescription
                        warrantyMonths
                        isEcoFriendly
                        featuredCollection {
                            id
                            name
                        }
                    }
                }
            `);

            const result = includeOnlySelectedListFields(document, [
                { name: 'name', isCustomField: false },
                { name: 'shortDescription', isCustomField: true },
                { name: 'isEcoFriendly', isCustomField: true },
            ]);

            const resultQuery = normalizeQuery(print(result));

            // Should include fragment
            expect(resultQuery).toContain('...ProductWithCustomFields');
            expect(resultQuery).toContain('fragment ProductWithCustomFields');

            // Should include selected regular field
            expect(resultQuery).toContain(' name');

            // Should include filtered custom fields
            expect(resultQuery).toContain('customFields { shortDescription isEcoFriendly }');

            // Should exclude non-selected fields
            expect(resultQuery).not.toContain('slug');
            expect(resultQuery).not.toContain('warrantyMonths');
            expect(resultQuery).not.toContain('featuredCollection');
        });

        it('should only filter top-level items fragments, not nested fragments - user issue case', () => {
            const document = parse(`
                query FacetList($options: FacetListOptions, $facetValueListOptions: FacetValueListOptions) {
                    facets(options: $options) {
                        items {
                            ...FacetWithValueList
                        }
                        totalItems
                    }
                }

                fragment FacetWithValueList on Facet {
                    id
                    name
                    isPrivate
                    valueList(options: $facetValueListOptions) {
                        totalItems
                        items {
                            ...FacetValue
                        }
                    }
                }

                fragment FacetValue on FacetValue {
                    id
                    name
                    code
                    translations {
                        name
                        languageCode
                    }
                }
            `);

            const result = includeOnlySelectedListFields(document, [{ name: 'name', isCustomField: false }]);

            const resultQuery = normalizeQuery(print(result));

            // Should include the top-level fragment
            expect(resultQuery).toContain('...FacetWithValueList');
            expect(resultQuery).toContain('fragment FacetWithValueList');

            // Top-level fragment should be filtered (only name, no isPrivate)
            expect(resultQuery).toContain(' name');
            expect(resultQuery).not.toContain('isPrivate');
            expect(resultQuery).not.toContain('valueList'); // This should be filtered out

            // Should NOT include the nested FacetValue fragment since valueList was removed
            expect(resultQuery).not.toContain('fragment FacetValue');
            expect(resultQuery).not.toContain('...FacetValue');
        });

        it('should preserve nested fragments when their parent field is selected', () => {
            const document = parse(`
                query FacetList($options: FacetListOptions, $facetValueListOptions: FacetValueListOptions) {
                    facets(options: $options) {
                        items {
                            ...FacetWithValueList
                        }
                        totalItems
                    }
                }

                fragment FacetWithValueList on Facet {
                    id
                    name
                    isPrivate
                    valueList(options: $facetValueListOptions) {
                        totalItems
                        items {
                            ...FacetValue
                        }
                    }
                }

                fragment FacetValue on FacetValue {
                    id
                    name
                    code
                    translations {
                        name
                        languageCode
                    }
                }
            `);

            const result = includeOnlySelectedListFields(document, [
                { name: 'name', isCustomField: false },
                { name: 'valueList', isCustomField: false },
            ]);

            const resultQuery = normalizeQuery(print(result));

            // Should include the top-level fragment
            expect(resultQuery).toContain('...FacetWithValueList');
            expect(resultQuery).toContain('fragment FacetWithValueList');

            // Top-level fragment should be filtered to include name and valueList
            expect(resultQuery).toContain(' name');
            expect(resultQuery).toContain('valueList');
            expect(resultQuery).not.toContain('isPrivate');

            // Should include the nested FacetValue fragment UNCHANGED since it's not a top-level items fragment
            expect(resultQuery).toContain('fragment FacetValue');
            expect(resultQuery).toContain('...FacetValue');
            expect(resultQuery).toContain(' code'); // This should be preserved in the nested fragment
            expect(resultQuery).toContain('translations'); // This should be preserved in the nested fragment
        });
    });

    describe('unused fragment removal', () => {
        it('should remove unused fragments when fields using them are filtered out', () => {
            const document = parse(`
                query ProductVariantList($options: ProductVariantListOptions) {
                    productVariants(options: $options) {
                        items {
                            id
                            price
                            priceWithTax
                            featuredAsset {
                                ...Asset
                            }
                        }
                        totalItems
                    }
                }

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

            // Select only price fields, excluding featuredAsset
            const result = includeOnlySelectedListFields(document, [
                { name: 'price', isCustomField: false },
                { name: 'priceWithTax', isCustomField: false },
            ]);

            const resultQuery = normalizeQuery(print(result));

            // Should include selected fields
            expect(resultQuery).toContain('price');
            expect(resultQuery).toContain('priceWithTax');

            // Should exclude featuredAsset field
            expect(resultQuery).not.toContain('featuredAsset');

            // Should remove unused Asset fragment
            expect(resultQuery).not.toContain('fragment Asset');
            expect(resultQuery).not.toContain('...Asset');
        });

        it('should keep used fragments when fields using them are selected', () => {
            const document = parse(`
                query ProductVariantList($options: ProductVariantListOptions) {
                    productVariants(options: $options) {
                        items {
                            id
                            price
                            featuredAsset {
                                ...Asset
                            }
                        }
                        totalItems
                    }
                }

                fragment Asset on Asset {
                    id
                    name
                    preview
                    source
                }
            `);

            // Select fields including featuredAsset
            const result = includeOnlySelectedListFields(document, [
                { name: 'price', isCustomField: false },
                { name: 'featuredAsset', isCustomField: false },
            ]);

            const resultQuery = normalizeQuery(print(result));

            // Should include selected fields
            expect(resultQuery).toContain('price');
            expect(resultQuery).toContain('featuredAsset');

            // Should keep used Asset fragment
            expect(resultQuery).toContain('fragment Asset');
            expect(resultQuery).toContain('...Asset');
        });

        it('should handle nested fragment dependencies', () => {
            const document = parse(`
                query ProductList($options: ProductListOptions) {
                    products(options: $options) {
                        items {
                            id
                            name
                            featuredAsset {
                                ...AssetWithMetadata
                            }
                        }
                        totalItems
                    }
                }

                fragment AssetWithMetadata on Asset {
                    ...AssetCore
                    metadata {
                        key
                        value
                    }
                }

                fragment AssetCore on Asset {
                    id
                    name
                    preview
                    source
                }
            `);

            // Select only name, excluding featuredAsset
            const result = includeOnlySelectedListFields(document, [{ name: 'name', isCustomField: false }]);

            const resultQuery = normalizeQuery(print(result));

            // Should include selected field
            expect(resultQuery).toContain(' name');

            // Should exclude featuredAsset field
            expect(resultQuery).not.toContain('featuredAsset');

            // Should remove all unused fragments
            expect(resultQuery).not.toContain('fragment AssetWithMetadata');
            expect(resultQuery).not.toContain('fragment AssetCore');
            expect(resultQuery).not.toContain('...AssetWithMetadata');
            expect(resultQuery).not.toContain('...AssetCore');
        });

        it('should keep transitive fragment dependencies when parent fragment is used', () => {
            const document = parse(`
                query ProductList($options: ProductListOptions) {
                    products(options: $options) {
                        items {
                            id
                            name
                            featuredAsset {
                                ...AssetWithMetadata
                            }
                        }
                        totalItems
                    }
                }

                fragment AssetWithMetadata on Asset {
                    ...AssetCore
                    metadata {
                        key
                        value
                    }
                }

                fragment AssetCore on Asset {
                    id
                    name
                    preview
                    source
                }
            `);

            // Select featuredAsset, which should keep all related fragments
            const result = includeOnlySelectedListFields(document, [
                { name: 'name', isCustomField: false },
                { name: 'featuredAsset', isCustomField: false },
            ]);

            const resultQuery = normalizeQuery(print(result));

            // Should include selected fields
            expect(resultQuery).toContain(' name');
            expect(resultQuery).toContain('featuredAsset');

            // Should keep all used fragments
            expect(resultQuery).toContain('fragment AssetWithMetadata');
            expect(resultQuery).toContain('fragment AssetCore');
            expect(resultQuery).toContain('...AssetWithMetadata');
            expect(resultQuery).toContain('...AssetCore');
        });

        it('should handle mixed used and unused fragments', () => {
            const document = parse(`
                query ProductList($options: ProductListOptions) {
                    products(options: $options) {
                        items {
                            id
                            name
                            featuredAsset {
                                ...Asset
                            }
                            variants {
                                ...ProductVariant
                            }
                        }
                        totalItems
                    }
                }

                fragment Asset on Asset {
                    id
                    name
                    preview
                }

                fragment ProductVariant on ProductVariant {
                    id
                    name
                    sku
                    price
                }

                fragment UnusedFragment on Product {
                    description
                    slug
                }
            `);

            // Select name and featuredAsset, excluding variants
            const result = includeOnlySelectedListFields(document, [
                { name: 'name', isCustomField: false },
                { name: 'featuredAsset', isCustomField: false },
            ]);

            const resultQuery = normalizeQuery(print(result));

            // Should include selected fields
            expect(resultQuery).toContain(' name');
            expect(resultQuery).toContain('featuredAsset');

            // Should keep used Asset fragment
            expect(resultQuery).toContain('fragment Asset');
            expect(resultQuery).toContain('...Asset');

            // Should exclude variants field
            expect(resultQuery).not.toContain('variants');

            // Should remove unused fragments
            expect(resultQuery).not.toContain('fragment ProductVariant');
            expect(resultQuery).not.toContain('fragment UnusedFragment');
            expect(resultQuery).not.toContain('...ProductVariant');
        });

        it('should handle the exact case from user example', () => {
            const document = parse(`
                query ProductVariantList($options: ProductVariantListOptions) {
                    productVariants(options: $options) {
                        items {
                            featuredAsset {
                                ...Asset
                            }
                            price
                            priceWithTax
                            stockLevels {
                                id
                                stockOnHand
                                stockAllocated
                            }
                        }
                        totalItems
                    }
                }

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

            // Remove featuredAsset field as mentioned in the user's example
            const result = includeOnlySelectedListFields(document, [
                { name: 'price', isCustomField: false },
                { name: 'priceWithTax', isCustomField: false },
                { name: 'stockLevels', isCustomField: false },
            ]);

            const resultQuery = normalizeQuery(print(result));

            // Should include selected fields
            expect(resultQuery).toContain('price');
            expect(resultQuery).toContain('priceWithTax');
            expect(resultQuery).toContain('stockLevels');

            // Should exclude featuredAsset
            expect(resultQuery).not.toContain('featuredAsset');

            // Should remove unused Asset fragment to prevent GraphQL error
            expect(resultQuery).not.toContain('fragment Asset');
            expect(resultQuery).not.toContain('...Asset');

            // Verify the document is valid GraphQL by checking basic structure
            expect(resultQuery).toContain('query ProductVariantList');
            expect(resultQuery).toContain('productVariants');
            expect(resultQuery).toContain('items');
            expect(resultQuery).toContain('totalItems');
        });
    });

    describe('unused variable removal', () => {
        it('should remove unused variables when fields using them are filtered out - user issue case', () => {
            const document = parse(`
                query FacetList($options: FacetListOptions, $facetValueListOptions: FacetValueListOptions) {
                    facets(options: $options) {
                        items {
                            ...FacetWithValueList
                        }
                        totalItems
                    }
                }

                fragment FacetWithValueList on Facet {
                    id
                    name
                    isPrivate
                    valueList(options: $facetValueListOptions) {
                        totalItems
                        items {
                            ...FacetValue
                        }
                    }
                }

                fragment FacetValue on FacetValue {
                    name
                }
            `);

            // Select only name, which should filter out valueList and its variable
            const result = includeOnlySelectedListFields(document, [{ name: 'name', isCustomField: false }]);

            const resultQuery = normalizeQuery(print(result));

            // Should include selected field
            expect(resultQuery).toContain(' name');

            // Should exclude valueList field
            expect(resultQuery).not.toContain('valueList');

            // Should remove unused $facetValueListOptions variable
            expect(resultQuery).not.toContain('$facetValueListOptions');
            expect(resultQuery).not.toContain('FacetValueListOptions');

            // Should keep used $options variable
            expect(resultQuery).toContain('$options');
            expect(resultQuery).toContain('FacetListOptions');

            // Should remove unused FacetValue fragment
            expect(resultQuery).not.toContain('fragment FacetValue');
        });

        it('should preserve variables that are still used', () => {
            const document = parse(`
                query FacetList($options: FacetListOptions, $facetValueListOptions: FacetValueListOptions) {
                    facets(options: $options) {
                        items {
                            ...FacetWithValueList
                        }
                        totalItems
                    }
                }

                fragment FacetWithValueList on Facet {
                    id
                    name
                    valueList(options: $facetValueListOptions) {
                        totalItems
                        items {
                            ...FacetValue
                        }
                    }
                }

                fragment FacetValue on FacetValue {
                    name
                }
            `);

            // Select name and valueList, which should preserve the variable
            const result = includeOnlySelectedListFields(document, [
                { name: 'name', isCustomField: false },
                { name: 'valueList', isCustomField: false },
            ]);

            const resultQuery = normalizeQuery(print(result));

            // Should include selected fields
            expect(resultQuery).toContain(' name');
            expect(resultQuery).toContain('valueList');

            // Should keep both variables since both are used
            expect(resultQuery).toContain('$options');
            expect(resultQuery).toContain('$facetValueListOptions');
            expect(resultQuery).toContain('FacetListOptions');
            expect(resultQuery).toContain('FacetValueListOptions');

            // Should keep FacetValue fragment since valueList is preserved
            expect(resultQuery).toContain('fragment FacetValue');
        });

        it('should handle multiple variables with complex usage patterns', () => {
            const document = parse(`
                query ComplexQuery($listOptions: ListOptions, $searchTerm: String, $categoryId: ID, $priceRange: PriceRangeInput) {
                    products(options: $listOptions) {
                        items {
                            id
                            name
                            searchResults(term: $searchTerm) {
                                score
                                highlight
                            }
                            category(id: $categoryId) {
                                name
                                path
                            }
                            variants(priceRange: $priceRange) {
                                price
                                priceWithTax
                            }
                        }
                        totalItems
                    }
                }
            `);

            // Select only id and name, should remove most variables
            const result = includeOnlySelectedListFields(document, [
                { name: 'id', isCustomField: false },
                { name: 'name', isCustomField: false },
            ]);

            const resultQuery = normalizeQuery(print(result));

            // Should include selected fields
            expect(resultQuery).toContain('id');
            expect(resultQuery).toContain(' name');

            // Should exclude fields that use variables
            expect(resultQuery).not.toContain('searchResults');
            expect(resultQuery).not.toContain('category');
            expect(resultQuery).not.toContain('variants');

            // Should keep only the used variable
            expect(resultQuery).toContain('$listOptions');
            expect(resultQuery).toContain('ListOptions');

            // Should remove unused variables
            expect(resultQuery).not.toContain('$searchTerm');
            expect(resultQuery).not.toContain('$categoryId');
            expect(resultQuery).not.toContain('$priceRange');
            expect(resultQuery).not.toContain('String');
            expect(resultQuery).not.toContain('ID');
            expect(resultQuery).not.toContain('PriceRangeInput');
        });

        it('should handle variables in query-level arguments', () => {
            const document = parse(`
                query ProductSearch($options: ProductListOptions, $filters: ProductFilterInput) {
                    products(options: $options, filters: $filters) {
                        items {
                            id
                            name
                            price
                            category {
                                name
                            }
                        }
                        totalItems
                    }
                }
            `);

            // Select only name, which should remove fields but keep variables used at query level
            const result = includeOnlySelectedListFields(document, [{ name: 'name', isCustomField: false }]);

            const resultQuery = normalizeQuery(print(result));

            // Should include selected field
            expect(resultQuery).toContain(' name');

            // Should exclude non-selected fields
            expect(resultQuery).not.toContain('price');
            expect(resultQuery).not.toContain('category');

            // Should keep both variables since they're used at query level
            expect(resultQuery).toContain('$options');
            expect(resultQuery).toContain('$filters');
            expect(resultQuery).toContain('ProductListOptions');
            expect(resultQuery).toContain('ProductFilterInput');
        });

        it('should handle variables used in fragment arguments', () => {
            const document = parse(`
                query ProductList($options: ProductListOptions, $assetOptions: AssetListOptions) {
                    products(options: $options) {
                        items {
                            ...ProductWithAssets
                        }
                        totalItems
                    }
                }

                fragment ProductWithAssets on Product {
                    id
                    name
                    assets(options: $assetOptions) {
                        id
                        preview
                    }
                }
            `);

            // Select only name, which should remove assets field and its variable
            const result = includeOnlySelectedListFields(document, [{ name: 'name', isCustomField: false }]);

            const resultQuery = normalizeQuery(print(result));

            // Should include selected field
            expect(resultQuery).toContain(' name');

            // Should exclude assets field
            expect(resultQuery).not.toContain('assets');

            // Should keep used variable
            expect(resultQuery).toContain('$options');
            expect(resultQuery).toContain('ProductListOptions');

            // Should remove unused variable
            expect(resultQuery).not.toContain('$assetOptions');
            expect(resultQuery).not.toContain('AssetListOptions');
        });

        it('should handle edge case with no variables', () => {
            const document = parse(`
                query ProductList {
                    products {
                        items {
                            id
                            name
                            slug
                        }
                        totalItems
                    }
                }
            `);

            const result = includeOnlySelectedListFields(document, [{ name: 'name', isCustomField: false }]);

            const resultQuery = normalizeQuery(print(result));

            // Should include selected field
            expect(resultQuery).toContain(' name');

            // Should exclude non-selected fields
            expect(resultQuery).not.toContain('slug');

            // Query should remain valid with no variables
            expect(resultQuery).toContain('query ProductList {');
        });
    });

    describe('complex real-world scenarios', () => {
        it('should handle a complex product list query', () => {
            const document = parse(`
                query GetProducts($options: ProductListOptions) {
                    products(options: $options) {
                        items {
                            id
                            createdAt
                            updatedAt
                            name
                            slug
                            enabled
                            featuredAsset {
                                id
                                preview
                                source
                                width
                                height
                            }
                            variantList {
                                totalItems
                                items {
                                    id
                                    name
                                    sku
                                }
                            }
                            customFields {
                                shortDescription
                                warrantyMonths
                                isEcoFriendly
                                featuredCollection {
                                    id
                                    name
                                }
                            }
                        }
                        totalItems
                    }
                }
            `);

            const result = includeOnlySelectedListFields(document, [
                { name: 'id', isCustomField: false },
                { name: 'name', isCustomField: false },
                { name: 'featuredAsset', isCustomField: false },
                { name: 'shortDescription', isCustomField: true },
                { name: 'isEcoFriendly', isCustomField: true },
            ]);

            const resultQuery = normalizeQuery(print(result));

            // Should include selected fields
            expect(resultQuery).toContain('id');
            expect(resultQuery).toContain(' name');
            expect(resultQuery).toContain('featuredAsset');
            expect(resultQuery).toContain('customFields { shortDescription isEcoFriendly }');

            // Should exclude non-selected fields
            expect(resultQuery).not.toContain('createdAt');
            expect(resultQuery).not.toContain('updatedAt');
            expect(resultQuery).not.toContain('slug');
            expect(resultQuery).not.toContain('enabled');
            expect(resultQuery).not.toContain('variantList');
            expect(resultQuery).not.toContain('warrantyMonths');
            expect(resultQuery).not.toContain('featuredCollection');

            // Should preserve pagination
            expect(resultQuery).toContain('totalItems');
        });

        it('should handle customer list with addresses', () => {
            const document = parse(`
                query CustomerList($options: CustomerListOptions) {
                    customers(options: $options) {
                        items {
                            id
                            title
                            firstName
                            lastName
                            emailAddress
                            phoneNumber
                            addresses {
                                id
                                streetLine1
                                streetLine2
                                city
                                province
                                postalCode
                                country {
                                    id
                                    code
                                    name
                                }
                            }
                            orders {
                                totalItems
                            }
                        }
                        totalItems
                    }
                }
            `);

            const result = includeOnlySelectedListFields(document, [
                { name: 'id', isCustomField: false },
                { name: 'emailAddress', isCustomField: false },
                { name: 'firstName', isCustomField: false },
                { name: 'lastName', isCustomField: false },
            ]);

            const resultQuery = normalizeQuery(print(result));

            // Should include selected fields
            expect(resultQuery).toContain('id');
            expect(resultQuery).toContain('emailAddress');
            expect(resultQuery).toContain('firstName');
            expect(resultQuery).toContain('lastName');

            // Should exclude non-selected fields
            expect(resultQuery).not.toContain('title');
            expect(resultQuery).not.toContain('phoneNumber');
            expect(resultQuery).not.toContain('addresses');
            expect(resultQuery).not.toContain('orders');
        });
    });

    describe('memoization', () => {
        it('should return the same reference for identical inputs', () => {
            const document = parse(`
                query ProductList($options: ProductListOptions) {
                    products(options: $options) {
                        items {
                            id
                            name
                            slug
                            enabled
                        }
                        totalItems
                    }
                }
            `);

            const selectedColumns = [
                { name: 'id', isCustomField: false },
                { name: 'name', isCustomField: false },
            ];

            const result1 = includeOnlySelectedListFields(document, selectedColumns);
            const result2 = includeOnlySelectedListFields(document, selectedColumns);

            // Should return the exact same reference from cache
            expect(result1).toBe(result2);
        });

        it('should handle different column orders consistently', () => {
            const document = parse(`
                query ProductList($options: ProductListOptions) {
                    products(options: $options) {
                        items {
                            id
                            name
                            slug
                        }
                        totalItems
                    }
                }
            `);

            const columns1 = [
                { name: 'name', isCustomField: false },
                { name: 'id', isCustomField: false },
            ];

            const columns2 = [
                { name: 'id', isCustomField: false },
                { name: 'name', isCustomField: false },
            ];

            const result1 = includeOnlySelectedListFields(document, columns1);
            const result2 = includeOnlySelectedListFields(document, columns2);

            // Should return the same result regardless of column order (due to sorting in cache key)
            expect(result1).toBe(result2);
        });
    });

    describe('column dependencies', () => {
        it('should include dependency fields even when not explicitly selected', () => {
            const document = parse(`
                query CollectionList($options: CollectionListOptions) {
                    collections(options: $options) {
                        items {
                            id
                            name
                            slug
                            children {
                                id
                                name
                            }
                            breadcrumbs {
                                id
                                name
                            }
                            position
                        }
                        totalItems
                    }
                }
            `);

            // Select only 'name' but declare dependencies on 'children' and 'breadcrumbs'
            const result = includeOnlySelectedListFields(document, [
                {
                    name: 'name',
                    isCustomField: false,
                    dependencies: ['children', 'breadcrumbs'],
                },
            ]);

            const resultQuery = normalizeQuery(print(result));

            // Should include selected field
            expect(resultQuery).toContain('name');

            // Should include dependency fields
            expect(resultQuery).toContain('children');
            expect(resultQuery).toContain('breadcrumbs');

            // Should exclude non-selected, non-dependency fields
            expect(resultQuery).not.toContain('slug');
            expect(resultQuery).not.toContain('position');
        });

        it('should handle multiple columns with different dependencies', () => {
            const document = parse(`
                query ProductList($options: ProductListOptions) {
                    products(options: $options) {
                        items {
                            id
                            name
                            slug
                            enabled
                            variants {
                                id
                                name
                            }
                            assets {
                                id
                                preview
                            }
                            featuredAsset {
                                id
                                preview
                            }
                        }
                        totalItems
                    }
                }
            `);

            const result = includeOnlySelectedListFields(document, [
                {
                    name: 'name',
                    isCustomField: false,
                    dependencies: ['featuredAsset'], // For thumbnail display
                },
                {
                    name: 'enabled',
                    isCustomField: false,
                    dependencies: ['variants'], // For variant count display
                },
            ]);

            const resultQuery = normalizeQuery(print(result));

            // Should include selected fields
            expect(resultQuery).toContain('name');
            expect(resultQuery).toContain('enabled');

            // Should include dependency fields
            expect(resultQuery).toContain('featuredAsset');
            expect(resultQuery).toContain('variants');

            // Should exclude non-selected, non-dependency fields
            expect(resultQuery).not.toContain('slug');
            expect(resultQuery).not.toContain('assets');
        });

        it('should cache correctly with dependencies', () => {
            const document = parse(`
                query TestList($options: TestListOptions) {
                    tests(options: $options) {
                        items {
                            id
                            name
                            data
                            metadata
                        }
                        totalItems
                    }
                }
            `);

            const columnsWithDeps = [
                {
                    name: 'name',
                    isCustomField: false,
                    dependencies: ['metadata'],
                },
            ];

            const result1 = includeOnlySelectedListFields(document, columnsWithDeps);
            const result2 = includeOnlySelectedListFields(document, columnsWithDeps);

            // Should return the same reference from cache
            expect(result1).toBe(result2);
        });

        it('should handle dependencies with custom fields', () => {
            const document = parse(`
                query ProductList($options: ProductListOptions) {
                    products(options: $options) {
                        items {
                            id
                            name
                            customFields {
                                shortDescription
                                isEcoFriendly
                                relatedProducts {
                                    id
                                    name
                                }
                            }
                        }
                        totalItems
                    }
                }
            `);

            const result = includeOnlySelectedListFields(document, [
                {
                    name: 'name',
                    isCustomField: false,
                    dependencies: ['customFields'], // Depends on custom fields for rendering logic
                },
                {
                    name: 'shortDescription',
                    isCustomField: true,
                },
            ]);

            const resultQuery = normalizeQuery(print(result));

            // Should include selected fields
            expect(resultQuery).toContain('name');

            // Should include customFields (as dependency and for custom field)
            expect(resultQuery).toContain('customFields');
            expect(resultQuery).toContain('shortDescription');

            // Should include id for valid query
            expect(resultQuery).toContain('id');
        });
    });
});
