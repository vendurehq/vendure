import { AnyRoute, RouteOptions } from '@tanstack/react-router';
import { LucideIcon } from 'lucide-react';
import type React from 'react';

import { NavMenuItem } from '../../nav-menu/nav-menu-extensions.js';

/**
 * @description
 * Defines a custom route for the dashboard with optional navigation menu integration.
 *
 * @docsCategory extensions-api
 * @docsPage Routes
 * @since 3.4.0
 */
export interface DashboardRouteDefinition {
    /**
     * @description
     * The React component that will be rendered for this route.
     */
    component: (route: AnyRoute) => React.ReactNode;
    /**
     * @description
     * The URL path for this route, e.g. '/my-custom-page'.
     */
    path: string;
    /**
     * @description
     * Optional navigation menu item configuration to add this route to the nav menu
     * on the left side of the dashboard.
     *
     * The `sectionId` specifies which nav menu section (e.g. "catalog", "customers")
     * this item should appear in. It can also point to custom nav menu sections that
     * have been defined using the `navSections` extension property.
     */
    navMenuItem?: Partial<NavMenuItem> & { sectionId: string };
    /**
     * @description
     * Optional loader function to fetch data before the route renders.
     * The value is a Tanstack Router
     * [loader function](https://tanstack.com/router/latest/docs/framework/react/guide/data-loading#route-loaders)
     */
    loader?: RouteOptions<any>['loader'];

    /**
     * @description
     * Optional search parameter validation function.
     * The value is a Tanstack Router
     * [validateSearch function](https://tanstack.com/router/latest/docs/framework/react/guide/search-params#search-param-validation)
     */
    validateSearch?: RouteOptions<any>['validateSearch'];

    /**
     * @description
     * Define if the route should be under the authentication context, i.e have the authenticated route
     * as a parent.
     * @default true
     */
    authenticated?: boolean;
}

/**
 * @description
 * Defines a custom navigation section in the dashboard sidebar.
 *
 * Individual items can then be added to the section by defining routes in the
 * `routes` property of your Dashboard extension.
 *
 * @docsCategory extensions-api
 * @docsPage Navigation
 * @docsWeight 0
 * @since 3.4.0
 */
export interface DashboardNavSectionDefinition {
    /**
     * @description
     * A unique identifier for the navigation section.
     */
    id: string;
    /**
     * @description
     * The display title for the navigation section.
     */
    title: string;
    /**
     * @description
     * Optional icon to display next to the section title. The icons should
     * be imported from `'lucide-react'`.
     *
     * @example
     * ```ts
     * import { PlusIcon } from 'lucide-react';
     * ```
     */
    icon?: LucideIcon;
    /**
     * @description
     * Optional order number to control the position of this section in the sidebar.
     */
    order?: number;
    /**
     * @description
     * Optional placement to control the position of this section in the sidebar.
     */
    placement?: 'top' | 'bottom';
}
