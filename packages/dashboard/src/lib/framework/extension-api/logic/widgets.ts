import { registerDashboardWidget } from '../../dashboard-widget/widget-extensions.js';
import { DashboardWidgetDefinition } from '../types/index.js';

export function registerWidgetExtensions(widgets?: DashboardWidgetDefinition[]) {
    if (widgets) {
        for (const widget of widgets) {
            registerDashboardWidget(widget);
        }
    }
}
