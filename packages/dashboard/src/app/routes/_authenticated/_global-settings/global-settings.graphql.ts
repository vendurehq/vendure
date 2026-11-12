import { graphql } from '@/vdb/graphql/graphql.js';

export const globalSettingsDocument = graphql(`
    query GlobalSettings {
        globalSettings {
            id
            availableLanguages
            outOfStockThreshold
            customFields
        }
    }
`);

export const updateGlobalSettingsDocument = graphql(`
    mutation UpdateGlobalSettings($input: UpdateGlobalSettingsInput!) {
        updateGlobalSettings(input: $input) {
            __typename
            ... on GlobalSettings {
                id
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`);
