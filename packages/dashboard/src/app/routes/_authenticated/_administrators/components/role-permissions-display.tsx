import { ChannelCodeLabel } from '@/vdb/components/shared/channel-code-label.js';
import { Checkbox } from '@/vdb/components/ui/checkbox.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/vdb/components/ui/tabs.js';
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
                channels {
                    id
                    code
                }
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

    const allChannels = roles
        .flatMap(role => role.channels)
        .filter((channel, index, self) => index === self.findIndex(t => t.code === channel.code));

    const isPermissionEnabled = (permissionName: string, channelCode: string) => {
        // Check if any role has this permission for this channel
        return roles.some(role => {
            const hasPermission = role.permissions.includes(permissionName as any);
            const isChannelSpecificRole = role.channels.length > 0;

            if (!hasPermission) return false;

            if (!isChannelSpecificRole) {
                // If role is not channel-specific, permission applies to all channels
                return true;
            }

            // Check if the role applies to this specific channel
            return role.channels.some(channel => channel.code === channelCode);
        });
    };

    if (!allChannels.length) return null;

    return (
        <Tabs defaultValue={allChannels[0].code} className="w-full mt-4">
            <TabsList>
                {allChannels.map(channel => (
                    <TabsTrigger key={channel.code} value={channel.code}>
                        <ChannelCodeLabel code={channel.code} />
                    </TabsTrigger>
                ))}
            </TabsList>
            {allChannels.map(channel => (
                <TabsContent key={channel.code} value={channel.code} className="mt-0">
                    <div className="rounded-md border">
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
                                                {group.permissions.map(permission => (
                                                    <div
                                                        key={permission.name}
                                                        className="flex items-center space-x-2"
                                                    >
                                                        <Checkbox
                                                            checked={isPermissionEnabled(
                                                                permission.name,
                                                                channel.code,
                                                            )}
                                                            disabled={true}
                                                        />
                                                        <TooltipProvider>
                                                            <Tooltip>
                                                                <TooltipTrigger render={<label className="text-sm cursor-default" aria-label={i18n.t(permission.name)} />}>
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
                </TabsContent>
            ))}
        </Tabs>
    );
}
