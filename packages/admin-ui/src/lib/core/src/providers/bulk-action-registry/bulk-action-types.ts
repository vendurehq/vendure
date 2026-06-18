import { Injector } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

/**
 * @description
 * A valid location of a list view that supports the bulk actions API.
 *
 * @since 1.8.0
 * @docsCategory bulk-actions
 * @docsPage BulkAction
 */
export type BulkActionLocationId =
    | 'product-list'
    | 'facet-list'
    | 'collection-list'
    | 'customer-list'
    | 'customer-group-list'
    | 'customer-group-members-list'
    | 'customer-group-members-picker-list'
    | 'promotion-list'
    | 'seller-list'
    | 'channel-list'
    | 'administrator-list'
    | 'role-list'
    | 'shipping-method-list'
    | 'stock-location-list'
    | 'payment-method-list'
    | 'tax-category-list'
    | 'tax-rate-list'
    | 'zone-list'
    | 'zone-members-list'
    | string;

/**
 * @description
 * This is the argument which gets passed to the `getTranslationVars` and `isVisible` functions
 * of the BulkAction definition.
 *
 * @since 1.8.0
 * @docsCategory bulk-actions
 * @docsPage BulkAction
 */
export interface BulkActionFunctionContext<ItemType, ComponentType> {
    /**
     * @description
     * An array of the selected items from the list.
     */
    selection: ItemType[];
    /**
     * @description
     * The component instance that is hosting the list view. For instance,
     * `ProductListComponent`. This can be used to call methods on the instance,
     * e.g. calling `hostComponent.refresh()` to force a list refresh after
     * deleting the selected items.
     */
    hostComponent: ComponentType;
    /**
     * @description
     * The Angular [Injector](https://angular.io/api/core/Injector) which can be used
     * to get service instances which might be needed in the click handler.
     */
    injector: Injector;
    route: ActivatedRoute;
}

/**
 * @description
 * This is the argument which gets passed to the `onClick` function of a BulkAction.
 *
 * @since 1.8.0
 * @docsCategory bulk-actions
 * @docsPage BulkAction
 */
export interface BulkActionClickContext<ItemType, ComponentType>
    extends BulkActionFunctionContext<ItemType, ComponentType> {
    /**
     * @description
     * Clears the selection in the active list view.
     */
    clearSelection: () => void;
    /**
     * @description
     * The click event itself.
     */
    event: MouseEvent;
}

/**
 * @description
 * Configures a bulk action which can be performed on all selected items in a list view.
 *
 * For a full example, see the {@link registerBulkAction} docs.
 *
 * @since 1.8.0
 * @docsCategory bulk-actions
 * @docsPage BulkAction
 * @docsWeight 0
 */
export interface BulkAction<ItemType = any, ComponentType = any> {
    location: BulkActionLocationId;
    label: string;
    /**
     * @description
     * An optional function that should resolve to a map of translation variables which can be
     * used when translating the `label` string.
     */
    getTranslationVars?: (
        context: BulkActionFunctionContext<ItemType, ComponentType>,
    ) => Record<string, string | number> | Promise<Record<string, string | number>>;
    /**
     * @description
     * A valid [Clarity Icons](https://core.clarity.design/foundation/icons/shapes/) icon shape, e.g.
     * "cog", "user", "info-standard".
     */
    icon?: string;
    /**
     * @description
     * A class to be added to the icon element. Examples:
     *
     * - is-success
     * - is-danger
     * - is-warning
     * - is-info
     * - is-highlight
     */
    iconClass?: string;
    /**
     * @description
     * Defines the logic that executes when the bulk action button is clicked.
     */
    onClick: (context: BulkActionClickContext<ItemType, ComponentType>) => void;
    /**
     * @description
     * A function that determines whether this bulk action item should be displayed in the menu.
     * If not defined, the item will always be displayed.
     *
     * This function will be invoked each time the selection is changed, so try to avoid expensive code
     * running here.
     *
     * @example
     * ```ts
     * import { registerBulkAction, DataService } from '\@vendure/admin-ui/core';
     *
     * registerBulkAction({
     *   location: 'product-list',
     *   label: 'Assign to channel',
     *   // Only display this action if there are multiple channels
     *   isVisible: ({ injector }) => injector.get(DataService).client
     *     .userStatus()
     *     .mapSingle(({ userStatus }) => 1 < userStatus.channels.length)
     *     .toPromise(),
     *   // ...
     * });
     * ```
     */
    isVisible?: (context: BulkActionFunctionContext<ItemType, ComponentType>) => boolean | Promise<boolean>;
    /**
     * @description
     * Control the display of this item based on the user permissions.
     *
     * @example
     * ```ts
     * registerBulkAction({
     *   // Can be specified as a simple string
     *   requiresPermission: Permission.UpdateProduct,
     *
     *   // Or as a function that returns a boolean if permissions are satisfied
     *   requiresPermission: userPermissions =>
     *     userPermissions.includes(Permission.UpdateCatalog) ||
     *     userPermissions.includes(Permission.UpdateProduct),
     *   // ...
     * })
     * ```
     */
    requiresPermission?: string | ((userPermissions: string[]) => boolean);
}
