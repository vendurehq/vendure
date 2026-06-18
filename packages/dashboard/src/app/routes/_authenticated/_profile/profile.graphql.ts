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

export const updateAdministratorDocument = graphql(`
    mutation UpdateAdministrator($input: UpdateAdministratorInput!) {
        updateAdministrator(input: $input) {
            id
        }
    }
`);
