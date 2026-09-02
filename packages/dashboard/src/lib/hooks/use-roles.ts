import { api } from '@/vdb/graphql/api.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { useQuery } from '@tanstack/react-query';

export const rolesDocument = graphql(`
    query Roles($options: RoleListOptions) {
        roles(options: $options) {
            items {
                id
                code
                description
                permissions
            }
        }
    }
`);

/**
 * Returns the Roles which the active user is permitted to read. The server only returns a
 * Role if the active user holds the `ReadRole` permission on every Channel on which that
 * Role is currently assigned (Roles without assignments are visible to any `ReadRole`
 * holder, and system roles are always visible since they cannot be edited anyway). For
 * actors without `ReadRole` the query is denied and this resolves to an empty list.
 */
export function useRoles() {
    const { data } = useQuery({
        queryKey: ['roles'],
        queryFn: () =>
            api.query(rolesDocument, {
                options: {
                    // TODO: an instance with more than 100 Roles silently loses the rest here,
                    // affecting every consumer (RoleSelector, useGrantableRoles). Paginate or
                    // switch the selectors to server-side search.
                    take: 100,
                },
            }),
        select: data => data.roles.items,
    });

    return { roles: data ?? [] };
}
