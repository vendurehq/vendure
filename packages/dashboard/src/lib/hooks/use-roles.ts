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
 * Role if the active user holds its full set of permissions on at least one Channel, so this
 * is already narrowed to the Roles they could grant somewhere.
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
