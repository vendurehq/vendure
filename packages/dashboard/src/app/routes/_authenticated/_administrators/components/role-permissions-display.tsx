import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/vdb/components/ui/tooltip.js';
import { api } from '@/vdb/graphql/api.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { useGroupedPermissions } from '@/vdb/hooks/use-grouped-permissions.js';
import { cn } from '@/vdb/lib/utils.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import { Check, Minus } from 'lucide-react';
import { useState } from 'react';

const rolesByIdDocument = graphql(`
    query RolesById($options: RoleListOptions) {
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

interface RolePermissionsDisplayProps {
    value: string[];
}

const CRUD_ORDER = ['Create', 'Read', 'Update', 'Delete'];

/**
 * Read-only view of the permissions granted by a set of Roles. Shows only the granted
 * permissions by default, with a toggle to the full permission list for auditing what
 * is NOT granted.
 *
 * A Role is a channel-agnostic permission template: the Channels its permissions apply
 * to are determined per-user by RoleAssignments, so the caller passes the Roles granted
 * on one Channel and this is their union on that Channel.
 */
export function RolePermissionsDisplay({ value = [] }: Readonly<RolePermissionsDisplayProps>) {
    const { i18n, t } = useLingui();
    const groupedPermissions = useGroupedPermissions();
    const [showAll, setShowAll] = useState(false);

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

    const grantingRoles = (permissionName: string) =>
        roles.filter(role => role.permissions.includes(permissionName as any));

    if (!roles.length) return null;

    // CRUD groups carry the entity name in the group label, so their chips show just the
    // action. Non-CRUD permissions form single-permission groups whose label IS the name.
    const crudActionLabels: Record<string, string> = {
        Create: t`Create`,
        Read: t`Read`,
        Update: t`Update`,
        Delete: t`Delete`,
    };
    const actionLabel = (permissionName: string) => {
        const action = CRUD_ORDER.find(prefix => permissionName.startsWith(prefix));
        return action ? crudActionLabels[action] : i18n.t(permissionName);
    };
    const sortCrud = (permissions: typeof groupedPermissions[number]['permissions']) =>
        [...permissions].sort(
            (a, b) =>
                CRUD_ORDER.findIndex(p => a.name.startsWith(p)) -
                CRUD_ORDER.findIndex(p => b.name.startsWith(p)),
        );

    const grantedGroups = groupedPermissions
        .map(group => ({
            ...group,
            granted: sortCrud(group.permissions).filter(p => grantingRoles(p.name).length > 0),
        }))
        .filter(group => group.granted.length > 0);

    const permissionTooltip = (permission: { name: string; description: string }, granted: boolean) => (
        <TooltipContent side="top" className="max-w-[250px]">
            <div className="text-xs">
                <div className="font-medium">{i18n.t(permission.name)}</div>
                <div className="text-accent-foreground/70 mt-1">{i18n.t(permission.description)}</div>
                {granted && (
                    <div className="text-accent-foreground/70 mt-1">
                        <Trans>
                            Granted by{' '}
                            {grantingRoles(permission.name)
                                .map(role => role.description || role.code)
                                .join(', ')}
                        </Trans>
                    </div>
                )}
            </div>
        </TooltipContent>
    );

    return (
        <TooltipProvider>
            <div className="flex flex-col items-start gap-2 w-full">
                <div className="rounded-md border w-full">
                    {showAll ? (
                        <table className="w-full">
                            <tbody>
                                {groupedPermissions.map((group, idx) => (
                                    <tr
                                        key={group.label}
                                        className={
                                            idx !== groupedPermissions.length - 1 ? 'border-b' : undefined
                                        }
                                    >
                                        <td className="p-4">
                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                                {sortCrud(group.permissions).map(permission => {
                                                    const granted =
                                                        grantingRoles(permission.name).length > 0;
                                                    return (
                                                        <div
                                                            key={permission.name}
                                                            className="flex items-center space-x-2"
                                                        >
                                                            {granted ? (
                                                                <Check className="h-4 w-4 text-success shrink-0" />
                                                            ) : (
                                                                <Minus className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                                                            )}
                                                            <Tooltip>
                                                                <TooltipTrigger
                                                                    render={
                                                                        <span
                                                                            className={cn(
                                                                                'text-sm cursor-default',
                                                                                !granted &&
                                                                                    'text-muted-foreground',
                                                                            )}
                                                                        />
                                                                    }
                                                                >
                                                                    {i18n.t(permission.name)}
                                                                </TooltipTrigger>
                                                                {permissionTooltip(permission, granted)}
                                                            </Tooltip>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : grantedGroups.length === 0 ? (
                        <p className="p-4 text-sm text-muted-foreground">
                            <Trans>The assigned roles grant no permissions on this channel.</Trans>
                        </p>
                    ) : (
                        grantedGroups.map((group, idx) => {
                            const isSingleNonCrud =
                                group.granted.length === 1 && group.granted[0].name === group.label;
                            return (
                                <div
                                    key={group.label}
                                    className={cn(
                                        'flex flex-wrap items-center gap-x-4 gap-y-2 p-3',
                                        idx !== grantedGroups.length - 1 && 'border-b',
                                    )}
                                >
                                    <div className="flex items-center gap-2 w-56 shrink-0">
                                        <Check className="h-4 w-4 text-success shrink-0" />
                                        {isSingleNonCrud ? (
                                            <Tooltip>
                                                <TooltipTrigger
                                                    render={
                                                        <span className="text-sm font-medium cursor-default" />
                                                    }
                                                >
                                                    {i18n.t(group.label)}
                                                </TooltipTrigger>
                                                {permissionTooltip(group.granted[0], true)}
                                            </Tooltip>
                                        ) : (
                                            <span className="text-sm font-medium">
                                                {i18n.t(group.label)}
                                            </span>
                                        )}
                                    </div>
                                    {!isSingleNonCrud && (
                                        <div className="flex flex-wrap gap-1.5">
                                            {group.granted.map(permission => (
                                                <Tooltip key={permission.name}>
                                                    <TooltipTrigger
                                                        render={<span className="inline-flex" />}
                                                    >
                                                        <Badge
                                                            variant="secondary"
                                                            className="cursor-default"
                                                        >
                                                            {actionLabel(permission.name)}
                                                        </Badge>
                                                    </TooltipTrigger>
                                                    {permissionTooltip(permission, true)}
                                                </Tooltip>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowAll(current => !current)}>
                    {showAll ? <Trans>Show granted only</Trans> : <Trans>Show all permissions</Trans>}
                </Button>
            </div>
        </TooltipProvider>
    );
}
