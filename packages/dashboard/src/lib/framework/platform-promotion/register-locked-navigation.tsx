import { LockedCapabilityPage } from '@/vdb/components/platform-promotion/locked-capability-page.js';
import {
    ArrowLeftRight,
    FileText,
    LayoutGrid,
    LucideIcon,
    Search,
    ShieldCheck,
    Tag,
    Wrench,
} from 'lucide-react';

import {
    addNavMenuItem,
    addNavMenuSection,
    getNavMenuConfig,
    NavMenuConfig,
    NavMenuItem,
} from '../nav-menu/nav-menu-extensions.js';
import { extensionRoutes, registerRoute } from '../page/page-api.js';

import type { DashboardPromotionV1 } from './platform-promotion-types.js';

// The icons of the Platform nav sections. Importing only these keeps the other lucide icons
// out of the bundle. An unknown name falls back to a neutral icon.
const SECTION_ICONS: Record<string, LucideIcon> = {
    ArrowLeftRight,
    FileText,
    Search,
    ShieldCheck,
    Tag,
    Wrench,
};

/**
 * Maps each locked nav item which this module added to its capability key. The key is the
 * item object, so an item that a plugin adds with the same id is not taken as locked.
 */
const lockedNavItemCapabilities = new WeakMap<NavMenuItem, string>();

export function getLockedNavItemCapability(item: NavMenuItem): string | undefined {
    return lockedNavItemCapabilities.get(item);
}

function navItems(config: NavMenuConfig): NavMenuItem[] {
    return config.sections.flatMap(section => ('url' in section ? [section] : (section.items ?? [])));
}

/**
 * Adds the promoted Platform nav items, and a locked page at the route of each one.
 * Call it after the extensions and their nav menu modifiers are applied: when a Platform
 * plugin is installed, its own nav item and route are already there, and the locked entry
 * is not added.
 *
 * All promoted items are added, because the License Guard can report the granted set later.
 * The nav menu and the locked page hide an item while its capability is not locked.
 */
export function registerLockedNavigation(promotion: DashboardPromotionV1) {
    for (const item of promotion.navItems.filter(i => i.promoted)) {
        const config = getNavMenuConfig();
        if (
            navItems(config).some(
                existing =>
                    !lockedNavItemCapabilities.has(existing) &&
                    (existing.id === item.id || existing.url === item.url),
            )
        ) {
            continue;
        }
        if (!config.sections.some(section => section.id === item.sectionId)) {
            const section = promotion.navSections.find(s => s.id === item.sectionId);
            if (!section) {
                continue;
            }
            addNavMenuSection({
                id: section.id,
                title: section.label,
                icon: SECTION_ICONS[section.icon] ?? LayoutGrid,
                order: section.order,
                placement: section.placement,
                items: [],
            });
        }
        const lockedItem: NavMenuItem = { id: item.id, title: item.label, url: item.url, order: item.order };
        lockedNavItemCapabilities.set(lockedItem, item.capability);
        addNavMenuItem(lockedItem, item.sectionId);
        if (!extensionRoutes.has(item.url)) {
            registerRoute({ path: item.url, component: () => <LockedCapabilityPage navItem={item} /> });
        }
    }
}
