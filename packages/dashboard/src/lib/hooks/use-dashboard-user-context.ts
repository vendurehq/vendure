import { SUPER_ADMIN_ROLE_CODE } from '@/vdb/constants.js';
import {
    buildDashboardUserContext,
    DashboardUserContext,
    DashboardUserRole,
} from '@/vdb/framework/user-context/dashboard-user-context.js';
import { useAdminCustomFields } from '@/vdb/hooks/use-admin-custom-fields.js';
import { useAuth } from '@/vdb/hooks/use-auth.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { usePermissions } from '@/vdb/hooks/use-permissions.js';
import { useMemo } from 'react';

/**
 * @description
 * Options for {@link useDashboardUserContext}.
 *
 * @docsCategory hooks
 * @docsPage useDashboardUserContext
 * @since 3.8.0
 */
export interface DashboardUserContextOptions {
    /**
     * @description
     * Whether to load the administrator's custom fields. Pass false when your rules only
     * read roles, channels or permissions: it saves an Admin API request, and
     * `ctx.administrator.customFields` is then undefined while `ready` is true immediately.
     *
     * @default true
     */
    includeCustomFields?: boolean;
}

/**
 * @description
 * Returns the {@link DashboardUserContext} for the logged-in administrator, plus a
 * `ready` flag which is false while Administrator custom fields are still loading.
 *
 * Callers must not evaluate user-dependent rules until `ready` is true, otherwise
 * rules that read `customFields` will briefly see them absent.
 *
 * Must be called inside `ChannelProvider`, which sits inside `AuthProvider`. Login
 * extensions render outside both and cannot use this hook.
 *
 * @docsCategory hooks
 * @docsPage useDashboardUserContext
 * @docsWeight 0
 * @since 3.8.0
 */
export function useDashboardUserContext(options?: DashboardUserContextOptions): {
    ctx: DashboardUserContext;
    ready: boolean;
} {
    // Read the flag out of `options` rather than passing the object down: callers
    // construct it inline, so its identity changes on every render.
    const includeCustomFields = options?.includeCustomFields ?? true;
    const { user, channels } = useAuth();
    const { activeChannel } = useChannel();
    const { hasPermissions } = usePermissions();
    const { customFields, ready } = useAdminCustomFields({ enabled: includeCustomFields });

    // useAuth().channels carries permissions; useChannel().activeChannel does not
    // (channelFragment has no `permissions` field), so resolve the active channel
    // against the permission-bearing list. Same idiom as usePermissions.
    const activeChannelWithPermissions = useMemo(
        () => (channels ?? []).find(c => c.id === activeChannel?.id),
        [channels, activeChannel?.id],
    );

    // Roles are granted per Channel through RoleAssignments, so a Role's Channels are the
    // Channels of the administrator's assignments of it. The SuperAdmin Role is held on every
    // Channel, although it is stored as a single default-channel assignment.
    const administrator = useMemo(() => {
        if (!user) {
            return undefined;
        }
        const roles = new Map<string, DashboardUserRole>();
        for (const { channelId, role } of user.user.roleAssignments) {
            const entry = roles.get(role.id) ?? { ...role, channels: [] };
            entry.channels.push({ id: channelId });
            roles.set(role.id, entry);
        }
        for (const role of roles.values()) {
            if (role.code === SUPER_ADMIN_ROLE_CODE) {
                role.channels = (channels ?? []).map(c => ({ id: c.id }));
            }
        }
        return { ...user, user: { ...user.user, roles: [...roles.values()] } };
    }, [user, channels]);

    // Memoize on leaf values, not on the hook return objects. AuthProvider returns a
    // fresh object literal on every render, so depending on it directly would produce
    // a new context every render and re-run every visibility rule.
    const ctx = useMemo(
        () =>
            buildDashboardUserContext({
                administrator,
                channels: channels ?? undefined,
                activeChannel: activeChannelWithPermissions,
                customFields,
                hasPermissions,
            }),
        [administrator, channels, activeChannelWithPermissions, customFields, hasPermissions],
    );

    return { ctx, ready };
}
