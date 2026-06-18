import { graphql } from '@/vdb/graphql/graphql.js';

export const roleItemFragment = graphql(`
    fragment RoleItem on Role {
        id
        createdAt
        updatedAt
        code
        description
        permissions
        channels {
            id
            code
            token
        }
    }
`);

export const roleListQuery = graphql(
    `
        query RoleList($options: RoleListOptions) {
            roles(options: $options) {
                items {
                    ...RoleItem
                }
                totalItems
            }
        }
    `,
    [roleItemFragment],
);

export const roleDetailDocument = graphql(
    `
        query RoleDetail($id: ID!) {
            role(id: $id) {
                ...RoleItem
            }
        }
    `,
    [roleItemFragment],
);

export const createRoleDocument = graphql(`
    mutation RoleCreate($input: CreateRoleInput!) {
        createRole(input: $input) {
            id
        }
    }
`);

export const updateRoleDocument = graphql(`
    mutation UpdateRole($input: UpdateRoleInput!) {
        updateRole(input: $input) {
            id
        }
    }
`);

export const deleteRoleDocument = graphql(`
    mutation DeleteRole($id: ID!) {
        deleteRole(id: $id) {
            result
            message
        }
    }
`);

export const deleteRolesDocument = graphql(`
    mutation DeleteRoles($ids: [ID!]!) {
        deleteRoles(ids: $ids) {
            result
            message
        }
    }
`);
