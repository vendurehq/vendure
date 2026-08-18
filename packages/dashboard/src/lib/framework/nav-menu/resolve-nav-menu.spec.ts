import { describe, expect, it } from 'vitest';

import { buildDashboardUserContext } from '../user-context/dashboard-user-context.js';

import { NavMenuConfig } from './nav-menu-extensions.js';
import { resolveNavMenu } from './resolve-nav-menu.js';

const ctxWith = (permissions: string[] = []) =>
    buildDashboardUserContext({
        administrator: undefined,
        channels: undefined,
        activeChannel: undefined,
        customFields: undefined,
        hasPermissions: required => required.some(p => permissions.includes(p)),
    });

const config = (sections: NavMenuConfig['sections']): NavMenuConfig => ({ sections });

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
});
