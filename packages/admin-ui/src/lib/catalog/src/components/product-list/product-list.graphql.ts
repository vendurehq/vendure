import { gql } from 'apollo-angular';

const PRODUCT_LIST_QUERY_PRODUCT_FRAGMENT = gql`
    fragment ProductListQueryProductFragment on Product {
        id
        createdAt
        updatedAt
        enabled
        languageCode
        name
        slug
        featuredAsset {
            id
            createdAt
            updatedAt
            preview
            focalPoint {
                x
                y
            }
        }
        variantList {
            totalItems
        }
    }
`;

export const PRODUCT_LIST_QUERY = gql`
    query ProductListQuery($options: ProductListOptions) {
        products(options: $options) {
            items {
                ...ProductListQueryProductFragment
            }
            totalItems
        }
    }
    ${PRODUCT_LIST_QUERY_PRODUCT_FRAGMENT}
`;
