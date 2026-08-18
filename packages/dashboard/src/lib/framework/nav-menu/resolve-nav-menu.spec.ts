import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildDashboardUserContext } from '../user-context/dashboard-user-context.js';

import { NavMenuConfig } from './nav-menu-extensions.js';
import { resetNavMenuWarnings, resolveNavMenu } from './resolve-nav-menu.js';

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

describe('resolveNavMenu — existing behaviour', () => {
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
            [],
        );
        expect(result.map(s => s.id)).toEqual(['first', 'second']);
        expect((result[0] as any).items.map((i: any) => i.id)).toEqual(['zebra', 'aardvark', 'apple']);
    });

    it('orders bare items by order then title', () => {
        const result = resolveNavMenu(
            config([
                { id: 'b', title: 'Beta', url: '/b', placement: 'top', order: 200 },
                { id: 'a', title: 'Alpha', url: '/a', placement: 'top', order: 100 },
                { id: 'c', title: 'Aardvark', url: '/c', placement: 'top', order: 100 },
            ]),
            ctxWith(),
            [],
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
            [],
        );
        const catalog = result[0] as any;
        expect(catalog.items.map((i: any) => i.id)).toEqual(['products']);
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
            [],
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
            [],
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
            [],
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
            [],
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
            [],
        );
        expect(result.map(s => s.id)).toEqual(['explicit', 'noOrder']);
    });
});

describe('resolveNavMenu — transforms and isVisible', () => {
    it('hides an item whose isVisible returns false', () => {
        const result = resolveNavMenu(
            config([
                { id: 'a', title: 'A', url: '/a', placement: 'top' },
                { id: 'b', title: 'B', url: '/b', placement: 'top', isVisible: () => false },
            ]),
            ctxWith(),
            [],
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
            [],
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
            [],
        );
        expect(result).toEqual([]);
    });

    it('applies transforms in order, each seeing the previous output', () => {
        const seen: string[] = [];
        const result = resolveNavMenu(
            config([{ id: 'a', title: 'A', url: '/a', placement: 'top' }]),
            ctxWith(),
            [
                cfg => {
                    seen.push('first');
                    return {
                        sections: [...cfg.sections, { id: 'b', title: 'B', url: '/b', placement: 'top' }],
                    };
                },
                cfg => {
                    seen.push(`second saw ${cfg.sections.length}`);
                    return cfg;
                },
            ],
        );
        expect(seen).toEqual(['first', 'second saw 2']);
        expect(result.map(s => s.id)).toEqual(['a', 'b']);
    });

    it('sorts sections added by a transform along with the rest', () => {
        const result = resolveNavMenu(
            config([{ id: 'existing', title: 'Existing', url: '/e', placement: 'top', order: 200 }]),
            ctxWith(),
            [
                cfg => ({
                    sections: [
                        ...cfg.sections,
                        { id: 'added', title: 'Added', url: '/a', placement: 'top', order: 100 },
                    ],
                }),
            ],
        );
        // 'added' is appended last but has the lower order, so it must sort first.
        // Sorting before applying transforms would yield ['existing', 'added'].
        expect(result.map(s => s.id)).toEqual(['added', 'existing']);
    });

    it('lets two transforms both condition the same item without clobbering', () => {
        const and =
            (id: string, pred: () => boolean) =>
            (cfg: NavMenuConfig): NavMenuConfig => ({
                sections: cfg.sections.map(s => {
                    if (s.id !== id) return s;
                    const prev = s.isVisible;
                    return { ...s, isVisible: (c: any) => (prev?.(c) ?? true) && pred() };
                }),
            });
        // Order matters: the FIRST transform hides, the SECOND would show on its own.
        // Correct composition keeps it hidden. An implementation that overwrote
        // isVisible instead of ANDing would let the second transform win and the
        // entry would appear — so this ordering is what makes the test meaningful.
        const result = resolveNavMenu(
            config([{ id: 'a', title: 'A', url: '/a', placement: 'top' }]),
            ctxWith(),
            [and('a', () => false), and('a', () => true)],
        );
        expect(result).toEqual([]);
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
            [],
        );
        expect(result.map(s => s.id)).toEqual(['a']);
        expect(warn).toHaveBeenCalledTimes(1);
        warn.mockRestore();
    });

    it('falls back to the untransformed config when a transform throws', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const result = resolveNavMenu(
            config([{ id: 'a', title: 'A', url: '/a', placement: 'top' }]),
            ctxWith(),
            [
                () => {
                    throw new Error('boom');
                },
            ],
        );
        expect(result.map(s => s.id)).toEqual(['a']);
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it("keeps an earlier transform's output when a later transform throws", () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const result = resolveNavMenu(
            config([{ id: 'a', title: 'A', url: '/a', placement: 'top' }]),
            ctxWith(),
            [
                cfg => ({
                    sections: [...cfg.sections, { id: 'b', title: 'B', url: '/b', placement: 'top' }],
                }),
                () => {
                    throw new Error('boom');
                },
            ],
        );
        expect(result.map(s => s.id)).toEqual(['a', 'b']);
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it('skips a transform that returns an invalid shape', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const result = resolveNavMenu(
            config([{ id: 'a', title: 'A', url: '/a', placement: 'top' }]),
            ctxWith(),
            [(() => ({})) as any],
        );
        expect(result.map(s => s.id)).toEqual(['a']);
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});
