import { graphql } from '@/vdb/graphql/graphql.js';

export const customerListDocument = graphql(`
    query GetCustomerList($options: CustomerListOptions) {
        customers(options: $options) {
            items {
                id
                createdAt
                updatedAt
                firstName
                lastName
                emailAddress
                phoneNumber
                groups {
                    id
                    name
                }
                user {
                    id
                    verified
                }
            }
            totalItems
        }
    }
`);

export const addressFragment = graphql(`
    fragment Address on Address {
        id
        createdAt
        updatedAt
        fullName
        company
        streetLine1
        streetLine2
        city
        province
        postalCode
        country {
            id
            code
            name
        }
        phoneNumber
        defaultShippingAddress
        defaultBillingAddress
    }
`);

export const customerDetailDocument = graphql(
    `
        query GetCustomerDetail($id: ID!) {
            customer(id: $id) {
                id
                createdAt
                updatedAt
                title
                firstName
                lastName
                phoneNumber
                emailAddress
                groups {
                    id
                    name
                }
                user {
                    id
                    identifier
                    verified
                    lastLogin
                }
                addresses {
                    ...Address
                }
                customFields
            }
        }
    `,
    [addressFragment],
);

export const customerOrderListDocument = graphql(`
    query GetCustomerOrderList($options: OrderListOptions, $customerId: ID!) {
        customer(id: $customerId) {
            id
            orders(options: $options) {
                items {
                    id
                    createdAt
                    updatedAt
                    type
                    code
                    orderPlacedAt
                    state
                    total
                    totalWithTax
                    currencyCode
                }
                totalItems
            }
        }
    }
`);

export const createCustomerDocument = graphql(`
    mutation CreateCustomer($input: CreateCustomerInput!) {
        createCustomer(input: $input) {
            __typename
            ... on Customer {
                id
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`);

export const updateCustomerDocument = graphql(`
    mutation UpdateCustomer($input: UpdateCustomerInput!) {
        updateCustomer(input: $input) {
            __typename
            ... on Customer {
                id
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`);

export const deleteCustomerDocument = graphql(`
    mutation DeleteCustomer($id: ID!) {
        deleteCustomer(id: $id) {
            result
            message
        }
    }
`);

export const createCustomerAddressDocument = graphql(`
    mutation CreateCustomerAddress($customerId: ID!, $input: CreateAddressInput!) {
        createCustomerAddress(customerId: $customerId, input: $input) {
            id
        }
    }
`);

export const updateCustomerAddressDocument = graphql(`
    mutation UpdateCustomerAddress($input: UpdateAddressInput!) {
        updateCustomerAddress(input: $input) {
            id
        }
    }
`);

export const deleteCustomerAddressDocument = graphql(`
    mutation DeleteCustomerAddress($id: ID!) {
        deleteCustomerAddress(id: $id) {
            success
        }
    }
`);

export const customerHistoryDocument = graphql(`
    query GetCustomerHistory($id: ID!, $options: HistoryEntryListOptions) {
        customer(id: $id) {
            id
            createdAt
            updatedAt
            firstName
            lastName
            history(options: $options) {
                totalItems
                items {
                    id
                    type
                    createdAt
                    isPublic
                    administrator {
                        id
                        firstName
                        lastName
                    }
                    data
                }
            }
        }
    }
`);

export const addCustomerToGroupDocument = graphql(`
    mutation AddCustomerToGroup($customerId: ID!, $groupId: ID!) {
        addCustomersToGroup(customerIds: [$customerId], customerGroupId: $groupId) {
            id
        }
    }
`);

export const removeCustomerFromGroupDocument = graphql(`
    mutation RemoveCustomerFromGroup($customerId: ID!, $groupId: ID!) {
        removeCustomersFromGroup(customerIds: [$customerId], customerGroupId: $groupId) {
            id
        }
    }
`);

export const deleteCustomersDocument = graphql(`
    mutation DeleteCustomers($ids: [ID!]!) {
        deleteCustomers(ids: $ids) {
            result
            message
        }
    }
`);
