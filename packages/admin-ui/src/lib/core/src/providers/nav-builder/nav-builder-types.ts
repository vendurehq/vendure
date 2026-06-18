import { Injector } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Observable } from 'rxjs';

import { ActionBarLocationId } from '../../common/component-registry-types';
import { DataService } from '../../data/providers/data.service';
import { NotificationService } from '../notification/notification.service';

export type NavMenuBadgeType = 'none' | 'info' | 'success' | 'warning' | 'error';

/**
 * @description
 * A color-coded notification badge which will be displayed by the
 * NavMenuItem's icon.
 *
 * @docsCategory nav-menu
 * @docsPage navigation-types
 */
export interface NavMenuBadge {
    type: NavMenuBadgeType;
    /**
     * @description
     * If true, the badge will propagate to the NavMenuItem's
     * parent section, displaying a notification badge next
     * to the section name.
     */
    propagateToSection?: boolean;
}

/**
 * @description
 * A NavMenuItem is a menu item in the main (left-hand side) nav
 * bar.
 *
 * @docsCategory nav-menu
 */
export interface NavMenuItem {
    id: string;
    label: string;
    routerLink: RouterLinkDefinition;
    onClick?: (event: MouseEvent) => void;
    icon?: string;
    /**
     * Control the display of this item based on the user permissions.
     */
    requiresPermission?: string | ((userPermissions: string[]) => boolean);
    statusBadge?: Observable<NavMenuBadge>;
}

/**
 * @description
 * A NavMenuSection is a grouping of links in the main
 * (left-hand side) nav bar.
 *
 * @docsCategory nav-menu
 */
export interface NavMenuSection {
    id: string;
    label: string;
    items: NavMenuItem[];
    icon?: string;
    displayMode?: 'regular' | 'settings';
    /**
     * @description
     * Control the display of this item based on the user permissions. Note: if you attempt to pass a
     * {@link PermissionDefinition} object, you will get a compilation error. Instead, pass the plain
     * string version. For example, if the permission is defined as:
     * ```ts
     * export const MyPermission = new PermissionDefinition('ProductReview');
     * ```
     * then the generated permission strings will be:
     *
     * - `CreateProductReview`
     * - `ReadProductReview`
     * - `UpdateProductReview`
     * - `DeleteProductReview`
     */
    requiresPermission?: string | ((userPermissions: string[]) => boolean);
    collapsible?: boolean;
    collapsedByDefault?: boolean;
}

/**
 * @description
 * Providers & data available to the `onClick` & `buttonState` functions of an {@link ActionBarItem},
 * {@link ActionBarDropdownMenuItem} or {@link NavMenuItem}.
 *
 * @docsCategory action-bar
 */
export interface ActionBarContext {
    /**
     * @description
     * The router's [ActivatedRoute](https://angular.dev/guide/routing/router-reference#activated-route) object for
     * the current route. This object contains information about the route, its parameters, and additional data
     * associated with the route.
     */
    route: ActivatedRoute;
    /**
     * @description
     * The Angular [Injector](https://angular.dev/api/core/Injector) which can be used to get instances
     * of services and other providers available in the application.
     */
    injector: Injector;
    /**
     * @description
     * The [DataService](/reference/admin-ui-api/services/data-service), which provides methods for querying the
     * server-side data.
     */
    dataService: DataService;
    /**
     * @description
     * The [NotificationService](/reference/admin-ui-api/services/notification-service), which provides methods for
     * displaying notifications to the user.
     */
    notificationService: NotificationService;
    /**
     * @description
     * An observable of the current entity in a detail view. In a list view the observable will not emit any values.
     *
     * @example
     * ```ts
     * addActionBarDropdownMenuItem({
     *     id: 'print-invoice',
     *     locationId: 'order-detail',
     *     label: 'Print Invoice',
     *     icon: 'printer',
     *     buttonState: context => {
     *         return context.entity$.pipe( // [!code highlight]
     *             map((order) => { // [!code highlight]
     *                 return order?.state === 'PaymentSettled' // [!code highlight]
     *                     ? { disabled: false, visible: true } // [!code highlight]
     *                     : { disabled: true, visible: true }; // [!code highlight]
     *             }), // [!code highlight]
     *         ); // [!code highlight]
     *     },
     *     requiresPermission: ['UpdateOrder'],
     * }),
     * ```
     *
     * @since 2.2.0
     */
    entity$: Observable<Record<string, any> | undefined>;
}

export interface ActionBarButtonState {
    disabled: boolean;
    visible: boolean;
}

/**
 * @description
 * A button in the ActionBar area at the top of one of the list or detail views.
 *
 * @docsCategory action-bar
 */
export interface ActionBarItem {
    /**
     * @description
     * A unique identifier for the item.
     */
    id: string;
    /**
     * @description
     * The label to display for the item. This can also be a translation token,
     * e.g. `invoice-plugin.print-invoice`.
     */
    label: string;
    /**
     * @description
     * The location in the UI where this button should be displayed.
     */
    locationId: ActionBarLocationId;
    /**
     * @description
     * Deprecated since v2.1.0 - use `buttonState` instead.
     * @deprecated - use `buttonState` instead.
     */
    disabled?: Observable<boolean>;
    /**
     * @description
     * A function which returns an observable of the button state, allowing you to
     * dynamically enable/disable or show/hide the button.
     *
     * @since 2.1.0
     */
    buttonState?: (context: ActionBarContext) => Observable<ActionBarButtonState>;
    onClick?: (event: MouseEvent, context: ActionBarContext) => void;
    routerLink?: RouterLinkDefinition;
    buttonColor?: 'primary' | 'success' | 'warning';
    buttonStyle?: 'solid' | 'outline' | 'link';
    /**
     * @description
     * An optional icon to display in the button. The icon
     * should be a valid shape name from the [Clarity Icons](https://core.clarity.design/foundation/icons/shapes/)
     * set.
     */
    icon?: string;
    /**
     * @description
     * Control the display of this item based on the user permissions. Note: if you attempt to pass a
     * {@link PermissionDefinition} object, you will get a compilation error. Instead, pass the plain
     * string version. For example, if the permission is defined as:
     *
     * ```ts
     * export const MyPermission = new PermissionDefinition('ProductReview');
     * ```
     *
     * then the generated permission strings will be:
     *
     * - `CreateProductReview`
     * - `ReadProductReview`
     * - `UpdateProductReview`
     * - `DeleteProductReview`
     */
    requiresPermission?: string | string[];
}

/**
 * @description
 * A dropdown menu item in the ActionBar area at the top of one of the list or detail views.
 *
 * @docsCategory action-bar
 * @since 2.2.0
 */
export interface ActionBarDropdownMenuItem {
    /**
     * @description
     * A unique identifier for the item.
     */
    id: string;
    /**
     * @description
     * The label to display for the item. This can also be a translation token,
     * e.g. `invoice-plugin.print-invoice`.
     */
    label: string;
    /**
     * @description
     * The location in the UI where this menu item should be displayed.
     */
    locationId: ActionBarLocationId;
    /**
     * @description
     * Whether to render a divider above this item.
     */
    hasDivider?: boolean;
    /**
     * @description
     * A function which returns an observable of the button state, allowing you to
     * dynamically enable/disable or show/hide the button.
     */
    buttonState?: (context: ActionBarContext) => Observable<ActionBarButtonState | undefined>;
    onClick?: (event: MouseEvent, context: ActionBarContext) => void;
    routerLink?: RouterLinkDefinition;
    /**
     * @description
     * An optional icon to display with the item. The icon
     * should be a valid shape name from the [Clarity Icons](https://core.clarity.design/foundation/icons/shapes/)
     * set.
     */
    icon?: string;
    /**
     * @description
     * Control the display of this item based on the user permissions. Note: if you attempt to pass a
     * {@link PermissionDefinition} object, you will get a compilation error. Instead, pass the plain
     * string version. For example, if the permission is defined as:
     *
     * ```ts
     * export const MyPermission = new PermissionDefinition('ProductReview');
     * ```
     * then the generated permission strings will be:
     *
     * - `CreateProductReview`
     * - `ReadProductReview`
     * - `UpdateProductReview`
     * - `DeleteProductReview`
     */
    requiresPermission?: string | string[];
}

/**
 * @description
 * A function which returns the router link for an {@link ActionBarItem} or {@link NavMenuItem}.
 *
 * @docsCategory action-bar
 */
export type RouterLinkDefinition = ((route: ActivatedRoute, context: ActionBarContext) => any[]) | any[];
