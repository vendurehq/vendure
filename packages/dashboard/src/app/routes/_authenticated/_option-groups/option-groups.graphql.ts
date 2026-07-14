import { graphql } from '@/vdb/graphql/graphql.js';

export const optionGroupListDocument = graphql(`
    query OptionGroupList($options: ProductOptionGroupListOptions) {
        productOptionGroups(options: $options) {
            items {
                id
                createdAt
                updatedAt
                name
                code
                productCount
            }
            totalItems
        }
    }
`);

export const deleteOptionGroupsDocument = graphql(`
    mutation DeleteOptionGroups($ids: [ID!]!, $force: Boolean) {
        deleteProductOptionGroups(ids: $ids, force: $force) {
            result
            message
        }
    }
`);

export const productsByOptionGroupDocument = graphql(`
    query ProductsByOptionGroup($options: ProductListOptions) {
        products(options: $options) {
            items {
                id
                createdAt
                updatedAt
                name
                slug
            }
            totalItems
        }
    }
`);

export const assignOptionGroupsToChannelDocument = graphql(`
    mutation AssignOptionGroupsToChannel($input: AssignProductOptionGroupsToChannelInput!) {
        assignProductOptionGroupsToChannel(input: $input) {
            id
        }
    }
`);

export const removeOptionGroupsFromChannelDocument = graphql(`
    mutation RemoveOptionGroupsFromChannel($input: RemoveProductOptionGroupsFromChannelInput!) {
        removeProductOptionGroupsFromChannel(input: $input) {
            ... on ProductOptionGroup {
                id
            }
            ... on ErrorResult {
                message
            }
        }
    }
`);
