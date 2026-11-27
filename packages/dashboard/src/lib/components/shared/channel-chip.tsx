import { Chip, type ChipRemoveProps } from '@/vdb/components/ui/chip.js';
import type { SimpleChannel } from '@/vdb/providers/channel-provider.js';

interface ChannelChipProps {
    channel: SimpleChannel;
    removable?: boolean;
    onRemove?: (id: string) => void;
}

/**
 * @description
 * A component for displaying a channel as a chip.
 *
 * @docsCategory components
 * @since 3.5.2
 */
export function ChannelChip({ channel, removable = true, onRemove }: Readonly<ChannelChipProps>) {
    const removeProps: ChipRemoveProps =
        removable && onRemove
            ? {
                  onRemove: () => onRemove(channel.id),
                  removeLabel: `Remove ${channel.code} from ${channel.token}`,
              }
            : {};
    return <Chip {...removeProps}>{channel.code}</Chip>;
}
