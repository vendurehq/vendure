import type { DashboardUserContext } from '../user-context/dashboard-user-context.js';

import { NavMenuConfig, NavMenuItem, NavMenuSection } from './nav-menu-extensions.js';
import { warnOnce } from './resolve-nav-menu.js';

type Predicate = (ctx: DashboardUserContext) => boolean;

function andPredicate(existing: Predicate | undefined, added: Predicate, id: string): Predicate {
    if (!existing) {
        return added;
    }
    return ctx => {
        let addedResult: boolean;
        try {
            addedResult = added(ctx);
        } catch (e) {
            // A throw must not escape: resolveNavMenu fails open on one, which would
            // un-hide an entry that `existing` hides. Warn here because a composed
            // predicate is only ever called through this wrapper, so a swallowed throw
            // would otherwise produce no diagnostic at all.
            warnOnce(
                `isVisible-composed:${id}`,
                `[Dashboard] An isVisible predicate added to nav entry "${id}" threw and was ` +
                    `treated as visible. ${String(e)}`,
            );
            addedResult = true;
        }
        // `added` first, so a constant false short-circuits before `existing` can throw.
        return addedResult && existing(ctx);
    };
}

/**
 * @description
 * Returns a new config in which the entries with the given ids have `predicate` ANDed
 * onto their existing `isVisible`. Matches both sections and nested items.
 *
 * Use this rather than spreading `isVisible` yourself: a plain spread silently
 * discards a predicate that another plugin already set on the same entry.
 *
 * This controls presentation only and is never an authorization mechanism.
 *
 * @example
 * ```ts
 * navMenuTransforms: [
 *     (config, ctx) => setNavVisibility(config, ['products'], () => !isFloorStaff(ctx)),
 * ]
 * ```
 *
 * @docsCategory extensions-api
 * @docsPage Navigation
 * @since 3.8.0
 */
export function setNavVisibility(config: NavMenuConfig, ids: string[], predicate: Predicate): NavMenuConfig {
    const target = new Set(ids);
    return {
        ...config,
        sections: config.sections.map(section => {
            const isTarget = target.has(section.id);
            if (!('items' in section)) {
                return isTarget
                    ? { ...section, isVisible: andPredicate(section.isVisible, predicate, section.id) }
                    : section;
            }
            const items = (section.items ?? []).map((item: NavMenuItem) =>
                target.has(item.id)
                    ? { ...item, isVisible: andPredicate(item.isVisible, predicate, item.id) }
                    : item,
            );
            const next: NavMenuSection = { ...section, items };
            return isTarget
                ? { ...next, isVisible: andPredicate(section.isVisible, predicate, section.id) }
                : next;
        }),
    };
}

/**
 * @description
 * Returns a new config in which every entry not named in `ids` is hidden. A section is
 * left visible when it is named, or when one of its items is named. Naming a section
 * directly also keeps all of its items, rather than hiding items that were not
 * individually named.
 *
 * This controls presentation only and is never an authorization mechanism.
 *
 * @example
 * ```ts
 * navMenuTransforms: [
 *     (config, ctx) => (isFloorStaff(ctx) ? keepOnlyNavItems(config, ['pos-home']) : config),
 * ]
 * ```
 *
 * @docsCategory extensions-api
 * @docsPage Navigation
 * @since 3.8.0
 */
export function keepOnlyNavItems(config: NavMenuConfig, ids: string[]): NavMenuConfig {
    const keep = new Set(ids);
    const hide: Predicate = () => false;
    return {
        ...config,
        sections: config.sections.map(section => {
            if (!('items' in section)) {
                return keep.has(section.id)
                    ? section
                    : { ...section, isVisible: andPredicate(section.isVisible, hide, section.id) };
            }
            // A section named directly keeps its children too. Otherwise naming a
            // section would leave it with every item hidden, and resolveNavMenu
            // would drop it as empty - which looks identical to the helper not
            // working at all.
            const keepAllItems = keep.has(section.id);
            const items = (section.items ?? []).map((item: NavMenuItem) =>
                keepAllItems || keep.has(item.id)
                    ? item
                    : { ...item, isVisible: andPredicate(item.isVisible, hide, item.id) },
            );
            const sectionKept = keepAllItems || (section.items ?? []).some(i => keep.has(i.id));
            const next: NavMenuSection = { ...section, items };
            return sectionKept
                ? next
                : { ...next, isVisible: andPredicate(section.isVisible, hide, section.id) };
        }),
    };
}
