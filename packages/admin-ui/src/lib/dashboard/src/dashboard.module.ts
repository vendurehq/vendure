import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { DashboardWidgetService, SharedModule } from '@vendure/admin-ui/core';

import { DashboardWidgetComponent } from './components/dashboard-widget/dashboard-widget.component';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { dashboardRoutes } from './dashboard.routes';
import { DEFAULT_DASHBOARD_WIDGET_LAYOUT, DEFAULT_WIDGETS } from './default-widgets';
import { OrderChartWidgetComponent } from './widgets/order-chart-widget/order-chart-widget.component';

@NgModule({
    imports: [SharedModule, RouterModule.forChild(dashboardRoutes)],
    declarations: [DashboardComponent, DashboardWidgetComponent, OrderChartWidgetComponent],
})
export class DashboardModule {
    constructor(dashboardWidgetService: DashboardWidgetService) {
        Object.entries(DEFAULT_WIDGETS).map(([id, config]) => {
            if (!dashboardWidgetService.getWidgetById(id)) {
                dashboardWidgetService.registerWidget(id, config);
            }
        });
        if (dashboardWidgetService.getDefaultLayout().length === 0) {
            dashboardWidgetService.setDefaultLayout(DEFAULT_DASHBOARD_WIDGET_LAYOUT);
        }
    }
}
