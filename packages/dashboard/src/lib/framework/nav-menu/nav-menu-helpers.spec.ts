import { describe, expect, it } from 'vitest';

import { buildDashboardUserContext } from '../user-context/dashboard-user-context.js';

import { NavMenuConfig } from './nav-menu-extensions.js';
import { keepOnlyNavItems, setNavVisibility } from './nav-menu-helpers.js';

const ctx = buildDashboardUserContext({
    administrator: undefined,
    channels: undefined,
    activeChannel: undefined,
    customFields: undefined,
    hasPermissions: () => true,
});

const sample = (): NavMenuConfig => ({
    sections: [
        { id: 'insights', title: 'Insights', url: '/', placement: 'top' },
        {
            id: 'catalog',
            title: 'Catalog',
            placement: 'top',
            items: [
                { id: 'products', title: 'Products', url: '/products' },
                { id: 'facets', title: 'Facets', url: '/facets' },
            ],
        },
        { id: 'pos', title: 'POS', placement: 'top', items: [{ id: 'pos-home', title: 'POS', url: '/pos' }] },
    ],
});

describe('setNavVisibility', () => {
    it('sets a predicate on a nested item by id', () => {
        const result = setNavVisibility(sample(), ['products'], () => false);
        const catalog = result.sections.find(s => s.id === 'catalog') as any;
        expect(catalog.items[0].isVisible?.(ctx)).toBe(false);
        expect(catalog.items[1].isVisible).toBeUndefined();
    });

    it('sets a predicate on a bare top-level item', () => {
        const result = setNavVisibility(sample(), ['insights'], () => false);
        const insights = result.sections.find(s => s.id === 'insights') as any;
        expect(insights.isVisible?.(ctx)).toBe(false);
    });

    it('ANDs onto an existing predicate rather than replacing it', () => {
        // Order matters. The FIRST predicate hides; the SECOND would show on its
        // own. Only genuine AND-composition keeps the result false. Under an
        // implementation that replaced isVisible instead of composing, the second
        // call would win and this would be true.
        const once = setNavVisibility(sample(), ['products'], () => false);
        const twice = setNavVisibility(once, ['products'], () => true);
        const catalog = twice.sections.find(s => s.id === 'catalog') as any;
        expect(catalog.items[0].isVisible?.(ctx)).toBe(false);
    });

    it('does not mutate the input config', () => {
        const input = sample();
        setNavVisibility(input, ['products'], () => false);
        const catalog = input.sections.find(s => s.id === 'catalog') as any;
        expect(catalog.items[0].isVisible).toBeUndefined();
    });
});

describe('keepOnlyNavItems', () => {
    it('hides everything except the named ids', () => {
        const result = keepOnlyNavItems(sample(), ['pos-home']);
        const insights = result.sections.find(s => s.id === 'insights') as any;
        const catalog = result.sections.find(s => s.id === 'catalog') as any;
        const pos = result.sections.find(s => s.id === 'pos') as any;
        expect(insights.isVisible?.(ctx)).toBe(false);
        expect(catalog.items[0].isVisible?.(ctx)).toBe(false);
        expect(pos.items[0].isVisible).toBeUndefined();
    });

    it('keeps the parent section of a kept item visible', () => {
        const result = keepOnlyNavItems(sample(), ['pos-home']);
        const pos = result.sections.find(s => s.id === 'pos') as any;
        expect(pos.isVisible).toBeUndefined();
    });

    it('keeps a named section and all of its items', () => {
        const result = keepOnlyNavItems(sample(), ['catalog']);
        const catalog = result.sections.find(s => s.id === 'catalog') as any;
        expect(catalog.isVisible).toBeUndefined();
        expect(catalog.items.every((i: any) => i.isVisible === undefined)).toBe(true);
    });

    it('hides a section when neither it nor any of its items is named', () => {
        const result = keepOnlyNavItems(sample(), ['pos-home']);
        const catalog = result.sections.find(s => s.id === 'catalog') as any;
        expect(catalog.isVisible?.(ctx)).toBe(false);
    });

    it('does not mutate the input config', () => {
        const input = sample();
        keepOnlyNavItems(input, ['pos-home']);
        const catalog = input.sections.find(s => s.id === 'catalog') as any;
        const insights = input.sections.find(s => s.id === 'insights') as any;
        expect(catalog.items[0].isVisible).toBeUndefined();
        expect(insights.isVisible).toBeUndefined();
    });
});
