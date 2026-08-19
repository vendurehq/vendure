import { describe, expect, it } from 'vitest';

import { buildDashboardUserContext } from '../user-context/dashboard-user-context.js';

import { NavMenuConfig, NavMenuItem, NavMenuSection } from './nav-menu-extensions.js';
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

/** Narrows to a section, failing the test rather than casting. */
function section(config: NavMenuConfig, id: string): NavMenuSection {
    const found = config.sections.find(entry => entry.id === id);
    if (!found || !('items' in found)) {
        throw new Error(`Expected a section with id "${id}"`);
    }
    return found;
}

/** Narrows to a top-level item that is not a section. */
function bareItem(config: NavMenuConfig, id: string): NavMenuItem {
    const found = config.sections.find(entry => entry.id === id);
    if (!found || !('url' in found)) {
        throw new Error(`Expected a bare item with id "${id}"`);
    }
    return found;
}

function items(config: NavMenuConfig, sectionId: string): NavMenuItem[] {
    return section(config, sectionId).items ?? [];
}

describe('setNavVisibility', () => {
    it('sets a predicate on a nested item by id', () => {
        const result = setNavVisibility(sample(), ['products'], () => false);
        expect(items(result, 'catalog')[0].isVisible?.(ctx)).toBe(false);
        expect(items(result, 'catalog')[1].isVisible).toBeUndefined();
    });

    it('sets a predicate on a bare top-level item', () => {
        const result = setNavVisibility(sample(), ['insights'], () => false);
        expect(bareItem(result, 'insights').isVisible?.(ctx)).toBe(false);
    });

    it('ANDs onto an existing predicate rather than replacing it', () => {
        // Order matters. The FIRST predicate hides; the SECOND would show on its
        // own. Only genuine AND-composition keeps the result false. Under an
        // implementation that replaced isVisible instead of composing, the second
        // call would win and this would be true.
        const once = setNavVisibility(sample(), ['products'], () => false);
        const twice = setNavVisibility(once, ['products'], () => true);
        expect(items(twice, 'catalog')[0].isVisible?.(ctx)).toBe(false);
    });

    it('does not mutate the input config', () => {
        const input = sample();
        setNavVisibility(input, ['products'], () => false);
        expect(items(input, 'catalog')[0].isVisible).toBeUndefined();
    });
});

describe('keepOnlyNavItems', () => {
    it('hides everything except the named ids', () => {
        const result = keepOnlyNavItems(sample(), ['pos-home']);
        expect(bareItem(result, 'insights').isVisible?.(ctx)).toBe(false);
        expect(items(result, 'catalog')[0].isVisible?.(ctx)).toBe(false);
        expect(items(result, 'pos')[0].isVisible).toBeUndefined();
    });

    it('keeps the parent section of a kept item visible', () => {
        const result = keepOnlyNavItems(sample(), ['pos-home']);
        expect(section(result, 'pos').isVisible).toBeUndefined();
    });

    it('keeps a named section and all of its items', () => {
        const result = keepOnlyNavItems(sample(), ['catalog']);
        expect(section(result, 'catalog').isVisible).toBeUndefined();
        expect(items(result, 'catalog').every(item => item.isVisible === undefined)).toBe(true);
    });

    it('hides a section when neither it nor any of its items is named', () => {
        const result = keepOnlyNavItems(sample(), ['pos-home']);
        expect(section(result, 'catalog').isVisible?.(ctx)).toBe(false);
    });

    it('does not mutate the input config', () => {
        const input = sample();
        keepOnlyNavItems(input, ['pos-home']);
        expect(items(input, 'catalog')[0].isVisible).toBeUndefined();
        expect(bareItem(input, 'insights').isVisible).toBeUndefined();
    });

    it('still hides an entry whose existing predicate throws', () => {
        // resolveNavMenu fails open on a throwing predicate, so ordering is
        // load-bearing: without the short-circuit this entry would come back visible.
        const withThrower = setNavVisibility(sample(), ['products'], () => {
            throw new Error('predicate from another plugin is broken');
        });
        const result = keepOnlyNavItems(withThrower, ['pos-home']);
        expect(items(result, 'catalog')[0].isVisible?.(ctx)).toBe(false);
    });
});
