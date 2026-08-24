import { Checkbox } from '@/vdb/components/ui/checkbox.js';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/vdb/components/ui/tooltip.js';
import { api } from '@/vdb/graphql/api.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { useGroupedPermissions } from '@/vdb/hooks/use-grouped-permissions.js';
import { useLingui } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';

const rolesByIdDocument = graphql(`
    query RolesById($options: RoleListOptions) {
        roles(options: $options) {
            items {
                id
                code
                permissions
            }
        }
    }
`);

interface RolePermissionsDisplayProps {
    value: string[];
}

export function RolePermissionsDisplay({ value = [] }: Readonly<RolePermissionsDisplayProps>) {
    const { i18n } = useLingui();
    const groupedPermissions = useGroupedPermissions();

    const { data } = useQuery({
        queryKey: ['rolesById', value],
        queryFn: () =>
            api.query(rolesByIdDocument, {
                options: {
                    filter: {
                        id: { in: value },
                    },
                },
            }),
    });

    const roles = data?.roles.items ?? [];

    // A Role is a channel-agnostic permission template: the Channels its permissions apply
    // to are determined per-user by RoleAssignments, so the display is the union of the
    // selected Roles' permissions.
    const isPermissionEnabled = (permissionName: string) =>
        roles.some(role => role.permissions.includes(permissionName as any));

    if (!roles.length) return null;

    return (
        <div className="rounded-md border w-full mt-4">
            <table className="w-full">
                <tbody>
                    {groupedPermissions.map((group, idx) => (
                        <tr
                            key={group.label}
                            className={idx !== groupedPermissions.length - 1 ? 'border-b' : undefined}
                        >
                            <td className="p-4">
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    {group.permissions.map(permission => (
                                        <div key={permission.name} className="flex items-center space-x-2">
                                            <Checkbox
                                                checked={isPermissionEnabled(permission.name)}
                                                disabled={true}
                                            />
                                            <TooltipProvider>
                                                <Tooltip>
                                                    <TooltipTrigger
                                                        render={
                                                            <label
                                                                className="text-sm cursor-default"
                                                                aria-label={i18n.t(permission.name)}
                                                            />
                                                        }
                                                    >
                                                        {i18n.t(permission.name)}
                                                    </TooltipTrigger>
                                                    <TooltipContent>
                                                        <p>{i18n.t(permission.description)}</p>
                                                    </TooltipContent>
                                                </Tooltip>
                                            </TooltipProvider>
                                        </div>
                                    ))}
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
