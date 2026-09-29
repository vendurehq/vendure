import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    buildDashboardUserContext,
    type DashboardUserContext,
} from '../user-context/dashboard-user-context.js';

import { NavMenuConfig, NavMenuItem, NavMenuSection } from './nav-menu-extensions.js';
import { setNavVisibility } from './nav-menu-helpers.js';
import { resetNavMenuWarnings, resolveNavMenu } from './resolve-nav-menu.js';

/** Reads item ids from a resolved entry, failing the test rather than casting. */
function itemIds(entry: NavMenuSection | NavMenuItem | undefined): string[] {
    if (!entry || !('items' in entry)) {
        throw new Error(`Expected a section, got ${entry ? entry.id : 'nothing'}`);
    }
    return (entry.items ?? []).map(item => item.id);
}

const ctxWith = (permissions: string[] = []) =>
    buildDashboardUserContext({
        administrator: undefined,
        channels: undefined,
        activeChannel: undefined,
        customFields: undefined,
        hasPermissions: required => required.some(p => permissions.includes(p)),
    });

const config = (sections: NavMenuConfig['sections']): NavMenuConfig => ({ sections });

beforeEach(() => {
    resetNavMenuWarnings();
});

describe('resolveNavMenu - existing behaviour', () => {
    it('sorts sections by order, then their items by order then title', () => {
        const result = resolveNavMenu(
            config([
                {
                    id: 'second',
                    title: 'Second',
                    placement: 'top',
                    order: 200,
                    items: [{ id: 's1', title: 'S1', url: '/s1' }],
                },
                {
                    id: 'first',
                    title: 'First',
                    placement: 'top',
                    order: 100,
                    items: [
                        { id: 'zebra', title: 'Zebra', url: '/z', order: 10 },
                        { id: 'apple', title: 'Apple', url: '/a', order: 20 },
                        { id: 'aardvark', title: 'Aardvark', url: '/aa', order: 20 },
                    ],
                },
            ]),
            ctxWith(),
        );
        expect(result.map(s => s.id)).toEqual(['first', 'second']);
        expect(itemIds(result[0])).toEqual(['zebra', 'aardvark', 'apple']);
    });

    it('orders bare items by order then title', () => {
        const result = resolveNavMenu(
            config([
                { id: 'b', title: 'Beta', url: '/b', placement: 'top', order: 200 },
                { id: 'a', title: 'Alpha', url: '/a', placement: 'top', order: 100 },
                { id: 'c', title: 'Aardvark', url: '/c', placement: 'top', order: 100 },
            ]),
            ctxWith(),
        );
        expect(result.map(s => s.id)).toEqual(['c', 'a', 'b']);
    });

    it('filters items by requiresPermission', () => {
        const result = resolveNavMenu(
            config([
                {
                    id: 'catalog',
                    title: 'Catalog',
                    placement: 'top',
                    items: [
                        { id: 'products', title: 'Products', url: '/products' },
                        {
                            id: 'secret',
                            title: 'Secret',
                            url: '/secret',
                            requiresPermission: 'SuperSecret',
                        },
                    ],
                },
            ]),
            ctxWith([]),
        );
        expect(itemIds(result[0])).toEqual(['products']);
    });

    it('filters a section by its own requiresPermission', () => {
        const result = resolveNavMenu(
            config([
                {
                    id: 'restricted',
                    title: 'Restricted',
                    placement: 'top',
                    requiresPermission: 'Nope',
                    items: [{ id: 'child', title: 'Child', url: '/c' }],
                },
            ]),
            ctxWith([]),
        );
        expect(result).toEqual([]);
    });

    it('drops a section whose items are all filtered out', () => {
        const result = resolveNavMenu(
            config([
                {
                    id: 'catalog',
                    title: 'Catalog',
                    placement: 'top',
                    items: [{ id: 'secret', title: 'Secret', url: '/s', requiresPermission: 'Nope' }],
                },
            ]),
            ctxWith([]),
        );
        expect(result).toEqual([]);
    });

    it('keeps a bare item the user has permission for and drops one they do not', () => {
        const result = resolveNavMenu(
            config([
                { id: 'ok', title: 'Ok', url: '/ok', placement: 'top', requiresPermission: 'Read' },
                { id: 'no', title: 'No', url: '/no', placement: 'top', requiresPermission: 'Deny' },
            ]),
            ctxWith(['Read']),
        );
        expect(result.map(s => s.id)).toEqual(['ok']);
    });

    it('preserves placement on the returned entries', () => {
        const result = resolveNavMenu(
            config([
                { id: 'top', title: 'Top', url: '/t', placement: 'top' },
                { id: 'bottom', title: 'Bottom', url: '/b', placement: 'bottom' },
            ]),
            ctxWith(),
        );
        expect(result.map(s => s.placement)).toEqual(['bottom', 'top']);
    });

    it('accepts the array form of requiresPermission with OR semantics', () => {
        const result = resolveNavMenu(
            config([
                {
                    id: 'anyOf',
                    title: 'AnyOf',
                    url: '/a',
                    placement: 'top',
                    requiresPermission: ['Nope', 'Read'],
                },
                {
                    id: 'noneOf',
                    title: 'NoneOf',
                    url: '/n',
                    placement: 'top',
                    requiresPermission: ['Nope', 'AlsoNope'],
                },
            ]),
            ctxWith(['Read']),
        );
        expect(result.map(s => s.id)).toEqual(['anyOf']);
    });

    it('sorts entries without an order after entries with one', () => {
        const result = resolveNavMenu(
            config([
                // 'AAA' sorts before 'ZZZ' alphabetically, so if the
                // Number.MAX_SAFE_INTEGER fallback were dropped or changed to 0,
                // this expectation would flip.
                { id: 'noOrder', title: 'AAA', url: '/n', placement: 'top' },
                { id: 'explicit', title: 'ZZZ', url: '/e', placement: 'top', order: 100 },
            ]),
            ctxWith(),
        );
        expect(result.map(s => s.id)).toEqual(['explicit', 'noOrder']);
    });
});

describe('resolveNavMenu - isVisible', () => {
    it('hides an item whose isVisible returns false', () => {
        const result = resolveNavMenu(
            config([
                { id: 'a', title: 'A', url: '/a', placement: 'top' },
                { id: 'b', title: 'B', url: '/b', placement: 'top', isVisible: () => false },
            ]),
            ctxWith(),
        );
        expect(result.map(s => s.id)).toEqual(['a']);
    });

    it('ANDs isVisible with requiresPermission', () => {
        const entries = [
            { perm: 'Read', visible: true, id: 'both' },
            { perm: 'Read', visible: false, id: 'permOnly' },
            { perm: 'Deny', visible: true, id: 'visibleOnly' },
            { perm: 'Deny', visible: false, id: 'neither' },
        ];
        const result = resolveNavMenu(
            config(
                entries.map(e => ({
                    id: e.id,
                    title: e.id,
                    url: `/${e.id}`,
                    placement: 'top' as const,
                    requiresPermission: e.perm,
                    isVisible: () => e.visible,
                })),
            ),
            ctxWith(['Read']),
        );
        expect(result.map(s => s.id)).toEqual(['both']);
    });

    it('hides a section and its items when the section isVisible is false', () => {
        const result = resolveNavMenu(
            config([
                {
                    id: 'catalog',
                    title: 'Catalog',
                    placement: 'top',
                    isVisible: () => false,
                    items: [{ id: 'products', title: 'Products', url: '/p' }],
                },
            ]),
            ctxWith(),
        );
        expect(result).toEqual([]);
    });

    // A `navSections` function runs once, at registration. What it attaches is still
    // decided per user on every render, which is what makes it the route for
    // conditioning an entry your own plugin did not declare.
    it('applies a predicate attached at registration time to each user separately', () => {
        const isFloorStaff = (c: DashboardUserContext) => c.hasPermissions(['FloorStaff']);
        const atLoad = setNavVisibility(
            config([
                { id: 'catalog', title: 'Catalog', url: '/c', placement: 'top' },
                { id: 'pos', title: 'POS', url: '/pos', placement: 'top' },
            ]),
            { sections: ['catalog'] },
            c => !isFloorStaff(c),
        );

        expect(resolveNavMenu(atLoad, ctxWith(['FloorStaff'])).map(s => s.id)).toEqual(['pos']);
        expect(resolveNavMenu(atLoad, ctxWith()).map(s => s.id)).toEqual(['catalog', 'pos']);
    });

    it('lets two plugins condition the same entry without clobbering', () => {
        // Order matters: the FIRST call hides, the SECOND would show on its own.
        // Correct composition keeps it hidden. An implementation that overwrote
        // isVisible instead of ANDing would let the second call win and the entry
        // would appear - so this ordering is what makes the test meaningful.
        const first = setNavVisibility(
            config([{ id: 'a', title: 'A', url: '/a', placement: 'top' }]),
            { sections: ['a'] },
            () => false,
        );
        const second = setNavVisibility(first, { sections: ['a'] }, () => true);

        expect(resolveNavMenu(second, ctxWith())).toEqual([]);
    });

    it('keeps an item visible and logs once when its predicate throws', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const result = resolveNavMenu(
            config([
                {
                    id: 'a',
                    title: 'A',
                    url: '/a',
                    placement: 'top',
                    isVisible: () => {
                        throw new Error('boom');
                    },
                },
            ]),
            ctxWith(),
        );
        expect(result.map(s => s.id)).toEqual(['a']);
        expect(warn).toHaveBeenCalledTimes(1);
        warn.mockRestore();
    });

    it('keeps an entry hidden when a later plugin adds a predicate that throws', () => {
        // End to end version of the nav-menu-helpers case: the entry must be absent
        // from the resolved menu, not merely evaluate to false in isolation.
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const hidden = setNavVisibility(
            config([{ id: 'a', title: 'A', url: '/a', placement: 'top' }]),
            { sections: ['a'] },
            () => false,
        );
        const withBrokenPredicate = setNavVisibility(hidden, { sections: ['a'] }, () => {
            throw new Error('boom');
        });

        expect(resolveNavMenu(withBrokenPredicate, ctxWith())).toEqual([]);
        warn.mockRestore();
    });
});

// The administrator custom fields arrive on a second request. Until they do, an entry
// with a predicate cannot be resolved, but every other entry can and should paint.
describe('resolveNavMenu - userContextPending', () => {
    const pendingConfig = () =>
        config([
            { id: 'plain', title: 'Plain', url: '/p', placement: 'top' },
            { id: 'conditional', title: 'Conditional', url: '/c', placement: 'top', isVisible: () => true },
            {
                id: 'section',
                title: 'Section',
                placement: 'top',
                items: [
                    { id: 'plain-item', title: 'Plain item', url: '/pi' },
                    { id: 'conditional-item', title: 'Conditional item', url: '/ci', isVisible: () => true },
                ],
            },
        ]);

    it('withholds only the entries carrying a predicate', () => {
        const result = resolveNavMenu(pendingConfig(), ctxWith(), { userContextPending: true });

        expect(result.map(s => s.id)).toEqual(['plain', 'section']);
        expect(itemIds(result[1])).toEqual(['plain-item']);
    });

    it('shows them once the context has loaded', () => {
        const result = resolveNavMenu(pendingConfig(), ctxWith(), { userContextPending: false });

        expect(result.map(s => s.id)).toEqual(['conditional', 'plain', 'section']);
        expect(itemIds(result[2])).toEqual(['conditional-item', 'plain-item']);
    });
});
