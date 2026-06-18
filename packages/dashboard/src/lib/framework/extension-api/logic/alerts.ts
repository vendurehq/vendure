import { registerAlert } from '@/vdb/framework/alert/alert-extensions.js';

import { DashboardAlertDefinition } from '../types/alerts.js';

export function registerAlertExtensions(alerts?: DashboardAlertDefinition[]) {
    if (alerts) {
        for (const alert of alerts) {
            registerAlert(alert);
        }
    }
}
