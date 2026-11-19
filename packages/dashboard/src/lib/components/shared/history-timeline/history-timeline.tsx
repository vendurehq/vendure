import { ScrollArea } from '@/vdb/components/ui/scroll-area.js';
import { Timeline } from '@vendure-io/ui/components/molecules/timeline';

interface HistoryTimelineProps {
    children: React.ReactNode;
}

/**
 * The design-system Timeline of an order or customer history. Each child is a
 * HistoryEntry, which renders one TimelineItem.
 */
export function HistoryTimeline({ children }: Readonly<HistoryTimelineProps>) {
    return (
        <ScrollArea className="pr-2">
            <Timeline className="p-1">{children}</Timeline>
        </ScrollArea>
    );
}
