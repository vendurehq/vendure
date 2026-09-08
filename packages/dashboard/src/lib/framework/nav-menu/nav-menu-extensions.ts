import type { LucideIcon } from 'lucide-react';

import { globalRegistry } from '../registry/global-registry.js';

// Define the placement options for navigation sections
export type NavMenuSectionPlacement = 'top' | 'bottom';

/**
 * A key which can be used as the second key in the global `G` navigation chord.
 * `G` itself is excluded because it starts the chord.
 */
export type NavigationShortcut =
    | 'a'
    | 'b'
    | 'c'
    | 'd'
    | 'e'
    | 'f'
    | 'h'
    | 'i'
    | 'j'
    | 'k'
    | 'l'
    | 'm'
    | 'n'
    | 'o'
    | 'p'
    | 'q'
    | 'r'
    | 's'
    | 't'
    | 'u'
    | 'v'
    | 'w'
    | 'x'
    | 'y'
    | 'z'
    | '0'
    | '1'
    | '2'
    | '3'
    | '4'
    | '5'
    | '6'
    | '7'
    | '8'
    | '9';

/** The shortcuts reserved by the Dashboard's built-in navigation items. */
export const BUILT_IN_NAVIGATION_SHORTCUTS = {
    a: 'assets',
    c: 'customers',
    d: 'insights',
    m: 'promotions',
    o: 'orders',
    p: 'products',
    s: 'global-settings',
} as const satisfies Partial<Record<NavigationShortcut, string>>;

/** A navigation shortcut which can be assigned by a Dashboard extension. */
export type DashboardExtensionNavigationShortcut = Exclude<
    NavigationShortcut,
    keyof typeof BUILT_IN_NAVIGATION_SHORTCUTS
>;

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
    /**
     * @description
     * Optional second key for the global `G` navigation chord.
     */
    shortcut?: NavigationShortcut;
}

export interface NavMenuSection extends Omit<NavMenuItem, 'url' | 'shortcut'> {
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

export interface NavigationShortcutValidationResult {
    config: NavMenuConfig;
    errors: string[];
}

function validateShortcutDeclaration(item: NavMenuItem): { error?: string; extensionShortcut?: string } {
    const shortcut = item.shortcut as string | undefined;
    if (!shortcut) {
        return {};
    }
    if (!/^[a-fh-z0-9]$/.test(shortcut)) {
        return {
            error:
                `Invalid navigation shortcut "${shortcut}" declared by "${item.id}". ` +
                'Shortcuts must be one lowercase letter or digit other than "g".',
        };
    }
    const builtInOwner =
        BUILT_IN_NAVIGATION_SHORTCUTS[shortcut as keyof typeof BUILT_IN_NAVIGATION_SHORTCUTS];
    if (!builtInOwner) {
        return { extensionShortcut: shortcut };
    }
    if (item.id === builtInOwner) {
        return {};
    }
    return {
        error:
            `Navigation shortcut collision: G → ${shortcut.toUpperCase()} is reserved by ` +
            `the built-in navigation item "${builtInOwner}" and cannot be declared by "${item.id}".`,
    };
}

/**
 * Validates the final, fully-composed navigation configuration and removes shortcuts which
 * cannot be activated safely. Keeping this at the navigation seam means extensions do not
 * need to know which other extensions are installed.
 */
export function validateNavigationShortcuts(config: NavMenuConfig): NavigationShortcutValidationResult {
    const errors: string[] = [];
    const items = config.sections.flatMap(section => ('url' in section ? [section] : (section.items ?? [])));
    const disabledItems = new Set<NavMenuItem>();
    const extensionShortcuts = new Map<string, NavMenuItem[]>();

    for (const item of items) {
        const { error, extensionShortcut } = validateShortcutDeclaration(item);
        if (error) {
            disabledItems.add(item);
            errors.push(error);
            continue;
        }
        if (!extensionShortcut) {
            continue;
        }
        extensionShortcuts.set(extensionShortcut, [
            ...(extensionShortcuts.get(extensionShortcut) ?? []),
            item,
        ]);
    }

    for (const [shortcut, matches] of extensionShortcuts) {
        if (matches.length < 2) {
            continue;
        }
        for (const item of matches) {
            disabledItems.add(item);
        }
        errors.push(
            `Navigation shortcut collision: G → ${shortcut.toUpperCase()} is declared by ${matches
                .map(item => `"${item.id}"`)
                .join(' and ')}. Choose a different shortcut for one of these navigation items.`,
        );
    }

    if (disabledItems.size === 0) {
        return { config, errors };
    }

    return {
        config: {
            ...config,
            sections: config.sections.map(section => {
                if ('url' in section) {
                    return disabledItems.has(section) ? { ...section, shortcut: undefined } : section;
                }
                return {
                    ...section,
                    items: section.items?.map(item =>
                        disabledItems.has(item) ? { ...item, shortcut: undefined } : item,
                    ),
                };
            }),
        },
        errors,
    };
}
