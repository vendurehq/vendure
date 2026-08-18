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
        const once = setNavVisibility(sample(), ['products'], () => true);
        const twice = setNavVisibility(once, ['products'], () => false);
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
});
