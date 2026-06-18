import { AlertsContext } from '@/vdb/providers/alerts-provider.js';
import { useContext } from 'react';

export function useAlertsContext() {
    const context = useContext(AlertsContext);
    if (!context) {
        throw new Error('useAlertsContext must be used within AlertsProvider');
    }
    return context;
}
