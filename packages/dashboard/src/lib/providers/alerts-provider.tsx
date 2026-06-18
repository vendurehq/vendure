import { getAlertRegistry } from '@/vdb/framework/alert/alert-extensions.js';
import { onExtensionSourceChange } from '@/vdb/framework/extension-api/define-dashboard-extension.js';
import { DashboardAlertDefinition } from '@/vdb/framework/extension-api/types/alerts.js';
import { useQueries, UseQueryOptions } from '@tanstack/react-query';
import { createContext, ReactNode, useEffect, useState } from 'react';

export interface AlertsContextValue {
    alertDefs: DashboardAlertDefinition[];
    rawResults: any[];
    dismissedAlerts: Map<string, number>;
    setDismissedAlerts: React.Dispatch<React.SetStateAction<Map<string, number>>>;
    enabledQueries: boolean;
}

export const AlertsContext = createContext<AlertsContextValue | undefined>(undefined);

export function AlertsProvider({ children }: { children: ReactNode }) {
    const initialDelayMs = 5_000;
    // Seed from the registry synchronously and resubscribe — extensions register
    // their alerts during `App`'s post-mount effect (after this provider's own
    // mount effect runs), so we'd otherwise snapshot an empty registry.
    const [alertDefs, setAlertDefs] = useState<DashboardAlertDefinition[]>(() =>
        Array.from(getAlertRegistry().values()),
    );
    const [enabledQueries, setEnabledQueries] = useState(false);
    const [dismissedAlerts, setDismissedAlerts] = useState<Map<string, number>>(new Map());

    useEffect(() => {
        onExtensionSourceChange(() => setAlertDefs(Array.from(getAlertRegistry().values())));
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => {
            setEnabledQueries(true);
        }, initialDelayMs);
        return () => clearTimeout(timer);
    }, []);

    const rawResults = useQueries({
        queries: alertDefs.map(
            alert =>
                ({
                    queryKey: ['alert', alert.id],
                    queryFn: () => alert.check(),
                    refetchInterval: alert.recheckInterval,
                    enabled: enabledQueries,
                }) as UseQueryOptions,
        ),
    });

    return (
        <AlertsContext.Provider
            value={{ alertDefs, rawResults, dismissedAlerts, setDismissedAlerts, enabledQueries }}
        >
            {children}
        </AlertsContext.Provider>
    );
}
