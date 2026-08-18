import type { DashboardUserContext } from '../user-context/dashboard-user-context.js';

import { NavMenuConfig, NavMenuItem, NavMenuSection, NavMenuTransform } from './nav-menu-extensions.js';

/**
 * Sorts by the optional `order` prop ascending, then alphabetically by title.
 * Ported unchanged from nav-main.tsx.
 */
function sortByOrder<T extends { order?: number; title: string }>(a: T, b: T) {
    const orderA = a.order ?? Number.MAX_SAFE_INTEGER;
    const orderB = b.order ?? Number.MAX_SAFE_INTEGER;
    if (orderA === orderB) {
        return a.title.localeCompare(b.title);
    }
    return orderA - orderB;
}

function passesPermission(item: NavMenuItem | NavMenuSection, ctx: DashboardUserContext): boolean {
    if (!item.requiresPermission) {
        return true;
    }
    const permissions = Array.isArray(item.requiresPermission)
        ? item.requiresPermission
        : [item.requiresPermission];
    return ctx.hasPermissions(permissions);
}

/**
 * @description
 * Applies nav menu transforms, then filters and sorts the result. Pure, so it can be
 * unit tested without rendering.
 *
 * Returns entries of both placements in one pass; callers partition by `placement`.
 *
 * @since 3.8.0
 */
export function resolveNavMenu(
    config: NavMenuConfig,
    ctx: DashboardUserContext,
    transforms: NavMenuTransform[],
): Array<NavMenuSection | NavMenuItem> {
    const transformed = config;

    return transformed.sections
        .slice()
        .sort(sortByOrder)
        .map(section => {
            if ('items' in section) {
                const items = (section.items ?? [])
                    .filter(item => passesPermission(item, ctx))
                    .sort(sortByOrder);
                return { ...section, items };
            }
            return section;
        })
        .filter(section => {
            if ('items' in section) {
                return !!section.items && section.items.length > 0;
            }
            return passesPermission(section as NavMenuItem, ctx);
        });
}
