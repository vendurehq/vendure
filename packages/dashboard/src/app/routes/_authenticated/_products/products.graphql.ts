import { assetFragment } from '@/vdb/graphql/fragments.js';
import { graphql } from '@/vdb/graphql/graphql.js';

export const productListDocument = graphql(`
    query ProductList($options: ProductListOptions) {
        products(options: $options) {
            items {
                id
                createdAt
                updatedAt
                featuredAsset {
                    id
                    preview
                }
                name
                slug
                enabled
                description
            }
            totalItems
        }
    }
`);

export const productDetailFragment = graphql(
    `
        fragment ProductDetail on Product {
            id
            createdAt
            updatedAt
            enabled
            name
            slug
            description
            featuredAsset {
                ...Asset
            }
            assets {
                ...Asset
            }
            channels {
                id
                code
                token
            }
            translations {
                id
                languageCode
                name
                slug
                description
            }
            optionGroups {
                id
                code
                name
                options {
                    id
                    code
                    name
                }
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
            customFields
        }
    `,
    [assetFragment],
);

export const productVariantListDocument = graphql(
    `
        query ProductVariantList($options: ProductVariantListOptions, $productId: ID) {
            productVariants(options: $options, productId: $productId) {
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
                        stockOnHand
                        stockAllocated
                    }
                }
                totalItems
            }
        }
    `,
    [assetFragment],
);

export const productDetailDocument = graphql(
    `
        query ProductDetail($id: ID!) {
            product(id: $id) {
                ...ProductDetail
                variantList {
                    totalItems
                }
            }
        }
    `,
    [productDetailFragment],
);

export const productDetailWithVariantsDocument = graphql(`
    query ProductDetailWithVariants($id: ID!) {
        product(id: $id) {
            id
            createdAt
            updatedAt
            name
            variantList {
                totalItems
            }
            optionGroups {
                id
                code
                name
                options {
                    id
                    code
                    name
                }
            }
            variants {
                id
                name
                sku
                price
                currencyCode
                priceWithTax
                createdAt
                updatedAt
                options {
                    id
                    code
                    name
                    groupId
                }
            }
        }
    }
`);

export const createProductDocument = graphql(`
    mutation CreateProduct($input: CreateProductInput!) {
        createProduct(input: $input) {
            id
        }
    }
`);

export const updateProductDocument = graphql(`
    mutation UpdateProduct($input: UpdateProductInput!) {
        updateProduct(input: $input) {
            id
        }
    }
`);

export const deleteProductDocument = graphql(`
    mutation DeleteProduct($id: ID!) {
        deleteProduct(id: $id) {
            result
            message
        }
    }
`);

export const deleteProductsDocument = graphql(`
    mutation DeleteProducts($ids: [ID!]!) {
        deleteProducts(ids: $ids) {
            result
            message
        }
    }
`);

export const assignProductsToChannelDocument = graphql(`
    mutation AssignProductsToChannel($input: AssignProductsToChannelInput!) {
        assignProductsToChannel(input: $input) {
            id
            channels {
                id
                code
            }
        }
    }
`);

export const removeProductsFromChannelDocument = graphql(`
    mutation RemoveProductsFromChannel($input: RemoveProductsFromChannelInput!) {
        removeProductsFromChannel(input: $input) {
            id
            channels {
                id
                code
            }
        }
    }
`);

export const updateProductsDocument = graphql(`
    mutation UpdateProducts($input: [UpdateProductInput!]!) {
        updateProducts(input: $input) {
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

export const getProductsWithFacetValuesByIdsDocument = graphql(`
    query GetProductsWithFacetValuesByIds($ids: [String!]!) {
        products(options: { filter: { id: { in: $ids } } }) {
            items {
                id
                name
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

export const addOptionGroupToProductDocument = graphql(`
    mutation AddOptionGroupToProduct($productId: ID!, $optionGroupId: ID!) {
        addOptionGroupToProduct(productId: $productId, optionGroupId: $optionGroupId) {
            id
            optionGroups {
                id
                code
                name
                options {
                    id
                    code
                    name
                }
            }
        }
    }
`);

export const updateProductVariantDocument = graphql(`
    mutation UpdateProductVariant($input: UpdateProductVariantInput!) {
        updateProductVariant(input: $input) {
            id
            name
            options {
                id
                code
                name
                groupId
            }
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

export const removeOptionGroupFromProductDocument = graphql(`
    mutation RemoveOptionGroupFromProduct($productId: ID!, $optionGroupId: ID!, $force: Boolean) {
        removeOptionGroupFromProduct(productId: $productId, optionGroupId: $optionGroupId, force: $force) {
            ... on Product {
                __typename
                id
                optionGroups {
                    id
                    code
                    name
                }
            }
            ... on ProductOptionInUseError {
                __typename
                errorCode
                message
            }
        }
    }
`);

export const createProductOptionGroupDocument = graphql(`
    mutation CreateOptionGroups($input: CreateProductOptionGroupInput!) {
        createProductOptionGroup(input: $input) {
            id
            name
            code
            options {
                id
                code
                name
            }
        }
    }
`);

export const createProductOptionDocument = graphql(`
    mutation CreateProductOption($input: CreateProductOptionInput!) {
        createProductOption(input: $input) {
            id
            code
            name
            groupId
        }
    }
`);

export const createProductVariantsDocument = graphql(`
    mutation CreateProductVariants($input: [CreateProductVariantInput!]!) {
        createProductVariants(input: $input) {
            id
            name
        }
    }
`);

export const reindexDocument = graphql(`
    mutation Reindex {
        reindex {
            id
        }
    }
`);
