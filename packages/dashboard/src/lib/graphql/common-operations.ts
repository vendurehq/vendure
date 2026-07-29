import { configArgDefinitionFragment } from '@/vdb/graphql/fragments.js';

import { graphql } from './graphql.js';
import { VariablesOf } from 'gql.tada';

export const duplicateEntityDocument = graphql(`
    mutation DuplicateEntity($input: DuplicateEntityInput!) {
        duplicateEntity(input: $input) {
            ... on DuplicateEntitySuccess {
                newEntityId
            }
            ... on ErrorResult {
                errorCode
                message
            }
            ... on DuplicateEntityError {
                duplicationError
            }
        }
    }
`);

export const getEntityDuplicatorsDocument = graphql(
    `
        query GetEntityDuplicators {
            entityDuplicators {
                code
                description
                requiresPermission
                forEntities
                args {
                    ...ConfigArgDefinition
                }
            }
        }
    `,
    [configArgDefinitionFragment],
);

// Type-anchor documents: these lightweight mutations exist solely to derive
// TypeScript input types from the GraphQL schema via `VariablesOf`.
// They are never executed at runtime.

const createCustomerInputDocument = graphql(`
    mutation CreateCustomerInputTypeRef($input: CreateCustomerInput!) {
        createCustomer(input: $input) {
            __typename
        }
    }
`);

/**
 * @description
 * The `CreateCustomerInput` type extracted from the GraphQL schema.
 */
export type CreateCustomerInput = VariablesOf<typeof createCustomerInputDocument>['input'];

const createAddressInputDocument = graphql(`
    mutation CreateAddressInputTypeRef($customerId: ID!, $input: CreateAddressInput!) {
        createCustomerAddress(customerId: $customerId, input: $input) {
            __typename
        }
    }
`);

/**
 * @description
 * The `CreateAddressInput` type extracted from the GraphQL schema.
 */
export type CreateAddressInput = VariablesOf<typeof createAddressInputDocument>['input'];
