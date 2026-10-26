import type { DashboardUserContext } from '../user-context/dashboard-user-context.js';

import { NavMenuConfig, NavMenuItem, NavMenuSection } from './nav-menu-extensions.js';

/** Sorts by the optional `order` prop ascending, then alphabetically by title. */
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

const warnedIds = new Set<string>();

/**
 * Warns once per key. Also used by the nav menu helpers, which swallow a throw from a
 * composed predicate and would otherwise report nothing.
 */
export function warnOnce(id: string, message: string) {
    if (warnedIds.has(id)) {
        return;
    }
    warnedIds.add(id);
    // eslint-disable-next-line no-console
    console.warn(message);
}

/**
 * Clears the once-per-key warning dedup state. Intended for tests, so that a
 * suite exercising the same failing entry twice sees a warning each time.
 */
export function resetNavMenuWarnings() {
    warnedIds.clear();
}

function isVisibleFor(
    item: NavMenuItem | NavMenuSection,
    ctx: DashboardUserContext,
    userContextPending: boolean,
): boolean {
    if (!item.isVisible) {
        return true;
    }
    // The context is still loading, so the predicate would read an incomplete one.
    // Only the entries which actually carry a predicate wait; the rest paint at once.
    if (userContextPending) {
        return false;
    }
    try {
        return item.isVisible(ctx);
    } catch (e) {
        // Fail open. An extension bug must not blank the sidebar. Note this rule is
        // specific to presentation; route access control must fail CLOSED.
        warnOnce(
            `isVisible:${item.id}`,
            `[Dashboard] The isVisible predicate for nav entry "${item.id}" threw, so the ` +
                `entry is being shown. ${String(e)}`,
        );
        return true;
    }
}

/**
 * @description
 * Filters and sorts the nav menu config for the given user. Pure, so it can be unit
 * tested without rendering.
 *
 * Returns entries of both placements in one pass; callers partition by `placement`.
 *
 * Pass `userContextPending` while `ctx` is still loading: entries carrying an
 * `isVisible` predicate are then withheld, rather than shown and hidden a moment later.
 *
 * @since 3.8.0
 */
export function resolveNavMenu(
    config: NavMenuConfig,
    ctx: DashboardUserContext,
    options: { userContextPending?: boolean } = {},
): Array<NavMenuSection | NavMenuItem> {
    const pending = options.userContextPending ?? false;
    return config.sections
        .slice()
        .sort(sortByOrder)
        .map(section => {
            if ('items' in section) {
                const items = (section.items ?? [])
                    .filter(item => passesPermission(item, ctx) && isVisibleFor(item, ctx, pending))
                    .sort(sortByOrder);
                return { ...section, items };
            }
            return section;
        })
        .filter(section => {
            if (!passesPermission(section, ctx) || !isVisibleFor(section, ctx, pending)) {
                return false;
            }
            // A section with no items left is dropped: expanding it would show nothing.
            return 'items' in section ? !!section.items && section.items.length > 0 : true;
        });
}
