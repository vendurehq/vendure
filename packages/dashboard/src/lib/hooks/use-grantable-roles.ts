import { useCallback, useMemo } from 'react';

import { useAuth } from './use-auth.js';
import { useRoles } from './use-roles.js';

/**
 * Determines which Roles the active user may grant on which Channels. The rule mirrors the
 * server-side guard in `RoleService.assertActiveUserCanGrantRoles`: a Role may be granted on
 * a Channel only if the active user holds every one of that Role's permissions on that
 * Channel. The `me.channels` permissions already have the active user's global permissions
 * folded in, so a SuperAdmin needs no special case here.
 */
export function useGrantableRoles() {
    const { channels } = useAuth();
    const { roles } = useRoles();

    const permissionsByChannelId = useMemo(() => {
        const map = new Map<string, Set<string>>();
        for (const channel of channels ?? []) {
            map.set(channel.id, new Set<string>(channel.permissions));
        }
        return map;
    }, [channels]);

    const isRoleGrantableOnChannel = useCallback(
        (roleId: string, channelId: string) => {
            const role = roles.find(r => r.id === roleId);
            const heldPermissions = permissionsByChannelId.get(channelId);
            if (!role || !heldPermissions) {
                return false;
            }
            return role.permissions.every(permission => heldPermissions.has(permission));
        },
        [roles, permissionsByChannelId],
    );

    /**
     * The ids of the Roles which cannot be granted on every one of the given Channels, for
     * passing to a RoleSelector as `excludeIds`.
     */
    const nonGrantableRoleIds = useCallback(
        (channelIds: string[]) =>
            roles
                .filter(
                    role => !channelIds.every(channelId => isRoleGrantableOnChannel(role.id, channelId)),
                )
                .map(role => role.id),
        [roles, isRoleGrantableOnChannel],
    );

    /**
     * The ids of the Channels on which the given Role can be granted, for passing to a
     * ChannelSelector as `includeIds`. Without a Role, the Channels on which the active user
     * holds anything at all, since nothing can be granted on the others.
     */
    const grantableChannelIds = useCallback(
        (roleId?: string) => {
            const channelIds = Array.from(permissionsByChannelId.keys());
            if (!roleId) {
                return channelIds;
            }
            return channelIds.filter(channelId => isRoleGrantableOnChannel(roleId, channelId));
        },
        [permissionsByChannelId, isRoleGrantableOnChannel],
    );

    return { isRoleGrantableOnChannel, nonGrantableRoleIds, grantableChannelIds };
}
