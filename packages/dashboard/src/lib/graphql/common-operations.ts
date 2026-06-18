import { configArgDefinitionFragment } from '@/vdb/graphql/fragments.js';

import { graphql } from './graphql.js';

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
