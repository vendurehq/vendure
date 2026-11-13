import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildDashboardUserContext } from '../user-context/dashboard-user-context.js';

import { NavMenuConfig, NavMenuItem, NavMenuSection } from './nav-menu-extensions.js';
import { keepOnlyNavEntries, setNavVisibility } from './nav-menu-helpers.js';
import { resetNavMenuWarnings } from './resolve-nav-menu.js';

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

beforeEach(() => {
    resetNavMenuWarnings();
});

describe('setNavVisibility', () => {
    it('sets a predicate on a nested item by id', () => {
        const result = setNavVisibility(sample(), { items: ['products'] }, () => false);
        expect(items(result, 'catalog')[0].isVisible?.(ctx)).toBe(false);
        expect(items(result, 'catalog')[1].isVisible).toBeUndefined();
    });

    it('sets a predicate on a section without touching its items', () => {
        const result = setNavVisibility(sample(), { sections: ['catalog'] }, () => false);
        expect(section(result, 'catalog').isVisible?.(ctx)).toBe(false);
        expect(items(result, 'catalog').map(item => item.isVisible)).toEqual([undefined, undefined]);
    });

    it('sets a predicate on a bare top-level item', () => {
        const result = setNavVisibility(sample(), { sections: ['insights'] }, () => false);
        expect(bareItem(result, 'insights').isVisible?.(ctx)).toBe(false);
    });

    it('ANDs onto an existing predicate rather than replacing it', () => {
        // Order matters. The FIRST predicate hides; the SECOND would show on its
        // own. Only genuine AND-composition keeps the result false. Under an
        // implementation that replaced isVisible instead of composing, the second
        // call would win and this would be true.
        const once = setNavVisibility(sample(), { items: ['products'] }, () => false);
        const twice = setNavVisibility(once, { items: ['products'] }, () => true);
        expect(items(twice, 'catalog')[0].isVisible?.(ctx)).toBe(false);
    });

    it('does not mutate the input config', () => {
        const input = sample();
        setNavVisibility(input, { items: ['products'] }, () => false);
        expect(items(input, 'catalog')[0].isVisible).toBeUndefined();
    });
});

describe('keepOnlyNavEntries', () => {
    it('hides everything except the named ids', () => {
        const result = keepOnlyNavEntries(sample(), { items: ['pos-home'] });
        expect(bareItem(result, 'insights').isVisible?.(ctx)).toBe(false);
        expect(items(result, 'catalog')[0].isVisible?.(ctx)).toBe(false);
        expect(items(result, 'pos')[0].isVisible).toBeUndefined();
    });

    it('keeps the parent section of a kept item visible', () => {
        const result = keepOnlyNavEntries(sample(), { items: ['pos-home'] });
        expect(section(result, 'pos').isVisible).toBeUndefined();
    });

    it('keeps a named section and all of its items', () => {
        const result = keepOnlyNavEntries(sample(), { sections: ['catalog'] });
        expect(section(result, 'catalog').isVisible).toBeUndefined();
        expect(items(result, 'catalog').map(item => item.isVisible)).toEqual([undefined, undefined]);
    });

    it('hides a section when neither it nor any of its items is named', () => {
        const result = keepOnlyNavEntries(sample(), { items: ['pos-home'] });
        expect(section(result, 'catalog').isVisible?.(ctx)).toBe(false);
    });

    it('does not mutate the input config', () => {
        const input = sample();
        keepOnlyNavEntries(input, { items: ['pos-home'] });
        expect(items(input, 'catalog')[0].isVisible).toBeUndefined();
        expect(bareItem(input, 'insights').isVisible).toBeUndefined();
    });

    it('still hides an entry whose existing predicate throws', () => {
        // resolveNavMenu fails open on a throwing predicate, so ordering is
        // load-bearing: without the short-circuit this entry would come back visible.
        const withThrower = setNavVisibility(sample(), { items: ['products'] }, () => {
            throw new Error('predicate from another plugin is broken');
        });
        const result = keepOnlyNavEntries(withThrower, { items: ['pos-home'] });
        expect(items(result, 'catalog')[0].isVisible?.(ctx)).toBe(false);
    });
});

// The built-in Customers section and Customers item share an id, so the two kinds of
// entry have to be nameable apart from each other.
describe('a section and an item with the same id', () => {
    const shared = (): NavMenuConfig => ({
        sections: [
            {
                id: 'reports',
                title: 'Reports',
                placement: 'top',
                items: [
                    { id: 'reports', title: 'Reports', url: '/reports' },
                    { id: 'exports', title: 'Exports', url: '/exports' },
                ],
            },
        ],
    });

    it('targets only the item when only the item is named', () => {
        const result = setNavVisibility(shared(), { items: ['reports'] }, () => false);
        expect(items(result, 'reports')[0].isVisible?.(ctx)).toBe(false);
        expect(section(result, 'reports').isVisible).toBeUndefined();
    });

    it('targets only the section when only the section is named', () => {
        const result = setNavVisibility(shared(), { sections: ['reports'] }, () => false);
        expect(section(result, 'reports').isVisible?.(ctx)).toBe(false);
        expect(items(result, 'reports')[0].isVisible).toBeUndefined();
    });

    it('keeps only the named item, not every item of the section sharing its id', () => {
        const result = keepOnlyNavEntries(shared(), { items: ['reports'] });
        expect(items(result, 'reports')[1].isVisible?.(ctx)).toBe(false);
    });
});

describe('composition of throwing predicates', () => {
    it('still hides an entry when the newly added predicate throws', () => {
        // The mirror of the keepOnlyNavEntries case above, with the throw on the other
        // side. A throw that escapes the composed predicate makes resolveNavMenu fail
        // open, which would un-hide an entry an earlier plugin had hidden.
        const hidden = setNavVisibility(sample(), { items: ['products'] }, () => false);
        const result = setNavVisibility(hidden, { items: ['products'] }, () => {
            throw new Error('predicate from a later plugin is broken');
        });
        expect(items(result, 'catalog')[0].isVisible?.(ctx)).toBe(false);
    });

    it('warns about the throwing predicate rather than swallowing it silently', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const hidden = setNavVisibility(sample(), { items: ['products'] }, () => true);
        const result = setNavVisibility(hidden, { items: ['products'] }, () => {
            throw new Error('predicate from a later plugin is broken');
        });
        expect(items(result, 'catalog')[0].isVisible?.(ctx)).toBe(true);
        expect(warn).toHaveBeenCalledTimes(1);
        warn.mockRestore();
    });
});

describe('keepOnlyNavEntries with a `when` predicate', () => {
    const isFloorStaff = (c: typeof ctx) => c.hasPermissions(['FloorStaff']);
    const ctxWith = (permissions: string[]) =>
        buildDashboardUserContext({
            administrator: undefined,
            channels: undefined,
            activeChannel: undefined,
            customFields: undefined,
            hasPermissions: required => required.some(p => permissions.includes(p)),
        });

    it('applies the whitelist only to administrators the predicate matches', () => {
        const result = keepOnlyNavEntries(sample(), { items: ['pos-home'] }, isFloorStaff);

        expect(section(result, 'catalog').isVisible?.(ctxWith(['FloorStaff']))).toBe(false);
        expect(section(result, 'catalog').isVisible?.(ctxWith([]))).toBe(true);
    });

    it('leaves the named entries alone for both', () => {
        const result = keepOnlyNavEntries(sample(), { items: ['pos-home'] }, isFloorStaff);

        expect(items(result, 'pos')[0].isVisible).toBeUndefined();
        expect(section(result, 'pos').isVisible).toBeUndefined();
    });
});

// An id that matches nothing has no effect at all, and with keepOnlyNavEntries a single
// typo hides the entire menu. Neither is discoverable without a warning.
describe('unmatched ids', () => {
    it('warns when setNavVisibility is given an id that matches nothing', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        setNavVisibility(sample(), { items: ['products', 'produtcs'] }, () => false);

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('"produtcs"'));
        warn.mockRestore();
    });

    it('warns when keepOnlyNavEntries is given an id that matches nothing', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        keepOnlyNavEntries(sample(), { items: ['pos-hom'] });

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('"pos-hom"'));
        warn.mockRestore();
    });

    it('warns when a section id is passed as an item id', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        setNavVisibility(sample(), { items: ['catalog'] }, () => false);

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('"catalog"'));
        warn.mockRestore();
    });

    it('stays quiet when every id matches', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        keepOnlyNavEntries(
            setNavVisibility(sample(), { sections: ['insights'] }, () => true),
            { sections: ['catalog'], items: ['pos-home'] },
        );

        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });
});
