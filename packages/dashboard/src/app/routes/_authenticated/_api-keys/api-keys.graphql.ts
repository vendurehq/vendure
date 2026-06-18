import { graphql } from '@/vdb/graphql/graphql.js';

export const apiKeyItemFragment = graphql(`
    fragment ApiKeyItem on ApiKey {
        id
        createdAt
        updatedAt
        lookupId
        lastUsedAt
        name
        owner {
            id
            identifier
        }
    }
`);

export const apiKeyListQuery = graphql(
    `
        query ApiKeyList($options: ApiKeyListOptions) {
            apiKeys(options: $options) {
                items {
                    ...ApiKeyItem
                }
                totalItems
            }
        }
    `,
    [apiKeyItemFragment],
);

export const apiKeyDetailDocument = graphql(`
    query ApiKeyDetail($id: ID!) {
        apiKey(id: $id) {
            id
            createdAt
            updatedAt
            lookupId
            lastUsedAt
            name
            owner {
                id
                identifier
            }
            user {
                id
                roles {
                    id
                    code
                    description
                }
            }
            translations {
                id
                languageCode
                name
            }
            customFields
        }
    }
`);

export const updateApiKeyDocument = graphql(`
    mutation UpdateApiKey($input: UpdateApiKeyInput!) {
        updateApiKey(input: $input) {
            id
        }
    }
`);

export const createApiKeyDocument = graphql(`
    mutation CreateApiKey($input: CreateApiKeyInput!) {
        createApiKey(input: $input) {
            apiKey
            entityId
        }
    }
`);

export const rotateApiKeyDocument = graphql(`
    mutation RotateApiKey($id: ID!) {
        rotateApiKey(id: $id) {
            apiKey
        }
    }
`);

export const deleteApiKeysDocument = graphql(`
    mutation DeleteApiKeys($ids: [ID!]!) {
        deleteApiKeys(ids: $ids) {
            result
            message
        }
    }
`);

export const activeAdministratorRolesDocument = graphql(`
    query ActiveAdministratorRoles {
        activeAdministrator {
            id
            user {
                id
                roles {
                    id
                    code
                    description
                }
            }
        }
    }
`);
