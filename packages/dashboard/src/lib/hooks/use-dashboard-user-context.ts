import {
    buildDashboardUserContext,
    DashboardUserContext,
} from '@/vdb/framework/user-context/dashboard-user-context.js';
import { useAdminCustomFields } from '@/vdb/hooks/use-admin-custom-fields.js';
import { useAuth } from '@/vdb/hooks/use-auth.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { usePermissions } from '@/vdb/hooks/use-permissions.js';
import { useMemo } from 'react';

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
export function useDashboardUserContext(): { ctx: DashboardUserContext; ready: boolean } {
    const { user, channels } = useAuth();
    const { activeChannel } = useChannel();
    const { hasPermissions } = usePermissions();
    const { customFields, ready } = useAdminCustomFields();

    // useAuth().channels carries permissions; useChannel().activeChannel does not
    // (channelFragment has no `permissions` field), so resolve the active channel
    // against the permission-bearing list. Same idiom as usePermissions.
    const activeChannelWithPermissions = useMemo(
        () => (channels ?? []).find(c => c.id === activeChannel?.id),
        [channels, activeChannel?.id],
    );

    // Memoize on leaf values, not on the hook return objects. AuthProvider returns a
    // fresh object literal on every render, so depending on it directly would produce
    // a new context every render and re-run every visibility rule.
    const ctx = useMemo(
        () =>
            buildDashboardUserContext({
                administrator: user as any,
                channels: channels as any,
                activeChannel: activeChannelWithPermissions,
                customFields,
                hasPermissions,
            }),
        [user, channels, activeChannelWithPermissions, customFields, hasPermissions],
    );

    return { ctx, ready };
}
