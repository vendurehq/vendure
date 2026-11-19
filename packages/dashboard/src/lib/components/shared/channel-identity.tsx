import { Avatar, AvatarFallback } from '@/vdb/components/ui/avatar.js';
import { ChannelColor } from '@/vdb/hooks/use-channel-colors.js';
import { cn } from '@/vdb/lib/utils.js';
import { Store } from 'lucide-react';

const colorClasses: Record<ChannelColor, string> = {
    neutral: 'bg-muted-foreground',
    'viz-1': 'bg-chart-1',
    'viz-2': 'bg-chart-2',
    'viz-3': 'bg-chart-3',
    'viz-4': 'bg-chart-4',
    'viz-5': 'bg-chart-5',
};

export function ChannelIdentity({ color, className }: { color: ChannelColor; className?: string }) {
    return (
        <Avatar shape="square" className={className}>
            <AvatarFallback>
                <Store className="size-4" aria-hidden="true" />
            </AvatarFallback>
            <span
                className={cn(
                    'absolute -bottom-1 -right-1 size-3.5 rounded-full border-2 border-background',
                    colorClasses[color],
                )}
            />
        </Avatar>
    );
}

export function ChannelColorSwatch({ color }: { color: ChannelColor }) {
    return (
        <span
            className={cn(
                'inline-flex size-4 shrink-0 rounded-full border border-border/40',
                colorClasses[color],
            )}
            aria-hidden="true"
        />
    );
}
