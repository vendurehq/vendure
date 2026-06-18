import { gql } from 'apollo-angular';

export const GET_PRODUCTS_WITH_FACET_VALUES_BY_IDS = gql`
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
`;

export const GET_VARIANTS_WITH_FACET_VALUES_BY_IDS = gql`
    query GetVariantsWithFacetValuesByIds($ids: [String!]!) {
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
`;

export const UPDATE_PRODUCTS_BULK = gql`
    mutation UpdateProductsBulk($input: [UpdateProductInput!]!) {
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
`;

export const UPDATE_VARIANTS_BULK = gql`
    mutation UpdateVariantsBulk($input: [UpdateProductVariantInput!]!) {
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
`;
