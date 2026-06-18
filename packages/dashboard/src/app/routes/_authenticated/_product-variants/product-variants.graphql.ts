import { assetFragment } from '@/vdb/graphql/fragments.js';
import { graphql } from '@/vdb/graphql/graphql.js';

export const productVariantListDocument = graphql(
    `
        query ProductVariantList($options: ProductVariantListOptions) {
            productVariants(options: $options) {
                items {
                    id
                    createdAt
                    updatedAt
                    featuredAsset {
                        ...Asset
                    }
                    name
                    sku
                    enabled
                    currencyCode
                    price
                    priceWithTax
                    stockLevels {
                        id
                        stockOnHand
                        stockAllocated
                    }
                    customFields
                }
                totalItems
            }
        }
    `,
    [assetFragment],
);

export const productVariantPriceFragment = graphql(`
    fragment ProductVariantPrice on ProductVariantPrice {
        currencyCode
        price
    }
`);

export const productVariantDetailDocument = graphql(
    `
        query ProductVariantDetail($id: ID!) {
            productVariant(id: $id) {
                id
                createdAt
                updatedAt
                product {
                    id
                    name
                }
                enabled
                featuredAsset {
                    ...Asset
                }
                assets {
                    ...Asset
                }
                facetValues {
                    id
                    code
                    name
                    facet {
                        id
                        code
                        name
                    }
                }
                options {
                    id
                    name
                    code
                    group {
                        id
                        name
                        code
                    }
                }
                translations {
                    id
                    languageCode
                    name
                }
                name
                sku
                currencyCode
                taxCategory {
                    id
                    name
                    isDefault
                }
                price
                priceWithTax
                prices {
                    ...ProductVariantPrice
                }
                trackInventory
                outOfStockThreshold
                useGlobalOutOfStockThreshold
                stockLevels {
                    id
                    stockOnHand
                    stockAllocated
                    stockLocation {
                        id
                        name
                    }
                }
                customFields
            }
        }
    `,
    [assetFragment, productVariantPriceFragment],
);

export const createProductVariantDocument = graphql(`
    mutation CreateProductVariant($input: [CreateProductVariantInput!]!) {
        createProductVariants(input: $input) {
            id
        }
    }
`);

export const updateProductVariantDocument = graphql(`
    mutation UpdateProductVariant($input: UpdateProductVariantInput!) {
        updateProductVariant(input: $input) {
            id
        }
    }
`);

export const deleteProductVariantDocument = graphql(`
    mutation DeleteProductVariant($id: ID!) {
        deleteProductVariant(id: $id) {
            result
            message
        }
    }
`);

export const deleteProductVariantsDocument = graphql(`
    mutation DeleteProductVariants($ids: [ID!]!) {
        deleteProductVariants(ids: $ids) {
            result
            message
        }
    }
`);

export const assignProductVariantsToChannelDocument = graphql(`
    mutation AssignProductVariantsToChannel($input: AssignProductVariantsToChannelInput!) {
        assignProductVariantsToChannel(input: $input) {
            id
        }
    }
`);

export const removeProductVariantsFromChannelDocument = graphql(`
    mutation RemoveProductVariantsFromChannel($input: RemoveProductVariantsFromChannelInput!) {
        removeProductVariantsFromChannel(input: $input) {
            id
        }
    }
`);

export const getProductVariantsWithFacetValuesByIdsDocument = graphql(`
    query GetProductVariantsWithFacetValuesByIds($ids: [String!]!) {
        productVariants(options: { filter: { id: { in: $ids } } }) {
            items {
                id
                name
                sku
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
    }
`);

export const updateProductVariantsDocument = graphql(`
    mutation UpdateProductVariants($input: [UpdateProductVariantInput!]!) {
        updateProductVariants(input: $input) {
            id
            name
            facetValues {
                id
                name
                code
            }
        }
    }
`);

export const stockLocationsQueryDocument = graphql(`
    query StockLocations {
        stockLocations(options: { take: 100 }) {
            items {
                id
                name
                description
            }
        }
    }
`);
