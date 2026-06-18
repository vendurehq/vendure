import { graphql } from '@/vdb/graphql/graphql.js';

export const countryItemFragment = graphql(`
    fragment CountryItem on Country {
        id
        createdAt
        updatedAt
        name
        code
        enabled
        customFields
    }
`);

export const countriesListQuery = graphql(
    `
        query CountriesList($options: CountryListOptions) {
            countries(options: $options) {
                items {
                    ...CountryItem
                }
                totalItems
            }
        }
    `,
    [countryItemFragment],
);

export const countryDetailDocument = graphql(`
    query CountryDetail($id: ID!) {
        country(id: $id) {
            id
            name
            code
            enabled
            translations {
                id
                createdAt
                updatedAt
                languageCode
                name
            }
            createdAt
            updatedAt
            customFields
        }
    }
`);

export const createCountryDocument = graphql(`
    mutation CreateCountry($input: CreateCountryInput!) {
        createCountry(input: $input) {
            id
        }
    }
`);

export const updateCountryDocument = graphql(`
    mutation UpdateCountry($input: UpdateCountryInput!) {
        updateCountry(input: $input) {
            id
        }
    }
`);

export const deleteCountryDocument = graphql(`
    mutation DeleteCountry($id: ID!) {
        deleteCountry(id: $id) {
            result
            message
        }
    }
`);

export const deleteCountriesDocument = graphql(`
    mutation DeleteCountries($ids: [ID!]!) {
        deleteCountries(ids: $ids) {
            result
            message
        }
    }
`);
