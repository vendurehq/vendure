import { Badge } from '@/vdb/components/ui/badge.js';
import { X } from 'lucide-react';
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
export function ChannelChip({
    channel,
    removable = true,
    onRemove,
}: Readonly<ChannelChipProps>) {
    return (
        <Badge
            variant="secondary"
            className="flex items-center gap-2 py-0.5 pl-2 pr-1 h-6 hover:bg-secondary/80"
        >
            <div className="flex items-center gap-1.5">
                <span className="font-medium">{channel.code}</span>
            </div>
            {removable && (
                <button
                    type="button"
                    className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-muted/30 hover:cursor-pointer"
                    onClick={() => onRemove?.(channel.id)}
                    aria-label={`Remove ${channel.code} from ${channel.token}`}
                >
                    <X className="h-3 w-3" />
                </button>
            )}
        </Badge>
    );
}
