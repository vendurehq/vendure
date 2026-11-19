import { CountBadge } from '@/vdb/components/ui/count-badge.js';
import { useAlerts } from '@/vdb/hooks/use-alerts.js';

const toneBySeverity = { error: 'critical', warning: 'warning', info: 'neutral' } as const;

export function AlertsIndicator() {
    const { activeCount, highestSeverity } = useAlerts();

    return (
        <CountBadge
            count={activeCount}
            tone={toneBySeverity[highestSeverity]}
            placement="corner"
        />
    );
}
