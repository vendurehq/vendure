import {
    ASSET_FRAGMENT,
    PRODUCT_OPTION_FRAGMENT,
    PRODUCT_VARIANT_PRICE_FRAGMENT,
} from '@vendure/admin-ui/core';
import { gql } from 'apollo-angular';

export const PRODUCT_VARIANT_DETAIL_QUERY_PRODUCT_VARIANT_FRAGMENT = gql`
    fragment ProductVariantDetailQueryProductVariantFragment on ProductVariant {
        id
        createdAt
        updatedAt
        enabled
        languageCode
        name
        price
        currencyCode
        prices {
            ...ProductVariantPrice
        }
        priceWithTax
        stockOnHand
        stockAllocated
        trackInventory
        outOfStockThreshold
        useGlobalOutOfStockThreshold
        taxRateApplied {
            id
            name
            value
        }
        taxCategory {
            id
            name
        }
        sku
        options {
            ...ProductOption
        }
        stockLevels {
            id
            createdAt
            updatedAt
            stockOnHand
            stockAllocated
            stockLocationId
            stockLocation {
                id
                createdAt
                updatedAt
                name
            }
        }
        facetValues {
            id
            code
            name
            facet {
                id
                name
            }
        }
        featuredAsset {
            ...Asset
        }
        assets {
            ...Asset
        }
        translations {
            id
            languageCode
            name
        }
        channels {
            id
            code
        }
        product {
            id
            name
            optionGroups {
                id
                name
                code
                translations {
                    id
                    languageCode
                    name
                }
            }
        }
    }
    ${PRODUCT_VARIANT_PRICE_FRAGMENT}
`;

export const PRODUCT_VARIANT_DETAIL_QUERY = gql`
    query GetProductVariantDetail($id: ID!) {
        productVariant(id: $id) {
            ...ProductVariantDetailQueryProductVariantFragment
        }
        stockLocations(options: { take: 100 }) {
            items {
                id
                createdAt
                updatedAt
                name
                description
            }
        }
        taxCategories(options: { take: 100 }) {
            items {
                id
                createdAt
                updatedAt
                name
                isDefault
            }
            totalItems
        }
        activeChannel {
            id
            availableCurrencyCodes
            defaultCurrencyCode
        }
    }
    ${PRODUCT_VARIANT_DETAIL_QUERY_PRODUCT_VARIANT_FRAGMENT}
`;

export const PRODUCT_VARIANT_UPDATE_MUTATION = gql`
    mutation ProductVariantUpdateMutation($input: [UpdateProductVariantInput!]!) {
        updateProductVariants(input: $input) {
            ...ProductVariantDetailQueryProductVariantFragment
        }
    }
    ${PRODUCT_VARIANT_DETAIL_QUERY_PRODUCT_VARIANT_FRAGMENT}
`;
