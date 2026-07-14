import React, { PropsWithChildren } from 'react';

/**
 * @description
 * Base props interface for dashboard widgets.
 *
 * @docsCategory extensions-api
 * @docsPage widgets
 * @since 3.3.0
 */
export type DashboardBaseWidgetProps = PropsWithChildren<{
    id: string;
    title?: string;
    description?: string;
    config?: Record<string, unknown>;
    actions?: React.ReactNode;
}>;

/**
 * @description
 * Represents an instance of a dashboard widget with its layout and configuration.
 *
 * @docsCategory extensions-api
 * @docsPage widgets
 * @since 3.3.0
 */
export type DashboardWidgetInstance = {
    /**
     * @description
     * A unique identifier for the widget instance.
     */
    id: string;
    /**
     * @description
     * The ID of the widget definition this instance is based on.
     */
    widgetId: string;
    /**
     * @description
     * The layout configuration for the widget.
     */
    layout: {
        x: number;
        y: number;
        w: number;
        h: number;
        minW?: number;
        minH?: number;
        maxW?: number;
        maxH?: number;
    };
    /**
     * @description
     * Optional configuration data for the widget.
     */
    config?: Record<string, unknown>;
};

/**
 * @description
 * **Status: Developer Preview**
 *
 * Defines a dashboard widget that can be added to the dashboard.
 *
 * @docsCategory extensions-api
 * @docsPage Widgets
 * @docsWeight 0
 * @since 3.3.0
 */
export type DashboardWidgetDefinition = {
    /**
     * @description
     * A unique identifier for the widget.
     */
    id: string;
    /**
     * @description
     * The display name of the widget.
     */
    name: string;
    /**
     * @description
     * The React component that renders the widget.
     */
    component: React.ComponentType<DashboardBaseWidgetProps>;
    /**
     * @description
     * The default size and position of the widget.
     */
    defaultSize: { w: number; h: number; x?: number; y?: number };
    /**
     * @description
     * The minimum size constraints for the widget.
     */
    minSize?: { w: number; h: number };
    /**
     * @description
     * The maximum size constraints for the widget.
     */
    maxSize?: { w: number; h: number };
    /**
     * @description
     * If set, the widget will only be displayed if the current user has
     * at least one of the specified permissions in the active channel.
     *
     * If not set, the widget will be visible to all users.
     */
    requiresPermissions?: string[];
};
