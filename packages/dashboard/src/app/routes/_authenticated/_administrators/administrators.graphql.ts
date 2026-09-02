import { graphql } from '@/vdb/graphql/graphql.js';

export const administratorItemFragment = graphql(`
    fragment AdministratorItem on Administrator {
        id
        createdAt
        updatedAt
        firstName
        lastName
        emailAddress
        user {
            id
            identifier
            lastLogin
            roles {
                id
                createdAt
                updatedAt
                code
                description
            }
        }
    }
`);

export const administratorListDocument = graphql(
    `
        query AdministratorList($options: AdministratorListOptions) {
            administrators(options: $options) {
                items {
                    ...AdministratorItem
                }
                totalItems
            }
        }
    `,
    [administratorItemFragment],
);

export const administratorDetailDocument = graphql(
    `
        query AdministratorDetail($id: ID!) {
            administrator(id: $id) {
                ...AdministratorItem
                user {
                    id
                    roleAssignments {
                        id
                        roleId
                        channelId
                        role {
                            id
                            code
                            description
                        }
                        channel {
                            id
                            code
                        }
                    }
                }
                customFields
            }
        }
    `,
    [administratorItemFragment],
);

export const createAdministratorDocument = graphql(`
    mutation CreateAdministrator($input: CreateAdministratorInput!) {
        createAdministrator(input: $input) {
            id
        }
    }
`);

export const updateAdministratorDocument = graphql(`
    mutation UpdateAdministrator($input: UpdateAdministratorInput!) {
        updateAdministrator(input: $input) {
            id
        }
    }
`);

export const deleteAdministratorDocument = graphql(`
    mutation DeleteAdministrator($id: ID!) {
        deleteAdministrator(id: $id) {
            result
            message
        }
    }
`);

export const deleteAdministratorsDocument = graphql(`
    mutation DeleteAdministrators($ids: [ID!]!) {
        deleteAdministrators(ids: $ids) {
            result
            message
        }
    }
`);
