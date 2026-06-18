import { inject, provideAppInitializer } from '@angular/core';
import { ActionBarDropdownMenuItem } from '../providers/nav-builder/nav-builder-types';
import { NavBuilderService } from '../providers/nav-builder/nav-builder.service';

/**
 * @description
 * Adds a dropdown menu item to the ActionBar at the top right of each list or detail view. The locationId can
 * be determined by pressing `ctrl + u` when running the Admin UI in dev mode.
 *
 * @example
 * ```ts title="providers.ts"
 * import { addActionBarDropdownMenuItem } from '\@vendure/admin-ui/core';
 *
 * export default [
 *     addActionBarDropdownMenuItem({
 *         id: 'print-invoice',
 *         label: 'Print Invoice',
 *         locationId: 'order-detail',
 *         routerLink: ['/extensions/invoicing'],
 *     }),
 * ];
 * ```
 *
 * @since 2.2.0
 * @docsCategory action-bar
 */
export function addActionBarDropdownMenuItem(config: ActionBarDropdownMenuItem) {
    return provideAppInitializer(() => {
        const initializerFn = ((navBuilderService: NavBuilderService) => () => {
            navBuilderService.addActionBarDropdownMenuItem(config);
        })(inject(NavBuilderService));
        return initializerFn();
    });
}
