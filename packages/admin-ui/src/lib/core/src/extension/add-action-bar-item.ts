import { inject, provideAppInitializer } from '@angular/core';
import { ActionBarItem } from '../providers/nav-builder/nav-builder-types';
import { NavBuilderService } from '../providers/nav-builder/nav-builder.service';

/**
 * @description
 * Adds a button to the ActionBar at the top right of each list or detail view. The locationId can
 * be determined by pressing `ctrl + u` when running the Admin UI in dev mode.
 *
 * @example
 * ```ts title="providers.ts"
 * export default [
 *     addActionBarItem({
 *         id: 'print-invoice',
 *         label: 'Print Invoice',
 *         locationId: 'order-detail',
 *         routerLink: ['/extensions/invoicing'],
 *     }),
 * ];
 * ```
 * @docsCategory action-bar
 */
export function addActionBarItem(config: ActionBarItem) {
    return provideAppInitializer(() => {
        const initializerFn = ((navBuilderService: NavBuilderService) => () => {
            navBuilderService.addActionBarItem(config);
        })(inject(NavBuilderService));
        return initializerFn();
    });
}
