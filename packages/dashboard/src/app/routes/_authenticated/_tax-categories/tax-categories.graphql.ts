import { graphql } from '@/vdb/graphql/graphql.js';

export const taxCategoryItemFragment = graphql(`
    fragment TaxCategoryItem on TaxCategory {
        id
        createdAt
        updatedAt
        name
        isDefault
    }
`);

export const taxCategoryListQuery = graphql(
    `
        query TaxCategoryList($options: TaxCategoryListOptions) {
            taxCategories(options: $options) {
                items {
                    ...TaxCategoryItem
                }
                totalItems
            }
        }
    `,
    [taxCategoryItemFragment],
);

export const taxCategoryDetailDocument = graphql(`
    query TaxCategoryDetail($id: ID!) {
        taxCategory(id: $id) {
            id
            createdAt
            updatedAt
            name
            isDefault
            customFields
        }
    }
`);

export const createTaxCategoryDocument = graphql(`
    mutation CreateTaxCategory($input: CreateTaxCategoryInput!) {
        createTaxCategory(input: $input) {
            id
        }
    }
`);

export const updateTaxCategoryDocument = graphql(`
    mutation UpdateTaxCategory($input: UpdateTaxCategoryInput!) {
        updateTaxCategory(input: $input) {
            id
        }
    }
`);

export const deleteTaxCategoryDocument = graphql(`
    mutation DeleteTaxCategory($id: ID!) {
        deleteTaxCategory(id: $id) {
            result
            message
        }
    }
`);

export const deleteTaxCategoriesDocument = graphql(`
    mutation DeleteTaxCategories($ids: [ID!]!) {
        deleteTaxCategories(ids: $ids) {
            result
            message
        }
    }
`);
