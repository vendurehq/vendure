import { ScrollArea } from '@/vdb/components/ui/scroll-area.js';

interface HistoryTimelineProps {
    children: React.ReactNode;
}

export function HistoryTimeline({ children }: Readonly<HistoryTimelineProps>) {
    return (
        <ScrollArea className="pr-2">
            <div className="relative">
                <div className="absolute left-6 top-6 bottom-0 w-px bg-gradient-to-b from-border via-border/50 to-transparent" />
                <div className="space-y-0.5">{children}</div>
            </div>
        </ScrollArea>
    );
}
