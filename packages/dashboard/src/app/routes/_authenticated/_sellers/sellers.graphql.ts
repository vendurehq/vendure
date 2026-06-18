import { graphql } from '@/vdb/graphql/graphql.js';

export const sellerItemFragment = graphql(`
    fragment SellerItem on Seller {
        id
        createdAt
        updatedAt
        name
    }
`);

export const sellerListQuery = graphql(
    `
        query SellerList($options: SellerListOptions) {
            sellers(options: $options) {
                items {
                    ...SellerItem
                }
                totalItems
            }
        }
    `,
    [sellerItemFragment],
);

export const sellerDetailDocument = graphql(
    `
        query SellerDetail($id: ID!) {
            seller(id: $id) {
                ...SellerItem
                customFields
            }
        }
    `,
    [sellerItemFragment],
);

export const updateSellerDocument = graphql(`
    mutation UpdateSeller($input: UpdateSellerInput!) {
        updateSeller(input: $input) {
            id
        }
    }
`);

export const createSellerDocument = graphql(`
    mutation CreateSeller($input: CreateSellerInput!) {
        createSeller(input: $input) {
            id
        }
    }
`);

export const deleteSellerDocument = graphql(`
    mutation DeleteSeller($id: ID!) {
        deleteSeller(id: $id) {
            result
            message
        }
    }
`);

export const deleteSellersDocument = graphql(`
    mutation DeleteSellers($ids: [ID!]!) {
        deleteSellers(ids: $ids) {
            result
            message
        }
    }
`);
