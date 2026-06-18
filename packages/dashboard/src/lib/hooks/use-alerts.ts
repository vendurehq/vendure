import { AlertSeverity, DashboardAlertDefinition } from '@/vdb/framework/extension-api/types/alerts.js';
import { useAlertsContext } from '@/vdb/hooks/use-alerts-context.js';
import { useMemo } from 'react';

/**
 * @description
 * An individual Alert item.
 *
 * @docsCategory hooks
 * @docsPage useAlerts
 * @since 3.5.0
 */
export interface AlertEntry {
    definition: DashboardAlertDefinition;
    active: boolean;
    currentSeverity?: AlertSeverity;
    lastData: any;
    dismiss: () => void;
}

/**
 * @description
 * Returns information about all registered Alerts, including how many are
 * active and at what severity.
 *
 * @docsCategory hooks
 * @docsPage useAlerts
 * @docsWeight 0
 * @since 3.5.0
 */
export function useAlerts(): { alerts: AlertEntry[]; activeCount: number; highestSeverity: AlertSeverity } {
    const { alertDefs, rawResults, dismissedAlerts, setDismissedAlerts } = useAlertsContext();

    const alerts = useMemo(() => {
        return rawResults.map((result, idx) => {
            const alertDef = alertDefs[idx];
            const dismissedAt = dismissedAlerts.get(alertDef.id);
            const isDismissed =
                dismissedAt !== undefined &&
                result.dataUpdatedAt !== undefined &&
                dismissedAt > result.dataUpdatedAt;
            const active = alertDef.shouldShow(result.data) && !isDismissed;
            const currentSeverity = getSeverity(alertDef, result.data);
            return {
                definition: alertDef,
                active,
                lastData: result.data,
                currentSeverity,
                dismiss: () => {
                    setDismissedAlerts(prev => new Map(prev).set(alertDef.id, Date.now()));
                },
            };
        });
    }, [rawResults, alertDefs, dismissedAlerts]);

    const activeCount = useMemo(() => alerts.filter(alert => alert.active).length, [alerts]);
    const highestSeverity: AlertSeverity =
        alerts.length > 0
            ? alerts.reduce((highest, a) => {
                  if (highest === 'warning' && a.currentSeverity === 'error') {
                      return 'error';
                  }
                  if (
                      highest === 'info' &&
                      (a.currentSeverity === 'warning' || a.currentSeverity === 'error')
                  ) {
                      return a.currentSeverity;
                  }
                  return highest;
              }, 'info' as AlertSeverity)
            : 'info';

    return { alerts, activeCount, highestSeverity };
}

function getSeverity(alertDef: DashboardAlertDefinition, data: any) {
    if (typeof alertDef.severity === 'string') {
        return alertDef.severity;
    } else if (typeof alertDef.severity === 'function') {
        return alertDef.severity(data);
    } else {
        return 'info';
    }
}
