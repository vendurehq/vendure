import type React from 'react';

/**
 * @description
 * The relative position of a toolbar item. This is determined by finding an existing
 * toolbar item by its `id`, and then specifying whether your custom item should come
 * before, after, or completely replace that item.
 *
 * Built-in toolbar items have the following IDs:
 * - `'dev-mode-indicator'` - The dev mode badge (only visible when dev mode is enabled)
 * - `'alerts'` - The alerts bell icon
 *
 * @docsCategory extensions-api
 * @docsPage Toolbar
 * @since 3.5.3
 */
export type ToolbarItemPosition = { itemId: string; order: 'before' | 'after' | 'replace' };

/**
 * @description
 * Allows you to define custom toolbar items in the app shell header bar. Toolbar items
 * appear in the horizontal bar at the top of the dashboard, alongside the breadcrumbs,
 * dev mode indicator, and alerts icon.
 *
 * Items can be positioned relative to existing items (including built-in ones like
 * `'alerts'` and `'dev-mode-indicator'`) using the `position` property. Items without
 * a `position` are placed before all built-in items.
 *
 * Toolbar items should typically be compact, icon-sized components (e.g. icon buttons)
 * to ensure they fit well in the header on all screen sizes.
 *
 * @example
 * ```ts
 * import { defineDashboardExtension } from '\@vendure/dashboard';
 * import { MySearchButton } from './my-search-button';
 *
 * defineDashboardExtension({
 *     toolbarItems: [
 *         {
 *             id: 'search-trigger',
 *             component: MySearchButton,
 *             position: { itemId: 'alerts', order: 'before' },
 *         },
 *     ],
 * });
 * ```
 *
 * @docsCategory extensions-api
 * @docsPage Toolbar
 * @docsWeight 0
 * @since 3.5.3
 */
export interface DashboardToolbarItemDefinition {
    /**
     * @description
     * A unique identifier for this toolbar item. This ID is used by other extensions
     * to position their items relative to this one via `position.itemId`.
     *
     * It is also displayed in the dev mode popover for easy discovery.
     */
    id: string;
    /**
     * @description
     * A React component that will be rendered in the toolbar. Typically, you would use
     * a compact component such as an icon button.
     *
     * The component receives no props. Use hooks like `useChannel()`, `useAuth()`,
     * or `useRoute()` to access application state.
     *
     * Return `null` from the component to conditionally hide the toolbar item.
     */
    component: React.FunctionComponent;
    /**
     * @description
     * Position this item relative to another toolbar item. The `itemId` should
     * match the `id` of an existing toolbar item (either a built-in item or one
     * added by another extension).
     *
     * Built-in item IDs:
     * - `'dev-mode-indicator'` - The dev mode badge
     * - `'alerts'` - The alerts bell icon
     *
     * - `'before'`: Place this item before the target item
     * - `'after'`: Place this item after the target item
     * - `'replace'`: Replace the target item entirely with this item
     *
     * Items without a `position` are placed before all built-in items.
     */
    position?: ToolbarItemPosition;
    /**
     * @description
     * Any permissions that are required to display this toolbar item.
     */
    requiresPermission?: string | string[];
}
