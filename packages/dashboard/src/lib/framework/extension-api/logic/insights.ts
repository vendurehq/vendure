import {
    excludeDashboardWidgets,
    registerDashboardWidgetFilter,
} from '../../dashboard-widget/widget-extensions.js';
import { DashboardInsightsExtensionDefinition } from '../types/index.js';

import { registerWidgetExtensions } from './widgets.js';

/**
 * Registers the `insights` extension options.
 */
export function registerInsightsExtensions(insights: DashboardInsightsExtensionDefinition | undefined) {
    registerWidgetExtensions(insights?.widgets);

    if (insights?.excludeWidgets?.length) {
        excludeDashboardWidgets(insights.excludeWidgets);
    }

    if (insights?.filters?.length) {
        for (const filter of insights.filters) {
            registerDashboardWidgetFilter(filter);
        }
    }
}
