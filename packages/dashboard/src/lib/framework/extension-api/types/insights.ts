import React from 'react';

import { DashboardWidgetDefinition } from './widgets.js';

/**
 * @description
 * The props passed to a global insights filter's action-bar component. The component
 * is a controlled input: it renders the current `value` and calls `onChange` when the
 * user picks a new one.
 *
 * @docsCategory extensions-api
 * @docsPage Insights Filters
 * @since 3.8.0
 */
export interface DashboardWidgetFilterComponentProps<T = any> {
    /**
     * @description
     * The current value of the filter.
     */
    value: T;
    /**
     * @description
     * Call this with the new value when the user changes the filter. The updated value
     * is made available to every widget through the `useWidgetFilters()` hook.
     */
    onChange: (value: T) => void;
}

/**
 * @description
 * Defines a global filter that renders in the Insights page action bar, next to the
 * built-in date range picker. The filter's value is shared with every widget on the
 * page, which can read it via `useWidgetFilters().filters[id]`. Filter state is
 * session-only (it is not persisted).
 *
 * @docsCategory extensions-api
 * @docsPage Insights Filters
 * @docsWeight 0
 * @since 3.8.0
 */
export interface DashboardWidgetFilterDefinition<T = any> {
    /**
     * @description
     * A unique identifier for the filter. Widgets read the filter's value via
     * `useWidgetFilters().filters[id]`. Registering two filters with the same id
     * logs a warning and ignores the duplicate.
     */
    id: string;
    /**
     * @description
     * The React component rendered in the action bar. It receives the current `value`
     * and an `onChange` callback (see {@link DashboardWidgetFilterComponentProps}).
     */
    component: React.ComponentType<DashboardWidgetFilterComponentProps<T>>;
    /**
     * @description
     * The value the filter starts with on page load, before the user changes it.
     */
    defaultValue?: T;
}

/**
 * @description
 * Configuration for the Insights page, grouping all insights-related extension
 * options such as widgets, code-level widget exclusions and global filters.
 *
 * @docsCategory extensions-api
 * @docsPage defineDashboardExtension
 * @since 3.8.0
 */
export interface DashboardInsightsExtensionDefinition {
    /**
     * @description
     * Custom widgets to add to the Insights page.
     */
    widgets?: DashboardWidgetDefinition[];
    /**
     * @description
     * The ids of widgets that should be completely removed from the Insights page.
     * Excluded widgets are never rendered, never appear in the user-facing widget
     * picker, and cannot be re-enabled by a user setting. This works for both
     * built-in widgets and widgets registered by other extensions, regardless of
     * registration order.
     *
     * @example
     * ```ts
     * defineDashboardExtension({
     *     insights: {
     *         excludeWidgets: ['latest-orders-widget'],
     *     },
     * });
     * ```
     */
    excludeWidgets?: string[];
    /**
     * @description
     * Global filters whose components render in the Insights page action bar, next to
     * the built-in date range picker. A filter's value is shared with every widget on
     * the page, which reads it via `useWidgetFilters().filters[id]`. This lets several
     * widgets filter on a common constraint (for example a selected warehouse). Filter
     * state is session-only.
     *
     * @example
     * ```tsx
     * defineDashboardExtension({
     *     insights: {
     *         filters: [
     *             {
     *                 id: 'warehouse',
     *                 defaultValue: 'all',
     *                 component: WarehouseFilter,
     *             },
     *         ],
     *     },
     * });
     * ```
     *
     * @since 3.8.0
     */
    filters?: DashboardWidgetFilterDefinition[];
}
