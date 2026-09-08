import { graphql } from '@/vdb/graphql/graphql.js';

export const latestCustomersQuery = graphql(`
    query GetLatestCustomers($options: CustomerListOptions) {
        customers(options: $options) {
            totalItems
            items {
                id
                createdAt
                firstName
                lastName
                emailAddress
            }
        }
    }
`);
