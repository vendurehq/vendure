import{g as o}from"./index-CLu5rDeH.js";const n=o(`
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
`),p=o(`
    mutation DeleteOptionGroups($ids: [ID!]!, $force: Boolean) {
        deleteProductOptionGroups(ids: $ids, force: $force) {
            result
            message
        }
    }
`),s=o(`
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
`),e=o(`
    mutation AssignOptionGroupsToChannel($input: AssignProductOptionGroupsToChannelInput!) {
        assignProductOptionGroupsToChannel(input: $input) {
            id
        }
    }
`),u=o(`
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
`);export{e as a,p as d,n as o,s as p,u as r};
