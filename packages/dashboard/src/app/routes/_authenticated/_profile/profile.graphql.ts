import { graphql } from '@/vdb/graphql/graphql.js';

export const activeAdministratorDocument = graphql(`
    query ActiveAdministrator {
        activeAdministrator {
            id
            createdAt
            updatedAt
            firstName
            lastName
            emailAddress
            customFields
            user {
                authenticationMethods {
                    id
                    strategy
                    createdAt
                }
            }
        }
    }
`);

export const updateActiveAdministratorDocument = graphql(`
    mutation UpdateActiveAdministrator($input: UpdateActiveAdministratorInput!) {
        updateActiveAdministrator(input: $input) {
            id
        }
    }
`);
