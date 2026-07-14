import type React from 'react';

import { PageContextValue } from '../../layout-engine/page-provider.js';

/**
 * @description
 * Allows you to define custom action bar items for any page in the dashboard, which is the
 * top bar that normally contains the main call-to-action buttons such as "update" or "create".
 *
 * This API also allows you to specify dropdown menu items, which when defined, will appear in
 * a context menu to the very right of the ActionBar.
 *
 * @docsCategory extensions-api
 * @docsPage ActionBar
 * @since 3.3.0
 */
export interface DashboardActionBarItem {
    /**
     * @description
     * The ID of the page where the action bar item should be displayed.
     */
    pageId: string;
    /**
     * @description
     * A React component that will be rendered in the action bar. Typically, you would use
     * the default Shadcn `<Button>` component.
     */
    component: React.FunctionComponent<{ context: PageContextValue }>;
    /**
     * @description
     * The type of action bar item to display. Defaults to `button`.
     * The 'dropdown' type is used to display the action bar item as a dropdown menu item.
     *
     * When using the dropdown type, use a suitable [dropdown item](https://ui.shadcn.com/docs/components/dropdown-menu)
     * component, such as:
     *
     * ```tsx
     * import { DropdownMenuItem } from '\@vendure/dashboard';
     *
     * // ...
     *
     * {
     *   component: () => <DropdownMenuItem>My Item</DropdownMenuItem>
     * }
     * ```
     *
     * @default 'button'
     */
    type?: 'button' | 'dropdown';
    /**
     * @description
     * Any permissions that are required to display this action bar item.
     */
    requiresPermission?: string | string[];
    /**
     * @description
     * A unique identifier for this action bar item. This is required if you want
     * other extensions to be able to position their items relative to this one.
     *
     * @since 3.5.2
     */
    id?: string;
    /**
     * @description
     * Position this item relative to another action bar item. The `itemId` should
     * match the `id` of an existing action bar item (either a built-in item or one
     * added by another extension).
     *
     * - `'before'`: Place this item before the target item
     * - `'after'`: Place this item after the target item
     * - `'replace'`: Replace the target item entirely with this item
     *
     * @since 3.5.2
     */
    position?: ActionBarItemPosition;
}

/**
 * @description
 * The relative position of an ActionBar item. This is determined by finding an existing
 * action bar item by its `id`, and then specifying whether your custom item should come
 * before, after, or completely replace that item.
 *
 * @docsCategory extensions-api
 * @docsPage ActionBar
 * @since 3.5.2
 */
export type ActionBarItemPosition = { itemId: string; order: 'before' | 'after' | 'replace' };

/**
 * @description
 * The relative position of a PageBlock. This is determined by finding an existing
 * block, and then specifying whether your custom block should come before, after,
 * or completely replace that block.
 *
 * @docsCategory extensions-api
 * @docsPage page-blocks
 * @since 3.3.0
 */
export type PageBlockPosition = { blockId: string; order: 'before' | 'after' | 'replace' };

/**
 * @description
 * The location of a page block in the dashboard. The location can be found by turning on
 * "developer mode" in the dashboard user menu (bottom left corner) and then
 * clicking the `< />` icon when hovering over a page block.
 *
 * @docsCategory extensions-api
 * @docsPage page-blocks
 * @since 3.3.0
 */
export type PageBlockLocation = {
    pageId: string;
    position: PageBlockPosition;
    column: 'main' | 'side' | 'full';
};

/**
 * @description
 * This allows you to insert a custom component into a specific location
 * on any page in the dashboard.
 *
 * @docsCategory extensions-api
 * @docsPage page-blocks
 * @docsWeight 0
 * @since 3.3.0
 */
export interface DashboardPageBlockDefinition {
    /**
     * @description
     * An ID for the page block. Should be unique at least
     * to the page in which it appears.
     */
    id: string;
    /**
     * @description
     * An optional title for the page block
     */
    title?: React.ReactNode;
    /**
     * @description
     * The location of the page block. It specifies the pageId, and then the
     * relative location compared to another existing block.
     */
    location: PageBlockLocation;
    /**
     * @description
     * The component to be rendered inside the page block.
     */
    component?: React.FunctionComponent<{ context: PageContextValue }>;
    /**
     * @description
     * Control whether to render the page block depending on your custom
     * logic.
     *
     * This can also be used to disable any built-in blocks you
     * do not need to display.
     *
     * If you need to query aspects about the current context not immediately
     * provided in the `PageContextValue`, you can also use hooks such as
     * `useChannel` in this function.
     *
     * @since 3.5.0
     */
    shouldRender?: (context: PageContextValue) => boolean;
    /**
     * @description
     * If provided, the logged-in user must have one or more of the specified
     * permissions in order for the block to render.
     *
     * For more advanced control over rendering, use the `shouldRender` function.
     */
    requiresPermission?: string | string[];
}
