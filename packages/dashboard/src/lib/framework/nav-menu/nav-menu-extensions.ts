import type { LucideIcon } from 'lucide-react';

import { globalRegistry } from '../registry/global-registry.js';

// Define the placement options for navigation sections
export type NavMenuSectionPlacement = 'top' | 'bottom';

/**
 * @description
 * Defines an items in the navigation menu.
 *
 * @docsCategory extensions-api
 * @docsPage Navigation
 * @since 3.4.0
 */
export interface NavMenuItem {
    /**
     * @description
     * A unique ID for this nav menu item
     */
    id: string;
    /**
     * @description
     * The title that will appear in the nav menu
     */
    title: string;
    /**
     * @description
     * The url of the route which this nav item links to.
     */
    url: string;
    /**
     * @description
     * An optional icon component to represent the item,
     * which should be imported from `lucide-react`.
     */
    icon?: LucideIcon;
    /**
     * @description
     * The order is an number which allows you to control
     * the relative position in relation to other items in the
     * menu.
     * A higher number appears further down the list.
     */
    order?: number;
    /**
     * Whether this item should appear in the top of bottom section
     * of the nav menu.
     */
    placement?: NavMenuSectionPlacement;
    /**
     * @description
     * This can be used to restrict the menu item to the given
     * permission or permissions.
     */
    requiresPermission?: string | string[];
}

export interface NavMenuSection extends Omit<NavMenuItem, 'url'> {
    defaultOpen?: boolean;
    items?: NavMenuItem[];
}

export interface NavMenuConfig {
    sections: Array<NavMenuSection | NavMenuItem>;
}

globalRegistry.register('navMenuConfig', { sections: [] });

export function getNavMenuConfig() {
    return globalRegistry.get('navMenuConfig');
}

export function setNavMenuConfig(config: NavMenuConfig) {
    globalRegistry.set('navMenuConfig', oldValue => {
        return Object.assign({}, oldValue, config);
    });
}

export function addNavMenuItem(item: NavMenuItem, sectionId: string) {
    const navMenuConfig = getNavMenuConfig();
    navMenuConfig.sections = [...navMenuConfig.sections];
    const sectionIndex = navMenuConfig.sections.findIndex(
        (s: NavMenuSection | NavMenuItem) => s.id === sectionId,
    );
    if (sectionIndex !== -1) {
        const sectionFromConfig = navMenuConfig.sections[sectionIndex];

        if ('items' in sectionFromConfig) {
            const section = {
                ...sectionFromConfig,
                items: [...(sectionFromConfig.items ?? [])],
            };
            const itemIndex = section.items.findIndex((i: NavMenuItem) => i.id === item.id);
            if (itemIndex === -1) {
                section.items.push(item);
                navMenuConfig.sections.splice(sectionIndex, 1, section);
            } else {
                section.items.splice(itemIndex, 1, item);
                navMenuConfig.sections.splice(sectionIndex, 1, section);
            }
        } else {
            navMenuConfig.sections.splice(sectionIndex, 1, item);
        }
    }
}

export function addNavMenuSection(section: NavMenuSection) {
    const navMenuConfig = getNavMenuConfig();
    navMenuConfig.sections = [...navMenuConfig.sections];
    navMenuConfig.sections.push(section);
}
