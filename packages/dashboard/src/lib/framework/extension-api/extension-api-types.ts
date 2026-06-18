// Import types for the main interface
import { NavMenuConfig } from '../nav-menu/nav-menu-extensions.js';

import {
    DashboardActionBarItem,
    DashboardAlertDefinition,
    DashboardCustomFormComponents,
    DashboardDataTableExtensionDefinition,
    DashboardDetailFormExtensionDefinition,
    DashboardHistoryEntryComponent,
    DashboardLoginExtensions,
    DashboardNavSectionDefinition,
    DashboardPageBlockDefinition,
    DashboardRouteDefinition,
    DashboardToolbarItemDefinition,
    DashboardWidgetDefinition,
} from './types/index.js';

/**
 * @description
 * This is the main interface for defining _all_ extensions to the dashboard.
 *
 * Every type of customisation of the dashboard can be defined here, including:
 *
 * - Navigation (nav sections and routes)
 * - Layout (action bar items and page blocks)
 * - Widgets for the Insights page
 * - Form components
 * - Data tables
 * - Detail forms
 * - Login page customisation
 *
 * @docsCategory extensions-api
 * @docsPage defineDashboardExtension
 * @since 3.3.0
 */
export interface DashboardExtension {
    /**
     * @description
     * Allows you to define custom routes such as list or detail views.
     */
    routes?: DashboardRouteDefinition[];
    /**
     * @description
     * Allows you to define custom nav sections for the dashboard.
     *
     * Can be provided as either:
     * - An **array** of `DashboardNavSectionDefinition` objects to declaratively add new sections
     * - A **function** that receives the current `NavMenuConfig` and returns a new one, allowing
     *   full control over the nav menu (move, remove, reorder items between sections)
     *
     * When using the function form, the function is guaranteed to run _after_ all array-form
     * registrations have completed, so it always sees the fully-populated nav config.
     *
     * @example
     * ```ts
     * // Array form (existing)
     * navSections: [{ id: 'my-section', title: 'My Section' }]
     *
     * // Function form (new)
     * navSections: (config) => ({
     *     sections: config.sections.map(s =>
     *         s.id === 'settings' && 'items' in s
     *             ? { ...s, items: s.items?.filter(i => i.id !== 'administrators') }
     *             : s
     *     ),
     * })
     * ```
     *
     * Note: modifier functions should return a **new** config object rather than
     * mutating the input, to ensure predictable behavior when multiple modifiers
     * are composed. The function form was introduced in version 3.6.0.
     */
    navSections?: DashboardNavSectionDefinition[] | ((config: NavMenuConfig) => NavMenuConfig);
    /**
     * @description
     * Allows you to define custom page blocks for any page in the dashboard.
     */
    pageBlocks?: DashboardPageBlockDefinition[];
    /**
     * @description
     * Allows you to define custom action bar items for any page in the dashboard.
     */
    actionBarItems?: DashboardActionBarItem[];
    /**
     * @description
     * Allows you to define custom alerts that can be displayed in the dashboard.
     */
    alerts?: DashboardAlertDefinition[];
    /**
     * @description
     * Allows you to define custom routes for the dashboard, which will render the
     * given components and optionally also add a nav menu item.
     */
    widgets?: DashboardWidgetDefinition[];
    /**
     * @description
     * Unified registration for custom form custom field components.
     */
    customFormComponents?: DashboardCustomFormComponents;
    /**
     * @description
     * Allows you to customize aspects of existing data tables in the dashboard.
     */
    dataTables?: DashboardDataTableExtensionDefinition[];
    /**
     * @description
     * Allows you to customize the detail form for any page in the dashboard.
     */
    detailForms?: DashboardDetailFormExtensionDefinition[];
    /**
     * @description
     * Allows you to customize the login page with custom components.
     */
    login?: DashboardLoginExtensions;
    /**
     * @description
     * Allows a custom component to be used to render a history entry item
     * in the Order or Customer history lists.
     */
    historyEntries?: DashboardHistoryEntryComponent[];
    /**
     * @description
     * Allows you to define custom toolbar items in the app shell header bar.
     * Toolbar items appear alongside the breadcrumbs, dev mode indicator,
     * and alerts icon.
     *
     * @since 3.5.3
     */
    toolbarItems?: DashboardToolbarItemDefinition[];
}
