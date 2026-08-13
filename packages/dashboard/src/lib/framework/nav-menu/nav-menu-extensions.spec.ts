import { describe, expect, it } from 'vitest';

import { NavMenuConfig, NavMenuItem, validateNavigationShortcuts } from './nav-menu-extensions.js';

function configWithItems(items: Array<{ id: string; shortcut?: string }>): NavMenuConfig {
    return {
        sections: [
            {
                id: 'extensions',
                title: 'Extensions',
                items: items.map(item => ({
                    ...item,
                    title: item.id,
                    url: `/${item.id}`,
                })) as NavMenuItem[],
            },
        ],
    };
}

describe('validateNavigationShortcuts', () => {
    it('preserves unique extension shortcuts', () => {
        const config = configWithItems([{ id: 'reviews', shortcut: 'r' }]);

        const result = validateNavigationShortcuts(config);

        expect(result.errors).toEqual([]);
        expect(result.config).toBe(config);
    });

    it('disables extension shortcuts which collide with built-in shortcuts', () => {
        const result = validateNavigationShortcuts(
            configWithItems([
                { id: 'products', shortcut: 'p' },
                { id: 'plugin-products', shortcut: 'p' },
            ]),
        );

        const section = result.config.sections[0];
        expect(section && 'items' in section ? section.items : []).toEqual([
            expect.objectContaining({ id: 'products', shortcut: 'p' }),
            expect.objectContaining({ id: 'plugin-products', shortcut: undefined }),
        ]);
        expect(result.errors[0]).toContain('is reserved by the built-in navigation item "products"');
    });

    it('disables every extension shortcut involved in a collision', () => {
        const result = validateNavigationShortcuts(
            configWithItems([
                { id: 'reviews', shortcut: 'r' },
                { id: 'returns', shortcut: 'r' },
            ]),
        );

        const section = result.config.sections[0];
        expect(section && 'items' in section ? section.items : []).toEqual([
            expect.objectContaining({ id: 'reviews', shortcut: undefined }),
            expect.objectContaining({ id: 'returns', shortcut: undefined }),
        ]);
        expect(result.errors).toEqual([
            'Navigation shortcut collision: G → R is declared by "reviews" and "returns". ' +
                'Choose a different shortcut for one of these navigation items.',
        ]);
    });

    it('disables invalid dynamically-provided shortcuts', () => {
        const result = validateNavigationShortcuts(configWithItems([{ id: 'reviews', shortcut: 'g' }]));

        const section = result.config.sections[0];
        expect(section && 'items' in section ? section.items?.[0].shortcut : undefined).toBeUndefined();
        expect(result.errors[0]).toContain('Invalid navigation shortcut "g"');
    });
});
