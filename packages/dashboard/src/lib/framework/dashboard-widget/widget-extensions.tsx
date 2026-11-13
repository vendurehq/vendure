import {
    DashboardWidgetDefinition,
    DashboardWidgetFilterDefinition,
} from '@/vdb/framework/extension-api/types/index.js';
import { globalRegistry } from '../registry/global-registry.js';

globalRegistry.register('dashboardWidgetRegistry', new Map<string, DashboardWidgetDefinition>());
globalRegistry.register('excludedDashboardWidgets', new Set<string>());
globalRegistry.register('dashboardWidgetFilterRegistry', new Map<string, DashboardWidgetFilterDefinition>());

export function registerDashboardWidget(widget: DashboardWidgetDefinition) {
    globalRegistry.set('dashboardWidgetRegistry', map => {
        map.set(widget.id, widget);
        return map;
    });
}

export function getDashboardWidgetRegistry() {
    return globalRegistry.get('dashboardWidgetRegistry');
}

export function getDashboardWidget(id: string) {
    return globalRegistry.get('dashboardWidgetRegistry').get(id);
}

/**
 * Marks the given widget ids as excluded. Excluded widgets are removed from the
 * effective registry, so they are never rendered and never appear in the widget
 * picker, regardless of any saved user layout. Exclusion is order-independent: it
 * applies whether the widget is registered before or after being excluded.
 */
export function excludeDashboardWidgets(ids: string[]) {
    globalRegistry.set('excludedDashboardWidgets', set => {
        for (const id of ids) {
            set.add(id);
        }
        return set;
    });
}

export function getExcludedDashboardWidgets() {
    return globalRegistry.get('excludedDashboardWidgets');
}

/**
 * Returns the effective widget registry entries with excluded widgets removed.
 */
export function getVisibleDashboardWidgets(): Array<[string, DashboardWidgetDefinition]> {
    const excluded = getExcludedDashboardWidgets();
    return Array.from(getDashboardWidgetRegistry().entries()).filter(([id]) => !excluded.has(id));
}

/**
 * Registers a global Insights filter. Filters render in the Insights page action bar and
 * their values are shared with every widget via the `useWidgetFilters()` hook. A duplicate
 * id overwrites the previous registration (last wins), matching `registerDashboardWidget`
 * and keeping HMR re-registration working; in development a warning is logged so an
 * accidental id collision between extensions is still surfaced.
 */
export function registerDashboardWidgetFilter(filter: DashboardWidgetFilterDefinition) {
    if (
        process.env.NODE_ENV !== 'production' &&
        globalRegistry.get('dashboardWidgetFilterRegistry').has(filter.id)
    ) {
        // eslint-disable-next-line no-console
        console.warn(
            `A dashboard widget filter with the id "${filter.id}" is already registered. ` +
                `The previous registration will be overwritten.`,
        );
    }
    globalRegistry.set('dashboardWidgetFilterRegistry', map => {
        map.set(filter.id, filter);
        return map;
    });
}

/**
 * Returns all registered global Insights filters.
 */
export function getDashboardWidgetFilters(): DashboardWidgetFilterDefinition[] {
    return Array.from(globalRegistry.get('dashboardWidgetFilterRegistry').values());
}
