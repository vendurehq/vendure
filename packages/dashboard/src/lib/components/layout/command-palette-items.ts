import {
    CommandPaletteSelectContext,
    DashboardCommandPaletteItemDefinition,
} from '@/vdb/framework/extension-api/types/command-palette.js';
import { NavMenuItem, NavMenuSection } from '@/vdb/framework/nav-menu/nav-menu-extensions.js';
import type { LucideIcon } from 'lucide-react';
import { buildShortcutMap } from './navigation-shortcuts.js';

/**
 * A row of the command palette: a page of the nav menu, or an entry an extension added.
 * Titles are untranslated message ids. A row has a `url` or an `onSelect`.
 */
export interface CommandPaletteItem {
    /** Unique across the palette: extension entries are prefixed, so they never clash with a page. */
    id: string;
    title: string;
    url?: string;
    onSelect?: (context: CommandPaletteSelectContext) => void | Promise<void>;
    icon?: LucideIcon;
    /** The title of the section the page sits in, for search. */
    sectionTitle?: string;
    /** More words the search matches. */
    keywords?: string[];
    /** The second key of the `G` navigation chord, when the page has a valid one. */
    shortcut?: string;
    /**
     * The nav menu item the row comes from, for lookups keyed by the item, such as a lock.
     * Unset for an extension entry.
     */
    source?: NavMenuItem;
}

export interface CommandPaletteGroup {
    id: string;
    /** The section title, or undefined for the pages that sit at the top level of the menu. */
    title?: string;
    items: CommandPaletteItem[];
}

const TOP_LEVEL_GROUP_ID = 'top-level';

export interface CommandPaletteExtensionOptions {
    /** The entries extensions added. */
    extensionItems?: DashboardCommandPaletteItemDefinition[];
    /** Whether the administrator holds ANY of the given permissions on the active channel. */
    hasPermissions?: (permissions: string[]) => boolean;
    /**
     * The titles of all nav sections by id, before permissions apply, so an entry whose group
     * is a section the administrator cannot see still gets that section's heading.
     */
    sectionTitles?: ReadonlyMap<string, string>;
}

/**
 * Turns the resolved navigation menu into the groups of the command palette: one group for
 * the top-level pages, then one group per section, in sidebar order. A shortcut is shown only
 * when the `G` chord accepts it, so the hint never names a key that does nothing.
 *
 * Extension entries the administrator has the permissions for are then added: see
 * {@link addExtensionItems}.
 */
export function buildCommandPaletteGroups(
    resolved: Array<NavMenuSection | NavMenuItem>,
    { extensionItems = [], hasPermissions = () => true, sectionTitles }: CommandPaletteExtensionOptions = {},
): CommandPaletteGroup[] {
    const groups = buildNavGroups(resolved);
    const permitted = extensionItems.filter(item => {
        if (!item.requiresPermission) {
            return true;
        }
        return hasPermissions(
            Array.isArray(item.requiresPermission) ? item.requiresPermission : [item.requiresPermission],
        );
    });
    return addExtensionItems(groups, permitted, sectionTitles);
}

/** Sorts by `order` ascending, entries without one last, then by title. */
function sortByOrder(a: DashboardCommandPaletteItemDefinition, b: DashboardCommandPaletteItemDefinition) {
    const orderA = a.order ?? Number.MAX_SAFE_INTEGER;
    const orderB = b.order ?? Number.MAX_SAFE_INTEGER;
    return orderA === orderB ? a.title.localeCompare(b.title) : orderA - orderB;
}

/**
 * Adds extension entries after the pages of their group. A `group` that is the id of a nav
 * section joins that section's group; any other value makes a group of its own, after the
 * nav groups, in the order the groups first appear. Its heading is the title of the nav
 * section with that id when there is one (hidden from this administrator), else the value
 * itself. An entry without a group joins the
 * top-level pages, whose group is created at the top when the menu has none.
 */
function addExtensionItems(
    navGroups: CommandPaletteGroup[],
    items: DashboardCommandPaletteItemDefinition[],
    sectionTitles?: ReadonlyMap<string, string>,
): CommandPaletteGroup[] {
    if (items.length === 0) {
        return navGroups;
    }
    const groups = navGroups.map(group => ({ ...group, items: [...group.items] }));
    const findOrCreate = (groupId: string | undefined) => {
        const id = groupId ?? TOP_LEVEL_GROUP_ID;
        let group = groups.find(g => g.id === id);
        if (!group) {
            group = {
                id,
                title: groupId === undefined ? undefined : (sectionTitles?.get(groupId) ?? groupId),
                items: [],
            };
            if (groupId === undefined) {
                groups.unshift(group);
            } else {
                groups.push(group);
            }
        }
        return group;
    };
    for (const item of [...items].sort(sortByOrder)) {
        const group = findOrCreate(item.group);
        group.items.push({
            id: `extension:${item.id}`,
            title: item.title,
            url: item.url,
            onSelect: item.onSelect,
            icon: item.icon,
            sectionTitle: group.title,
            keywords: item.keywords,
        });
    }
    return groups;
}

function buildNavGroups(resolved: Array<NavMenuSection | NavMenuItem>): CommandPaletteGroup[] {
    // The sidebar order: the top placement, then the bottom one. Entries with neither
    // do not show in the sidebar, so they do not show here.
    const ordered = [
        ...resolved.filter(entry => entry.placement === 'top'),
        ...resolved.filter(entry => entry.placement === 'bottom'),
    ];
    // The same shortcut map as the chord handler in the sidebar.
    const shortcutMap = buildShortcutMap(ordered);
    const shortcutOf = (item: NavMenuItem) =>
        item.shortcut && shortcutMap.get(item.shortcut) === item ? item.shortcut : undefined;
    const topLevel: CommandPaletteItem[] = [];
    const sections: CommandPaletteGroup[] = [];
    for (const entry of ordered) {
        if (!('items' in entry)) {
            if ('url' in entry && entry.url) {
                topLevel.push({
                    id: entry.id,
                    title: entry.title,
                    url: entry.url,
                    icon: entry.icon,
                    shortcut: shortcutOf(entry),
                    source: entry,
                });
            }
            continue;
        }
        const items = (entry.items ?? []).map(item => ({
            id: item.id,
            title: item.title,
            url: item.url,
            icon: item.icon ?? entry.icon,
            sectionTitle: entry.title,
            shortcut: shortcutOf(item),
            source: item,
        }));
        if (items.length > 0) {
            sections.push({ id: entry.id, title: entry.title, items });
        }
    }
    return topLevel.length > 0 ? [{ id: TOP_LEVEL_GROUP_ID, items: topLevel }, ...sections] : sections;
}
