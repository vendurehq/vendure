import {
    excludeDashboardWidgets,
    registerDashboardWidgetFilter,
} from '../../dashboard-widget/widget-extensions.js';
import { DashboardInsightsExtensionDefinition, DashboardWidgetDefinition } from '../types/index.js';

import { registerWidgetExtensions } from './widgets.js';

/**
 * Registers the `insights` extension options. The deprecated top-level `widgets`
 * option is merged with `insights.widgets` so both continue to work identically.
 */
export function registerInsightsExtensions(
    insights: DashboardInsightsExtensionDefinition | undefined,
    deprecatedWidgets?: DashboardWidgetDefinition[],
) {
    const widgets = [...(deprecatedWidgets ?? []), ...(insights?.widgets ?? [])];
    registerWidgetExtensions(widgets);

    if (insights?.excludeWidgets?.length) {
        excludeDashboardWidgets(insights.excludeWidgets);
    }

    if (insights?.filters?.length) {
        for (const filter of insights.filters) {
            registerDashboardWidgetFilter(filter);
        }
    }
}
