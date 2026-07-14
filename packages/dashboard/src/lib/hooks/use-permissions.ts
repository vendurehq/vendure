import { useCallback } from 'react';

import { useAuth } from './use-auth.js';
import { useChannel } from './use-channel.js';

/**
 * @description
 * Returns a `hasPermissions` function that can be used to determine whether the active user
 * has the given permissions on the active channel.
 *
 * @example
 * ```tsx
 * const { hasPermissions } = usePermissions();
 *
 * const canReadChannel = hasPermissions(['ReadChannel']);
 * ```
 *
 * @docsCategory hooks
 * @docsPage usePermissions
 * @docsWeight 0
 * @since 3.3.0
 */
export function usePermissions() {
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

    return { hasPermissions };
}
