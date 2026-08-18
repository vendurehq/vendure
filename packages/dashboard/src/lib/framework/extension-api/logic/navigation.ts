import {
    addNavMenuItem,
    addNavMenuSection,
    NavMenuConfig,
    NavMenuItem,
} from '../../nav-menu/nav-menu-extensions.js';
import { registerRoute } from '../../page/page-api.js';
import { DashboardNavSectionDefinition, DashboardRouteDefinition } from '../types/navigation.js';

export function registerNavigationExtensions(
    navSections?: DashboardNavSectionDefinition[] | ((config: NavMenuConfig) => NavMenuConfig),
    routes?: DashboardRouteDefinition[],
): ((config: NavMenuConfig) => NavMenuConfig) | undefined {
    const navMenuModifier = registerNavSections(navSections);
    registerRoutes(routes);
    return navMenuModifier;
}

function registerNavSections(
    navSections?: DashboardNavSectionDefinition[] | ((config: NavMenuConfig) => NavMenuConfig),
): ((config: NavMenuConfig) => NavMenuConfig) | undefined {
    if (!navSections) {
        return;
    }
    if (typeof navSections === 'function') {
        return navSections;
    }
    for (const section of navSections) {
        addNavMenuSection({
            ...section,
            placement: section.placement ?? 'top',
            order: section.order ?? 999,
            items: [],
        });
    }
}

function registerRoutes(routes?: DashboardRouteDefinition[]) {
    if (!routes) {
        return;
    }
    for (const route of routes) {
        if (route.navMenuItem) {
            const { sectionId, ...navMenuItemProps } = route.navMenuItem;
            const item: NavMenuItem = {
                // Spread so that any field added to NavMenuItem passes through without
                // needing a change here. Field-by-field construction silently dropped
                // new optional fields such as isVisible.
                ...navMenuItemProps,
                url: route.navMenuItem.url ?? route.path,
                id: route.navMenuItem.id ?? route.path,
                title: route.navMenuItem.title ?? route.path,
            };
            addNavMenuItem(item, sectionId);
        }
        if (route.path) {
            registerRoute(route);
        }
    }
}
