import { graphql } from '@/vdb/graphql/graphql.js';
import { print } from 'graphql';
import { describe, expect, it } from 'vitest';

import { extendDocument, gqlExtend } from './extend-document.js';

/**
 * Helper to strip indentation and normalize GraphQL SDL for comparison.
 * Allows the expected result to be indented naturally in the code.
 */
function expectedSDL(str: string): string {
    const lines = str.split('\n');
    // Find the minimum indentation (excluding empty lines)
    let minIndent = Infinity;
    for (const line of lines) {
        if (line.trim() === '') continue;
        const indent = line.match(/^\s*/)?.[0].length || 0;
        minIndent = Math.min(minIndent, indent);
    }
    // Remove the minimum indentation from all lines and normalize
    return lines
        .map(line => line.slice(minIndent).trim())
        .filter(line => line.length > 0)
        .join('\n');
}

describe('extendDocument', () => {
    const baseDocument = graphql(`
        query ProductVariantList($options: ProductVariantListOptions) {
            productVariants(options: $options) {
                items {
                    id
                    name
                    sku
                    price
                }
                totalItems
            }
        }
    `);

    it('should add new fields to existing query', () => {
        const extended = extendDocument(
            baseDocument,
            `
            query ProductVariantList($options: ProductVariantListOptions) {
                productVariants(options: $options) {
                    items {
                        reviewRating
                        customField
                    }
                }
            }
            `,
        );

        const printed = print(extended);

        expect(expectedSDL(printed)).toBe(
            expectedSDL(`
                query ProductVariantList($options: ProductVariantListOptions) {
                    productVariants(options: $options) {
                        items {
                            id
                            name
                            sku
                            price
                            reviewRating
                            customField
                        }
                        totalItems
                    }
                }
            `),
        );
    });

    it('should merge nested selection sets', () => {
        const extended = extendDocument(
            baseDocument,
            `
            query ProductVariantList($options: ProductVariantListOptions) {
                productVariants(options: $options) {
                    items {
                        featuredAsset {
                            id
                            name
                        }
                    }
                }
            }
            `,
        );

        const printed = print(extended);

        expect(expectedSDL(printed)).toBe(
            expectedSDL(`
                query ProductVariantList($options: ProductVariantListOptions) {
                    productVariants(options: $options) {
                        items {
                            id
                            name
                            sku
                            price
                            featuredAsset {
                                id
                                name
                            }
                        }
                        totalItems
                    }
                }
            `),
        );
    });

    it('should handle multiple operations', () => {
        const multiOpDocument = graphql(`
            query ProductVariantList($options: ProductVariantListOptions) {
                productVariants(options: $options) {
                    items {
                        id
                        name
                    }
                    totalItems
                }
            }

            query ProductVariantDetail($id: ID!) {
                productVariant(id: $id) {
                    id
                    name
                }
            }
        `);

        const extended = extendDocument(
            multiOpDocument,
            `
            query ProductVariantList($options: ProductVariantListOptions) {
                productVariants(options: $options) {
                    items {
                        sku
                    }
                }
            }

            query ProductVariantDetail($id: ID!) {
                productVariant(id: $id) {
                    sku
                    price
                }
            }
            `,
        );

        const printed = print(extended);

        expect(expectedSDL(printed)).toBe(
            expectedSDL(`
                query ProductVariantList($options: ProductVariantListOptions) {
                    productVariants(options: $options) {
                        items {
                            id
                            name
                            sku
                        }
                        totalItems
                    }
                }
                query ProductVariantDetail($id: ID!) {
                    productVariant(id: $id) {
                        id
                        name
                        sku
                        price
                    }
                }
            `),
        );
    });

    it('should preserve fragments', () => {
        const fragmentDocument = graphql(`
            fragment ProductVariantFields on ProductVariant {
                id
                name
            }

            query ProductVariantList($options: ProductVariantListOptions) {
                productVariants(options: $options) {
                    items {
                        ...ProductVariantFields
                    }
                    totalItems
                }
            }
        `);

        const extended = extendDocument(
            fragmentDocument,
            `
            fragment ProductVariantFields on ProductVariant {
                sku
            }

            query ProductVariantList($options: ProductVariantListOptions) {
                productVariants(options: $options) {
                    items {
                        price
                    }
                }
            }
            `,
        );

        const printed = print(extended);

        expect(expectedSDL(printed)).toBe(
            expectedSDL(`
                query ProductVariantList($options: ProductVariantListOptions) {
                    productVariants(options: $options) {
                        items {
                            ...ProductVariantFields
                            price
                        }
                        totalItems
                    }
                }
                fragment ProductVariantFields on ProductVariant {
                    id
                    name
                }
                fragment ProductVariantFields on ProductVariant {
                    sku
                }
            `),
        );
    });

    it('should work with template string interpolation', () => {
        const fieldName = 'reviewRating';
        const extended = extendDocument(
            baseDocument,
            `
            query ProductVariantList($options: ProductVariantListOptions) {
                productVariants(options: $options) {
                    items {
                        ${fieldName}
                    }
                }
            }
            `,
        );

        const printed = print(extended);

        expect(expectedSDL(printed)).toBe(
            expectedSDL(`
                query ProductVariantList($options: ProductVariantListOptions) {
                    productVariants(options: $options) {
                        items {
                            id
                            name
                            sku
                            price
                            reviewRating
                        }
                        totalItems
                    }
                }
            `),
        );
    });

    it('should handle the gqlExtend utility function', () => {
        const extender = gqlExtend`
            query ProductVariantList($options: ProductVariantListOptions) {
                productVariants(options: $options) {
                    items {
                        reviewRating
                    }
                }
            }
        `;

        const extended = extender(baseDocument);
        const printed = print(extended);

        expect(expectedSDL(printed)).toBe(
            expectedSDL(`
                query ProductVariantList($options: ProductVariantListOptions) {
                    productVariants(options: $options) {
                        items {
                            id
                            name
                            sku
                            price
                            reviewRating
                        }
                        totalItems
                    }
                }
            `),
        );
    });

    it('should not duplicate existing fields', () => {
        const extended = extendDocument(
            baseDocument,
            `
            query ProductVariantList($options: ProductVariantListOptions) {
                productVariants(options: $options) {
                    items {
                        id
                        name
                        reviewRating
                    }
                }
            }
            `,
        );

        const printed = print(extended);

        expect(expectedSDL(printed)).toBe(
            expectedSDL(`
                query ProductVariantList($options: ProductVariantListOptions) {
                    productVariants(options: $options) {
                        items {
                            id
                            name
                            sku
                            price
                            reviewRating
                        }
                        totalItems
                    }
                }
            `),
        );
    });

    it('should merge nested selection sets for existing fields', () => {
        const baseWithNested = graphql(`
            query ProductVariantList($options: ProductVariantListOptions) {
                productVariants(options: $options) {
                    items {
                        id
                        featuredAsset {
                            id
                        }
                    }
                    totalItems
                }
            }
        `);

        const extended = extendDocument(
            baseWithNested,
            `
            query ProductVariantList($options: ProductVariantListOptions) {
                productVariants(options: $options) {
                    items {
                        featuredAsset {
                            name
                            preview
                        }
                    }
                }
            }
            `,
        );

        const printed = print(extended);

        expect(expectedSDL(printed)).toBe(
            expectedSDL(`
                query ProductVariantList($options: ProductVariantListOptions) {
                    productVariants(options: $options) {
                        items {
                            id
                            featuredAsset {
                                id
                                name
                                preview
                            }
                        }
                        totalItems
                    }
                }
            `),
        );
    });

    it('should ignore different query names and merge by top-level field', () => {
        const extended = extendDocument(
            baseDocument,
            `
            query DifferentQueryName($options: ProductVariantListOptions) {
                productVariants(options: $options) {
                    items {
                        reviewRating
                    }
                }
            }
            `,
        );

        const printed = print(extended);

        expect(expectedSDL(printed)).toBe(
            expectedSDL(`
                query ProductVariantList($options: ProductVariantListOptions) {
                    productVariants(options: $options) {
                        items {
                            id
                            name
                            sku
                            price
                            reviewRating
                        }
                        totalItems
                    }
                }
            `),
        );
    });

    it('should ignore different variables and merge by top-level field', () => {
        const extended = extendDocument(
            baseDocument,
            `
            query ProductVariantList($differentOptions: ProductVariantListOptions) {
                productVariants(options: $differentOptions) {
                    items {
                        reviewRating
                    }
                }
            }
            `,
        );

        const printed = print(extended);

        expect(expectedSDL(printed)).toBe(
            expectedSDL(`
                query ProductVariantList($options: ProductVariantListOptions) {
                    productVariants(options: $options) {
                        items {
                            id
                            name
                            sku
                            price
                            reviewRating
                        }
                        totalItems
                    }
                }
            `),
        );
    });

    it('should throw error when top-level field differs', () => {
        expect(() => {
            extendDocument(
                baseDocument,
                `
                query CompletelyDifferentQuery($id: ID!) {
                    product(id: $id) {
                        id
                        name
                        description
                    }
                }
                `,
            );
        }).toThrow("The query extension must extend the 'productVariants' query. Got 'product' instead.");
    });

    it('should merge anonymous query by top-level field', () => {
        const extended = extendDocument(
            baseDocument,
            `
            {
                productVariants {
                    items {
                        reviewRating
                    }
                }
            }
            `,
        );

        const printed = print(extended);

        expect(expectedSDL(printed)).toBe(
            expectedSDL(`
                query ProductVariantList($options: ProductVariantListOptions) {
                    productVariants(options: $options) {
                        items {
                            id
                            name
                            sku
                            price
                            reviewRating
                        }
                        totalItems
                    }
                }
            `),
        );
    });

    it('should accept DocumentNode as extension parameter', () => {
        const extensionDocument = graphql(`
            query ProductVariantList($options: ProductVariantListOptions) {
                productVariants(options: $options) {
                    items {
                        reviewRating
                        customField
                    }
                }
            }
        `);

        const extended = extendDocument(baseDocument, extensionDocument);
        const printed = print(extended);

        expect(expectedSDL(printed)).toBe(
            expectedSDL(`
                query ProductVariantList($options: ProductVariantListOptions) {
                    productVariants(options: $options) {
                        items {
                            id
                            name
                            sku
                            price
                            reviewRating
                            customField
                        }
                        totalItems
                    }
                }
            `),
        );
    });

    it('should extend detail query with fragments', () => {
        const detailDocument = graphql(`
            fragment ProductDetail on Product {
                id
                name
                slug
                description
                featuredAsset {
                    id
                    preview
                }
            }

            query ProductDetail($id: ID!) {
                product(id: $id) {
                    ...ProductDetail
                }
            }
        `);

        const extended = extendDocument(
            detailDocument as any,
            `
            fragment ProductDetail on Product {
                enabled
                createdAt
                updatedAt
                assets {
                    id
                    preview
                }
            }

            query ProductDetail($id: ID!) {
                product(id: $id) {
                    customFields
                }
            }
            `,
        );

        const printed = print(extended);

        expect(expectedSDL(printed)).toBe(
            expectedSDL(`
                query ProductDetail($id: ID!) {
                    product(id: $id) {
                        ...ProductDetail
                        customFields
                    }
                }
                fragment ProductDetail on Product {
                    id
                    name
                    slug
                    description
                    featuredAsset {
                        id
                        preview
                    }
                }
                fragment ProductDetail on Product {
                    enabled
                    createdAt
                    updatedAt
                    assets {
                        id
                        preview
                    }
                }
            `),
        );
    });

    it('should extend detail query with nested translations', () => {
        const detailDocument = graphql(`
            query ProductDetail($id: ID!) {
                product(id: $id) {
                    id
                    name
                    slug
                    translations {
                        id
                        languageCode
                        name
                    }
                }
            }
        `);

        const extended = extendDocument(
            detailDocument as any,
            `
            query ProductDetail($id: ID!) {
                product(id: $id) {
                    translations {
                        slug
                        description
                    }
                    facetValues {
                        id
                        name
                        code
                        facet {
                            id
                            name
                            code
                        }
                    }
                }
            }
            `,
        );

        const printed = print(extended);

        expect(expectedSDL(printed)).toBe(
            expectedSDL(`
                query ProductDetail($id: ID!) {
                    product(id: $id) {
                        id
                        name
                        slug
                        translations {
                            id
                            languageCode
                            name
                            slug
                            description
                        }
                        facetValues {
                            id
                            name
                            code
                            facet {
                                id
                                name
                                code
                            }
                        }
                    }
                }
            `),
        );
    });

    it('should extend detail query with asset fragments', () => {
        const detailDocument = graphql(`
            fragment Asset on Asset {
                id
                preview
            }

            query ProductDetail($id: ID!) {
                product(id: $id) {
                    id
                    featuredAsset {
                        ...Asset
                    }
                }
            }
        `);

        const extended = extendDocument(
            detailDocument as any,
            `
            fragment Asset on Asset {
                name
                source
            }

            query ProductDetail($id: ID!) {
                product(id: $id) {
                    assets {
                        ...Asset
                    }
                }
            }
            `,
        );

        const printed = print(extended);

        expect(expectedSDL(printed)).toBe(
            expectedSDL(`
                query ProductDetail($id: ID!) {
                    product(id: $id) {
                        id
                        featuredAsset {
                            ...Asset
                        }
                        assets {
                            ...Asset
                        }
                    }
                }
                fragment Asset on Asset {
                    id
                    preview
                }
                fragment Asset on Asset {
                    name
                    source
                }
            `),
        );
    });

    it('should extend detail query with custom fields', () => {
        const detailDocument = graphql(`
            query ProductDetail($id: ID!) {
                product(id: $id) {
                    id
                    name
                    customFields
                }
            }
        `);

        const extended = extendDocument(
            detailDocument as any,
            `
            query ProductDetail($id: ID!) {
                product(id: $id) {
                    enabled
                    createdAt
                    updatedAt
                    customFields
                }
            }
            `,
        );

        const printed = print(extended);

        expect(expectedSDL(printed)).toBe(
            expectedSDL(`
                query ProductDetail($id: ID!) {
                    product(id: $id) {
                        id
                        name
                        customFields
                        enabled
                        createdAt
                        updatedAt
                    }
                }
            `),
        );
    });

    it('should extend detail query with complex nested structure', () => {
        const detailDocument = graphql(`
            query ProductDetail($id: ID!) {
                product(id: $id) {
                    id
                    name
                    featuredAsset {
                        id
                        preview
                    }
                    facetValues {
                        id
                        name
                    }
                }
            }
        `);

        const extended = extendDocument(
            detailDocument as any,
            `
            query ProductDetail($id: ID!) {
                product(id: $id) {
                    featuredAsset {
                        name
                        source
                    }
                    facetValues {
                        code
                        facet {
                            id
                            name
                            code
                        }
                    }
                    translations {
                        id
                        languageCode
                        name
                        slug
                        description
                    }
                }
            }
            `,
        );

        const printed = print(extended);

        expect(expectedSDL(printed)).toBe(
            expectedSDL(`
                query ProductDetail($id: ID!) {
                    product(id: $id) {
                        id
                        name
                        featuredAsset {
                            id
                            preview
                            name
                            source
                        }
                        facetValues {
                            id
                            name
                            code
                            facet {
                                id
                                name
                                code
                            }
                        }
                        translations {
                            id
                            languageCode
                            name
                            slug
                            description
                        }
                    }
                }
            `),
        );
    });
});
