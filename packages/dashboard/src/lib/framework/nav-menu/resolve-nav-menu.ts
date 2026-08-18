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

const warnedIds = new Set<string>();

function warnOnce(id: string, message: string) {
    if (warnedIds.has(id)) {
        return;
    }
    warnedIds.add(id);
    // eslint-disable-next-line no-console
    console.warn(message);
}

/**
 * @description
 * Clears the once-per-key warning dedup state. Intended for tests, so that a
 * suite exercising the same failing entry twice sees a warning each time.
 *
 * @since 3.8.0
 */
export function resetNavMenuWarnings() {
    warnedIds.clear();
}

function isVisibleFor(item: NavMenuItem | NavMenuSection, ctx: DashboardUserContext): boolean {
    if (!item.isVisible) {
        return true;
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

function applyTransforms(
    config: NavMenuConfig,
    ctx: DashboardUserContext,
    transforms: NavMenuTransform[],
): NavMenuConfig {
    let result = config;
    for (const [index, transform] of transforms.entries()) {
        try {
            const next = transform(result, ctx);
            if (next && Array.isArray(next.sections)) {
                result = next;
            } else {
                warnOnce(
                    `transform-shape:${index}`,
                    `[Dashboard] A navMenuTransform at index ${index} returned an invalid result. ` +
                        `Expected an object with a "sections" array; the transform was skipped.`,
                );
            }
        } catch (e) {
            warnOnce(
                `transform-threw:${index}`,
                `[Dashboard] A navMenuTransform at index ${index} threw and was skipped. ${String(e)}`,
            );
        }
    }
    return result;
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
    const transformed = applyTransforms(config, ctx, transforms);

    return transformed.sections
        .slice()
        .sort(sortByOrder)
        .map(section => {
            if ('items' in section) {
                const items = (section.items ?? [])
                    .filter(item => passesPermission(item, ctx) && isVisibleFor(item, ctx))
                    .sort(sortByOrder);
                return { ...section, items };
            }
            return section;
        })
        .filter(section => {
            if (!isVisibleFor(section, ctx)) {
                return false;
            }
            if ('items' in section) {
                return !!section.items && section.items.length > 0;
            }
            return passesPermission(section as NavMenuItem, ctx);
        });
}
