import { useAlerts } from '@/vdb/hooks/use-alerts.js';
import { cn } from '@/vdb/lib/utils.js';

export function AlertsIndicator() {
    const { activeCount, highestSeverity } = useAlerts();

    if (activeCount === 0) {
        return null;
    }

    return (
        <div
            className={cn(
                `absolute -right-1 -top-1 rounded-full bg-primary text-xs w-4 h-4 flex items-center justify-center`,
                highestSeverity === 'error' && 'bg-destructive',
                highestSeverity === 'warning' && 'bg-warning',
            )}
        >
            {activeCount}
        </div>
    );
}
