import { inject, provideAppInitializer } from '@angular/core';

import {
    DashboardWidgetConfig,
    WidgetLayoutDefinition,
} from '../providers/dashboard-widget/dashboard-widget-types';
import { DashboardWidgetService } from '../providers/dashboard-widget/dashboard-widget.service';

/**
 * @description
 * Registers a dashboard widget. Once registered, the widget can be set as part of the default
 * (using {@link setDashboardWidgetLayout}).
 *
 * @docsCategory dashboard-widgets
 */
export function registerDashboardWidget(id: string, config: DashboardWidgetConfig) {
    return provideAppInitializer(() => {
        const initializerFn = ((dashboardWidgetService: DashboardWidgetService) => () => {
            dashboardWidgetService.registerWidget(id, config);
        })(inject(DashboardWidgetService));
        return initializerFn();
    });
}

/**
 * @description
 * Sets the default widget layout for the Admin UI dashboard.
 *
 * @docsCategory dashboard-widgets
 */
export function setDashboardWidgetLayout(layoutDef: WidgetLayoutDefinition) {
    return provideAppInitializer(() => {
        const initializerFn = ((dashboardWidgetService: DashboardWidgetService) => () => {
            dashboardWidgetService.setDefaultLayout(layoutDef);
        })(inject(DashboardWidgetService));
        return initializerFn();
    });
}
