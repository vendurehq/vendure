import type { DashboardUserContext } from '../user-context/dashboard-user-context.js';

import { NavMenuConfig, NavMenuItem, NavMenuSection } from './nav-menu-extensions.js';
import { warnOnce } from './resolve-nav-menu.js';

type Predicate = (ctx: DashboardUserContext) => boolean;

/**
 * @description
 * Names the nav entries a visibility helper acts on. `sections` holds the ids of the
 * top-level entries of `NavMenuConfig.sections`, `items` the ids of the entries nested
 * inside them.
 *
 * The two are named separately because a section and one of its items may carry the
 * same id, as the built-in Customers section and Customers item do.
 *
 * @docsCategory extensions-api
 * @docsPage Navigation
 * @since 3.8.0
 */
export interface NavMenuTarget {
    /** Ids of top-level entries, whether they hold items or link somewhere directly. */
    sections?: string[];
    /** Ids of entries nested inside a section. */
    items?: string[];
}

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

const quote = (ids: string[]) => ids.map(id => `"${id}"`).join(', ');

/**
 * An id which matches no entry is otherwise silent: it has no effect, and with
 * keepOnlyNavEntries a single typo hides every other nav entry.
 */
function warnOnUnmatchedIds(
    helper: string,
    target: NavMenuTarget,
    matchedSections: Set<string>,
    matchedItems: Set<string>,
) {
    if (process.env.NODE_ENV === 'production') {
        return;
    }
    const unmatched = [
        ...(target.sections ?? []).filter(id => !matchedSections.has(id)),
        ...(target.items ?? []).filter(id => !matchedItems.has(id)),
    ];
    if (!unmatched.length) {
        return;
    }
    warnOnce(
        `${helper}-unmatched:${unmatched.join(',')}`,
        `[Dashboard] ${helper} was given ${quote(unmatched)}, which matched no nav entry. ` +
            `Built-in ids are exported as BUILT_IN_NAV_SECTION_IDS and BUILT_IN_NAV_ITEM_IDS. ` +
            `Note that section ids and item ids are given separately.`,
    );
}

/**
 * @description
 * Returns a new config in which the entries named by `target` have `predicate` ANDed
 * onto their existing `isVisible`.
 *
 * Use this rather than spreading `isVisible` yourself: a plain spread silently
 * discards a predicate that another plugin already set on the same entry.
 *
 * This controls presentation only and is never an authorization mechanism.
 *
 * @example
 * ```ts
 * navSections: config =>
 *     setNavVisibility(config, { items: [BUILT_IN_NAV_ITEM_IDS.Products] }, ctx => !isFloorStaff(ctx)),
 * ```
 *
 * @docsCategory extensions-api
 * @docsPage Navigation
 * @since 3.8.0
 */
export function setNavVisibility(
    config: NavMenuConfig,
    target: NavMenuTarget,
    predicate: Predicate,
): NavMenuConfig {
    const targetSections = new Set(target.sections ?? []);
    const targetItems = new Set(target.items ?? []);
    const matchedSections = new Set<string>();
    const matchedItems = new Set<string>();
    const sections = config.sections.map(section => {
        const isTarget = targetSections.has(section.id);
        if (isTarget) {
            matchedSections.add(section.id);
        }
        let next: NavMenuSection | NavMenuItem = section;
        if ('items' in section) {
            const items = (section.items ?? []).map((item: NavMenuItem) => {
                if (!targetItems.has(item.id)) {
                    return item;
                }
                matchedItems.add(item.id);
                return { ...item, isVisible: andPredicate(item.isVisible, predicate, item.id) };
            });
            next = { ...section, items };
        }
        return isTarget ? { ...next, isVisible: andPredicate(next.isVisible, predicate, next.id) } : next;
    });
    warnOnUnmatchedIds('setNavVisibility', target, matchedSections, matchedItems);
    return { ...config, sections };
}

/**
 * @description
 * Returns a new config in which every entry not named by `target` is hidden. Naming a
 * section keeps all of its items, rather than hiding the ones not named individually.
 * Naming an item keeps the section it sits in.
 *
 * Pass `when` to apply the whitelist only to the administrators it matches. Without it,
 * every entry not named is hidden from everybody.
 *
 * This controls presentation only and is never an authorization mechanism.
 *
 * @example
 * ```ts
 * // Floor staff see only the point-of-sale section; everybody else sees the full menu.
 * navSections: config => keepOnlyNavEntries(config, { sections: ['pos'] }, isFloorStaff),
 * ```
 *
 * @docsCategory extensions-api
 * @docsPage Navigation
 * @since 3.8.0
 */
export function keepOnlyNavEntries(
    config: NavMenuConfig,
    target: NavMenuTarget,
    when?: Predicate,
): NavMenuConfig {
    const keepSections = new Set(target.sections ?? []);
    const keepItems = new Set(target.items ?? []);
    const matchedSections = new Set<string>();
    const matchedItems = new Set<string>();
    const hide: Predicate = when ? ctx => !when(ctx) : () => false;
    const sections = config.sections.map(section => {
        const keepWholeSection = keepSections.has(section.id);
        if (keepWholeSection) {
            matchedSections.add(section.id);
        }
        if (!('items' in section)) {
            return keepWholeSection
                ? section
                : { ...section, isVisible: andPredicate(section.isVisible, hide, section.id) };
        }
        let keptAnyItem = false;
        const items = (section.items ?? []).map((item: NavMenuItem) => {
            const keepItem = keepItems.has(item.id);
            if (keepItem) {
                matchedItems.add(item.id);
            }
            if (keepWholeSection || keepItem) {
                keptAnyItem = true;
                return item;
            }
            return { ...item, isVisible: andPredicate(item.isVisible, hide, item.id) };
        });
        const next: NavMenuSection = { ...section, items };
        return keepWholeSection || keptAnyItem
            ? next
            : { ...next, isVisible: andPredicate(section.isVisible, hide, section.id) };
    });
    warnOnUnmatchedIds('keepOnlyNavEntries', target, matchedSections, matchedItems);
    return { ...config, sections };
}
