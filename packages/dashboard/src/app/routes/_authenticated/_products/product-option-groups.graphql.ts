import { graphql } from '@/vdb/graphql/graphql.js';

export const productOptionGroupDetailDocument = graphql(`
    query ProductOptionGroupDetail($id: ID!) {
        productOptionGroup(id: $id) {
            id
            createdAt
            updatedAt
            name
            code
            productCount
            languageCode
            translations {
                id
                languageCode
                name
            }
            channels {
                id
                code
                token
            }
            customFields
        }
    }
`);

export const productIdNameDocument = graphql(`
    query ProductIdName($id: ID!) {
        product(id: $id) {
            id
            name
        }
    }
`);

export const productOptionGroupIdNameDocument = graphql(`
    query ProductOptionGroupIdName($id: ID!) {
        productOptionGroup(id: $id) {
            id
            name
        }
    }
`);

export const createProductOptionGroupDocument = graphql(`
    mutation CreateProductOptionGroup($input: CreateProductOptionGroupInput!) {
        createProductOptionGroup(input: $input) {
            id
        }
    }
`);

export const updateProductOptionGroupDocument = graphql(`
    mutation UpdateProductOptionGroup($input: UpdateProductOptionGroupInput!) {
        updateProductOptionGroup(input: $input) {
            id
        }
    }
`);

export const productOptionDetailDocument = graphql(`
    query ProductOptionDetail($id: ID!) {
        productOption(id: $id) {
            id
            createdAt
            updatedAt
            name
            code
            languageCode
            translations {
                id
                languageCode
                name
            }
            group {
                id
                name
                code
            }
            customFields
        }
    }
`);

export const createProductOptionDocument = graphql(`
    mutation CreateProductOption($input: CreateProductOptionInput!) {
        createProductOption(input: $input) {
            id
        }
    }
`);

export const updateProductOptionDocument = graphql(`
    mutation UpdateProductOption($input: UpdateProductOptionInput!) {
        updateProductOption(input: $input) {
            id
        }
    }
`);

export const deleteProductOptionDocument = graphql(`
    mutation DeleteProductOption($id: ID!) {
        deleteProductOption(id: $id) {
            result
            message
        }
    }
`);
