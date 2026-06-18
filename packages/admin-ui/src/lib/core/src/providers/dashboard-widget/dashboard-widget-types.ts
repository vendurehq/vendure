import { Type } from '@angular/core';

export type DashboardWidgetWidth = 3 | 4 | 6 | 8 | 12;

/**
 * @description
 * A configuration object for a dashboard widget.
 *
 * @docsCategory dashboard-widgets
 */
export interface DashboardWidgetConfig {
    /**
     * @description
     * Used to specify the widget component. Supports both eager- and lazy-loading.
     * @example
     * ```ts
     * // eager-loading
     * loadComponent: () => MyWidgetComponent,
     *
     * // lazy-loading
     * loadComponent: () => import('./path-to/widget.component').then(m => m.MyWidgetComponent),
     * ```
     */
    loadComponent: () => Promise<Type<any>> | Type<any>;
    /**
     * @description
     * The title of the widget. Can be a translation token as it will get passed
     * through the `translate` pipe.
     */
    title?: string;
    /**
     * @description
     * The supported widths of the widget, in terms of a Bootstrap-style 12-column grid.
     * If omitted, then it is assumed the widget supports all widths.
     */
    supportedWidths?: DashboardWidgetWidth[];
    /**
     * @description
     * If set, the widget will only be displayed if the current user has all the
     * specified permissions.
     */
    requiresPermissions?: string[];
}

/**
 * @description
 * A configuration object for the default dashboard widget layout.
 *
 * @docsCategory dashboard-widgets
 */
export type WidgetLayoutDefinition = Array<{ id: string; width: DashboardWidgetWidth }>;
export type WidgetLayout = Array<
    Array<{ id: string; config: DashboardWidgetConfig; width: DashboardWidgetWidth }>
>;
