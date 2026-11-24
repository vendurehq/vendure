import { Settings2, Star, Tags } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';

import {
    DashboardCommandPaletteItemBase,
    DashboardCommandPaletteItemDefinition,
} from '@/vdb/framework/extension-api/types/command-palette.js';
import {
    NavigationShortcut,
    NavMenuItem,
    NavMenuSection,
} from '@/vdb/framework/nav-menu/nav-menu-extensions.js';
import { buildCommandPaletteGroups } from './command-palette-items.js';

const item = (id: string, shortcut?: NavigationShortcut): NavMenuItem => ({
    id,
    title: id,
    url: `/${id}`,
    shortcut,
    placement: 'top',
});

describe('buildCommandPaletteGroups', () => {
    it('puts top-level pages first, then one group per section in menu order', () => {
        const catalog: NavMenuSection = {
            id: 'catalog',
            title: 'Catalog',
            icon: Tags,
            placement: 'top',
            items: [item('products'), item('facets')],
        };
        const settings: NavMenuSection = {
            id: 'settings',
            title: 'Settings',
            icon: Settings2,
            placement: 'bottom',
            items: [item('channels')],
        };
        const unplaced: NavMenuSection = { id: 'unplaced', title: 'Unplaced', items: [item('x')] };

        const groups = buildCommandPaletteGroups([settings, catalog, unplaced, item('insights')]);

        expect(groups.map(g => g.id)).toEqual(['top-level', 'catalog', 'settings']);
        expect(groups[0].title).toBeUndefined();
        const insights = groups[0].items[0];
        expect(groups[0].items).toHaveLength(1);
        expect(insights).toMatchObject({ id: 'insights', title: 'insights', url: '/insights' });
        expect(insights.sectionTitle).toBeUndefined();
        expect(insights.source?.id).toBe('insights');
        expect(groups[1].title).toBe('Catalog');
        expect(groups[1].items.map(i => i.id)).toEqual(['products', 'facets']);
        expect(groups[1].items[0]).toMatchObject({ sectionTitle: 'Catalog', icon: Tags });
    });

    it('keeps an item icon over the section icon', () => {
        const own = { ...item('products'), icon: Settings2 };
        const [group] = buildCommandPaletteGroups([
            { id: 's', title: 'S', icon: Tags, placement: 'top', items: [own] },
        ]);
        expect(group.items[0].icon).toBe(Settings2);
    });

    it('drops sections without items and has no top-level group without top-level pages', () => {
        const groups = buildCommandPaletteGroups([
            { id: 'empty', title: 'Empty', placement: 'top', items: [] },
            { id: 'catalog', title: 'Catalog', placement: 'top', items: [item('products')] },
        ]);
        expect(groups.map(g => g.id)).toEqual(['catalog']);
    });

    it('shows only the shortcuts the G chord accepts', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const groups = buildCommandPaletteGroups([
            {
                id: 'catalog',
                title: 'Catalog',
                placement: 'top',
                items: [item('products', 'p'), item('one', 'x'), item('two', 'x')],
            },
        ]);
        expect(groups[0].items.map(i => i.shortcut)).toEqual(['p', undefined, undefined]);
    });
});

describe('buildCommandPaletteGroups with extension entries', () => {
    const catalog: NavMenuSection = {
        id: 'catalog',
        title: 'Catalog',
        icon: Tags,
        placement: 'top',
        items: [item('products')],
    };
    const entry = (
        id: string,
        extra: Partial<DashboardCommandPaletteItemBase> = {},
    ): DashboardCommandPaletteItemDefinition => ({ id, title: id, url: `/${id}`, ...extra });

    it('lists an entry after the pages of the nav section its group names', () => {
        const groups = buildCommandPaletteGroups([catalog], {
            extensionItems: [entry('reviews', { group: 'catalog', icon: Star, keywords: ['ratings'] })],
        });
        expect(groups.map(g => g.id)).toEqual(['catalog']);
        expect(groups[0].items.map(i => i.id)).toEqual(['products', 'extension:reviews']);
        expect(groups[0].items[1]).toMatchObject({
            title: 'reviews',
            url: '/reviews',
            icon: Star,
            sectionTitle: 'Catalog',
            keywords: ['ratings'],
        });
        expect(groups[0].items[1].source).toBeUndefined();
    });

    it('puts an entry without a group with the top-level pages, creating that group first', () => {
        const withTop = buildCommandPaletteGroups([item('insights'), catalog], {
            extensionItems: [entry('reindex')],
        });
        expect(withTop[0].id).toBe('top-level');
        expect(withTop[0].items.map(i => i.id)).toEqual(['insights', 'extension:reindex']);

        const withoutTop = buildCommandPaletteGroups([catalog], { extensionItems: [entry('reindex')] });
        expect(withoutTop.map(g => g.id)).toEqual(['top-level', 'catalog']);
        expect(withoutTop[0].title).toBeUndefined();
    });

    it('makes a group of its own, after the nav groups, for any other group', () => {
        const groups = buildCommandPaletteGroups([catalog], {
            extensionItems: [entry('a', { group: 'Tools' }), entry('b', { group: 'Tools' })],
        });
        expect(groups.map(g => g.id)).toEqual(['catalog', 'Tools']);
        expect(groups[1].title).toBe('Tools');
        expect(groups[1].items.map(i => i.id)).toEqual(['extension:a', 'extension:b']);
        expect(groups[1].items[0].sectionTitle).toBe('Tools');
    });

    it('heads the group of a nav section the administrator cannot see with its title', () => {
        const groups = buildCommandPaletteGroups([], {
            extensionItems: [entry('stock', { group: 'catalog' })],
            sectionTitles: new Map([['catalog', 'Catalog']]),
        });
        expect(groups).toEqual([
            expect.objectContaining({ id: 'catalog', title: 'Catalog', items: [expect.anything()] }),
        ]);
    });

    it('sorts entries by order, then by title', () => {
        const groups = buildCommandPaletteGroups([], {
            extensionItems: [entry('c'), entry('b', { order: 2 }), entry('a'), entry('d', { order: 1 })],
        });
        expect(groups[0].items.map(i => i.title)).toEqual(['d', 'b', 'a', 'c']);
    });

    it('keeps an action entry without a url', () => {
        const onSelect = vi.fn();
        const groups = buildCommandPaletteGroups([], {
            extensionItems: [{ id: 'clear-cache', title: 'Clear cache', onSelect }],
        });
        expect(groups[0].items[0]).toMatchObject({ onSelect, url: undefined });
    });

    it('hides entries the administrator lacks ANY of the permissions for', () => {
        const held = new Set(['ReadCatalog']);
        const hasPermissions = (permissions: string[]) => permissions.some(p => held.has(p));
        const groups = buildCommandPaletteGroups([], {
            hasPermissions,
            extensionItems: [
                entry('open'),
                entry('single', { requiresPermission: 'ReadCatalog' }),
                entry('any', { requiresPermission: ['UpdateCatalog', 'ReadCatalog'] }),
                entry('denied', { requiresPermission: 'SuperAdmin' }),
            ],
        });
        expect(groups[0].items.map(i => i.title)).toEqual(['any', 'open', 'single']);
    });

    it('returns the nav groups unchanged when no entry is permitted', () => {
        const groups = buildCommandPaletteGroups([catalog], {
            hasPermissions: () => false,
            extensionItems: [entry('denied', { requiresPermission: 'SuperAdmin' })],
        });
        expect(groups.map(g => g.id)).toEqual(['catalog']);
        expect(groups[0].items).toHaveLength(1);
    });
});
