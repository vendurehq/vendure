import { Settings2, Tags } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';

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
});

describe('buildCommandPaletteGroups', () => {
    it('puts top-level pages first, then one group per section in menu order', () => {
        const catalog: NavMenuSection = {
            id: 'catalog',
            title: 'Catalog',
            icon: Tags,
            items: [item('products'), item('facets')],
        };
        const settings: NavMenuSection = {
            id: 'settings',
            title: 'Settings',
            icon: Settings2,
            items: [item('channels')],
        };

        const groups = buildCommandPaletteGroups([catalog, item('insights'), settings]);

        expect(groups.map(g => g.id)).toEqual(['top-level', 'catalog', 'settings']);
        expect(groups[0].title).toBeUndefined();
        expect(groups[0].items).toEqual([
            { id: 'insights', title: 'insights', url: '/insights', icon: undefined, shortcut: undefined },
        ]);
        expect(groups[1].title).toBe('Catalog');
        expect(groups[1].items.map(i => i.id)).toEqual(['products', 'facets']);
        expect(groups[1].items[0]).toMatchObject({ sectionTitle: 'Catalog', icon: Tags });
    });

    it('keeps an item icon over the section icon', () => {
        const own = { ...item('products'), icon: Settings2 };
        const [group] = buildCommandPaletteGroups([{ id: 's', title: 'S', icon: Tags, items: [own] }]);
        expect(group.items[0].icon).toBe(Settings2);
    });

    it('drops sections without items and has no top-level group without top-level pages', () => {
        const groups = buildCommandPaletteGroups([
            { id: 'empty', title: 'Empty', items: [] },
            { id: 'catalog', title: 'Catalog', items: [item('products')] },
        ]);
        expect(groups.map(g => g.id)).toEqual(['catalog']);
    });

    it('shows only the shortcuts the G chord accepts', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const groups = buildCommandPaletteGroups([
            {
                id: 'catalog',
                title: 'Catalog',
                items: [item('products', 'p'), item('one', 'x'), item('two', 'x')],
            },
        ]);
        expect(groups[0].items.map(i => i.shortcut)).toEqual(['p', undefined, undefined]);
    });
});
