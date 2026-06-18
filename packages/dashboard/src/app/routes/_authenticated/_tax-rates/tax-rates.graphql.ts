import { graphql } from '@/vdb/graphql/graphql.js';

export const taxRateItemFragment = graphql(`
    fragment TaxRateItem on TaxRate {
        id
        createdAt
        updatedAt
        name
        enabled
        value
        category {
            id
            name
        }
        zone {
            id
            name
        }
        customerGroup {
            id
            name
        }
    }
`);

export const taxRateListQuery = graphql(
    `
        query TaxRateList($options: TaxRateListOptions) {
            taxRates(options: $options) {
                items {
                    ...TaxRateItem
                }
                totalItems
            }
        }
    `,
    [taxRateItemFragment],
);

export const taxRateDetailDocument = graphql(
    `
        query TaxRateDetail($id: ID!) {
            taxRate(id: $id) {
                ...TaxRateItem
                customFields
            }
        }
    `,
    [taxRateItemFragment],
);

export const createTaxRateDocument = graphql(`
    mutation CreateTaxRate($input: CreateTaxRateInput!) {
        createTaxRate(input: $input) {
            id
        }
    }
`);

export const updateTaxRateDocument = graphql(`
    mutation UpdateTaxRate($input: UpdateTaxRateInput!) {
        updateTaxRate(input: $input) {
            id
        }
    }
`);

export const deleteTaxRateDocument = graphql(`
    mutation DeleteTaxRate($id: ID!) {
        deleteTaxRate(id: $id) {
            result
            message
        }
    }
`);

export const deleteTaxRatesDocument = graphql(`
    mutation DeleteTaxRates($ids: [ID!]!) {
        deleteTaxRates(ids: $ids) {
            result
            message
        }
    }
`);
