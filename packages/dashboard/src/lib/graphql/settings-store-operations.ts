import { graphql } from './graphql.js';

export const getSettingsStoreValueDocument = graphql(`
    query GetSettingsStoreValue($key: String!) {
        getSettingsStoreValue(key: $key)
    }
`);

export const setSettingsStoreValueDocument = graphql(`
    mutation SetSettingsStoreValue($input: SettingsStoreInput!) {
        setSettingsStoreValue(input: $input) {
            key
            result
            error
        }
    }
`);
