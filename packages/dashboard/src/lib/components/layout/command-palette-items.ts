import { NavMenuItem, NavMenuSection } from '@/vdb/framework/nav-menu/nav-menu-extensions.js';
import type { LucideIcon } from 'lucide-react';
import { buildShortcutMap } from './navigation-shortcuts.js';

/** A page the command palette can open. Titles are untranslated message ids. */
export interface CommandPaletteItem {
    id: string;
    title: string;
    url: string;
    icon?: LucideIcon;
    /** The title of the section the page sits in, for search. */
    sectionTitle?: string;
    /** The second key of the `G` navigation chord, when the page has a valid one. */
    shortcut?: string;
}

export interface CommandPaletteGroup {
    id: string;
    /** The section title, or undefined for the pages that sit at the top level of the menu. */
    title?: string;
    items: CommandPaletteItem[];
}

/**
 * Turns the resolved navigation menu into the groups of the command palette: one group for
 * the top-level pages, then one group per section, in sidebar order. A shortcut is shown only
 * when the `G` chord accepts it, so the hint never names a key that does nothing.
 */
export function buildCommandPaletteGroups(
    resolved: Array<NavMenuSection | NavMenuItem>,
): CommandPaletteGroup[] {
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
        }));
        if (items.length > 0) {
            sections.push({ id: entry.id, title: entry.title, items });
        }
    }
    return topLevel.length > 0 ? [{ id: 'top-level', items: topLevel }, ...sections] : sections;
}
