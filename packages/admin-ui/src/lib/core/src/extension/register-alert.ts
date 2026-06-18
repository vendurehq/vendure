import { inject, provideAppInitializer } from '@angular/core';
import { AlertConfig, AlertsService } from '../providers/alerts/alerts.service';

/**
 * @description
 * Registers an alert which can be displayed in the Admin UI alert dropdown in the top bar.
 * The alert is configured using the {@link AlertConfig} object.
 *
 * @since 2.2.0
 * @docsCategory alerts
 */
export function registerAlert(config: AlertConfig) {
    return provideAppInitializer(() => {
        const initializerFn = ((alertsService: AlertsService) => () => {
            alertsService.configureAlert(config);
            alertsService.refresh(config.id);
        })(inject(AlertsService));
        return initializerFn();
    });
}
