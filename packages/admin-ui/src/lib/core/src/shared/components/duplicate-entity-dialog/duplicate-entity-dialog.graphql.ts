import { gql } from 'apollo-angular';

export const GET_ENTITY_DUPLICATORS = gql`
    query GetEntityDuplicators {
        entityDuplicators {
            code
            description
            forEntities
            requiresPermission
            args {
                name
                type
                required
                defaultValue
                list
                ui
                label
                description
            }
        }
    }
`;

export const DUPLICATE_ENTITY = gql`
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
`;
