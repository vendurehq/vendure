import { ChannelContext } from '@/vdb/providers/channel-provider.js';
import * as React from 'react';

// Hook to use the channel context

/**
 * @description
 * Provides access to the {@link ChannelContext} which contains information
 * about the active channel.
 *
 * @example
 * ```tsx
 * const { activeChannel } = useChannel();
 * ```
 *
 * @docsCategory hooks
 * @docsPage useChannel
 * @docsWeight 0
 * @since 3.3.0
 */
export function useChannel() {
    const context = React.useContext(ChannelContext);
    if (context === undefined) {
        throw new Error('useChannel must be used within a ChannelProvider');
    }
    return context;
}
