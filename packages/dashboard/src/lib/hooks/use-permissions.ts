import { useCallback } from 'react';

import { useAuth } from './use-auth.js';
import { useChannel } from './use-channel.js';

/**
 * @description
 * The return value of {@link usePermissions}.
 *
 * @docsCategory hooks
 * @docsPage usePermissions
 * @since 4.0.0
 */
export interface UsePermissionsResult {
    /**
     * @description
     * Whether the active user has any of the given permissions on the active channel.
     * Answers `false` until the permissions have loaded.
     */
    hasPermissions: (permissions: string[]) => boolean;
    /**
     * @description
     * `false` until the permissions of the active channel are known. Use it to tell a
     * missing permission from one that has not loaded yet, e.g. to keep the place of a
     * control that may appear.
     *
     * @since 4.0.0
     */
    permissionsLoaded: boolean;
}

/**
 * @description
 * Returns a `hasPermissions` function that can be used to determine whether the active user
 * has the given permissions on the active channel, and whether those permissions have loaded.
 *
 * @example
 * ```tsx
 * const { hasPermissions, permissionsLoaded } = usePermissions();
 *
 * const canReadChannel = hasPermissions(['ReadChannel']);
 * // false while loading, then the answer
 * const showSkeleton = !permissionsLoaded;
 * ```
 *
 * @docsCategory hooks
 * @docsPage usePermissions
 * @docsWeight 0
 * @since 3.3.0
 */
export function usePermissions(): UsePermissionsResult {
    const { channels } = useAuth();
    const { activeChannel } = useChannel();

    const hasPermissions = useCallback(
        (permissions: string[]) => {
            if (permissions.length === 0) {
                return true;
            }
            // Use the selected channel instead of settings.activeChannelId
            const selectedChannel = (channels ?? []).find(channel => channel.id === activeChannel?.id);
            if (!selectedChannel) {
                return false;
            }
            return permissions.some(permission =>
                selectedChannel.permissions.includes(
                    permission as (typeof selectedChannel.permissions)[number],
                ),
            );
        },
        [channels, activeChannel?.id],
    );

    // `hasPermissions` answers false until the active channel is found among the
    // administrator's channels. This tells that apart from a missing permission.
    const permissionsLoaded = (channels ?? []).some(channel => channel.id === activeChannel?.id);

    return { hasPermissions, permissionsLoaded };
}
