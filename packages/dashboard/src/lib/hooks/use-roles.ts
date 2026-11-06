import { api } from '@/vdb/graphql/api.js';
import { graphql, ResultOf } from '@/vdb/graphql/graphql.js';
import { useQuery } from '@tanstack/react-query';

export const rolesDocument = graphql(`
    query Roles($options: RoleListOptions) {
        roles(options: $options) {
            totalItems
            items {
                id
                code
                description
                permissions
                channel {
                    id
                    code
                }
            }
        }
    }
`);

/**
 * Returns the Roles which the active user is permitted to read: the Roles owned by a Channel
 * on which the active user holds `ReadRole`, and the Roles they may grant somewhere. System
 * roles are always visible since they cannot be edited anyway. For actors holding neither
 * `ReadRole` nor `ReadAdministrator` the query is denied and this resolves to an empty list.
 */
export function useRoles() {
    const { data } = useQuery({
        queryKey: ['roles'],
        queryFn: fetchAllRoles,
    });

    return { roles: data ?? [] };
}

type RoleItem = ResultOf<typeof rolesDocument>['roles']['items'][number];

/**
 * Every consumer (RoleSelector, useGrantableRoles, the effective permissions panel) needs the
 * complete set: a Role missing from the list is treated as not grantable and not readable,
 * with no error. A marketplace with one Role per vendor passes 100 Roles quickly, so the list
 * is read in pages rather than with a single `take`.
 */
async function fetchAllRoles(): Promise<RoleItem[]> {
    const roles: RoleItem[] = [];
    let totalItems = Infinity;
    while (roles.length < totalItems) {
        const { roles: page } = await api.query(rolesDocument, {
            options: { skip: roles.length, take: ROLES_PAGE_SIZE, sort: { id: 'ASC' } },
        });
        totalItems = page.totalItems;
        if (page.items.length === 0) {
            break;
        }
        roles.push(...page.items);
    }
    return roles;
}

const ROLES_PAGE_SIZE = 100;
