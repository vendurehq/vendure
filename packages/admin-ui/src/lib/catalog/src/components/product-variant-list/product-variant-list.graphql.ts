import { ASSET_FRAGMENT } from '@vendure/admin-ui/core';
import { gql } from 'apollo-angular';

const PRODUCT_VARIANT_LIST_QUERY_PRODUCT_VARIANT_FRAGMENT = gql`
    fragment ProductVariantListQueryProductVariantFragment on ProductVariant {
        id
        createdAt
        updatedAt
        productId
        enabled
        languageCode
        name
        price
        currencyCode
        priceWithTax
        trackInventory
        outOfStockThreshold
        stockLevels {
            id
            createdAt
            updatedAt
            stockLocationId
            stockOnHand
            stockAllocated
            stockLocation {
                id
                createdAt
                updatedAt
                name
            }
        }
        useGlobalOutOfStockThreshold
        sku
        featuredAsset {
            ...Asset
        }
    }

    ${ASSET_FRAGMENT}
`;

export const PRODUCT_VARIANT_LIST_QUERY = gql`
    query ProductVariantListQuery($options: ProductVariantListOptions!) {
        productVariants(options: $options) {
            items {
                ...ProductVariantListQueryProductVariantFragment
            }
            totalItems
        }
    }
    ${PRODUCT_VARIANT_LIST_QUERY_PRODUCT_VARIANT_FRAGMENT}
`;
