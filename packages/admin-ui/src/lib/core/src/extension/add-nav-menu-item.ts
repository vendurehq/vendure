import { inject, provideAppInitializer } from '@angular/core';
import { NavMenuItem, NavMenuSection } from '../providers/nav-builder/nav-builder-types';
import { NavBuilderService } from '../providers/nav-builder/nav-builder.service';

/**
 * @description
 * Add a section to the main nav menu. Providing the `before` argument will
 * move the section before any existing section with the specified id. If
 * omitted (or if the id is not found) the section will be appended to the
 * existing set of sections.
 * This should be used in the NgModule `providers` array of your ui extension module.
 *
 * @example
 * ```ts title="providers.ts"
 * import { addNavMenuSection } from '\@vendure/admin-ui/core';
 *
 * export default [
 *     addNavMenuSection({
 *         id: 'reports',
 *         label: 'Reports',
 *         items: [{
 *             // ...
 *         }],
 *     },
 *     'settings'),
 * ];
 * ```
 * @docsCategory nav-menu
 */
export function addNavMenuSection(config: NavMenuSection, before?: string) {
    return provideAppInitializer(() => {
        const initializerFn = ((navBuilderService: NavBuilderService) => () => {
            navBuilderService.addNavMenuSection(config, before);
        })(inject(NavBuilderService));
        return initializerFn();
    });
}

/**
 * @description
 * Add a menu item to an existing section specified by `sectionId`. The id of the section
 * can be found by inspecting the DOM and finding the `data-section-id` attribute.
 * Providing the `before` argument will move the item before any existing item with the specified id.
 * If omitted (or if the name is not found) the item will be appended to the
 * end of the section.
 *
 * This should be used in the NgModule `providers` array of your ui extension module.
 *
 * @example
 * ```ts title="providers.ts"
 * import { addNavMenuItem } from '\@vendure/admin-ui/core';
 *
 * export default [
 *     addNavMenuItem({
 *         id: 'reviews',
 *         label: 'Product Reviews',
 *         routerLink: ['/extensions/reviews'],
 *         icon: 'star',
 *     },
 *     'marketing'),
 * ];
 * ```
 *
 * @docsCategory nav-menu
 */
export function addNavMenuItem(config: NavMenuItem, sectionId: string, before?: string) {
    return provideAppInitializer(() => {
        const initializerFn = ((navBuilderService: NavBuilderService) => () => {
            navBuilderService.addNavMenuItem(config, sectionId, before);
        })(inject(NavBuilderService));
        return initializerFn();
    });
}
