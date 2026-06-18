import { graphql } from '@/vdb/graphql/graphql.js';

export const customerGroupListDocument = graphql(`
    query CustomerGroupList($options: CustomerGroupListOptions) {
        customerGroups(options: $options) {
            items {
                id
                createdAt
                updatedAt
                name
                customers {
                    totalItems
                }
            }
            totalItems
        }
    }
`);

export const addCustomersToGroupDocument = graphql(`
    mutation AddCustomersToGroup($customerGroupId: ID!, $customerIds: [ID!]!) {
        addCustomersToGroup(customerGroupId: $customerGroupId, customerIds: $customerIds) {
            id
        }
    }
`);

export const removeCustomersFromGroupDocument = graphql(`
    mutation RemoveCustomersFromGroup($customerGroupId: ID!, $customerIds: [ID!]!) {
        removeCustomersFromGroup(customerGroupId: $customerGroupId, customerIds: $customerIds) {
            id
        }
    }
`);

export const customerGroupDetailDocument = graphql(`
    query CustomerGroup($id: ID!) {
        customerGroup(id: $id) {
            id
            createdAt
            updatedAt
            name
            customFields
        }
    }
`);

export const createCustomerGroupDocument = graphql(`
    mutation CreateCustomerGroup($input: CreateCustomerGroupInput!) {
        createCustomerGroup(input: $input) {
            id
        }
    }
`);

export const updateCustomerGroupDocument = graphql(`
    mutation UpdateCustomerGroup($input: UpdateCustomerGroupInput!) {
        updateCustomerGroup(input: $input) {
            id
        }
    }
`);

export const deleteCustomerGroupDocument = graphql(`
    mutation DeleteCustomerGroup($id: ID!) {
        deleteCustomerGroup(id: $id) {
            result
            message
        }
    }
`);

export const deleteCustomerGroupsDocument = graphql(`
    mutation DeleteCustomerGroups($ids: [ID!]!) {
        deleteCustomerGroups(ids: $ids) {
            result
            message
        }
    }
`);
