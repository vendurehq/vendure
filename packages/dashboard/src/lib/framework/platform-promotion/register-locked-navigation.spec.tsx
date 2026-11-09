import { beforeEach, describe, expect, it } from 'vitest';

import {
    addNavMenuItem,
    getNavMenuConfig,
    NavMenuItem,
    NavMenuSection,
    setNavMenuConfig,
} from '../nav-menu/nav-menu-extensions.js';
import { extensionRoutes } from '../page/page-api.js';

import { platformPromotionFixture as promotion } from './platform-promotion.fixture.js';
import { getLockedNavItemCapability, registerLockedNavigation } from './register-locked-navigation.js';

function section(id: string): NavMenuSection | undefined {
    return getNavMenuConfig().sections.find(s => s.id === id) as NavMenuSection | undefined;
}

function item(sectionId: string, id: string): NavMenuItem | undefined {
    return section(sectionId)?.items?.find(i => i.id === id);
}

function allItems(): NavMenuItem[] {
    return getNavMenuConfig().sections.flatMap(s => ('items' in s ? (s.items ?? []) : []));
}

describe('registerLockedNavigation', () => {
    beforeEach(() => {
        extensionRoutes.clear();
        setNavMenuConfig({
            sections: [
                {
                    id: 'customers',
                    title: 'Customers',
                    placement: 'top',
                    order: 400,
                    items: [{ id: 'customers', title: 'Customers', url: '/customers', order: 100 }],
                },
            ],
        });
    });

    it('adds the items to built-in sections at the Platform order', () => {
        registerLockedNavigation(promotion);
        expect(section('customers')?.items?.map(i => [i.id, i.order])).toEqual([
            ['customers', 100],
            ['companies', 400],
            ['shoppingLists', undefined],
        ]);
        expect(getLockedNavItemCapability(item('customers', 'companies')!)).toBe('org.accounts');
    });

    it('creates the Platform sections with their placement, order and icon', () => {
        registerLockedNavigation(promotion);
        expect(section('quotes')).toMatchObject({ title: 'Quotes', placement: 'top', order: 270 });
        expect(section('access-and-identity')).toMatchObject({ placement: 'bottom', order: 150 });
        expect(section('quotes')?.icon?.displayName).toBe('FileText');
        expect(section('quotes')?.items?.map(i => i.id)).toEqual(['quote-list']);
    });

    it('registers a locked route at the Platform route of each item', () => {
        registerLockedNavigation(promotion);
        expect([...extensionRoutes.keys()]).toEqual(
            expect.arrayContaining(['/companies', '/quotes', '/configurator/systems', '/access-policies']),
        );
        expect(extensionRoutes.size).toBe(8);
    });

    it('does not replace the item or route of an installed Platform plugin', () => {
        const realRoute = { path: '/quotes', component: () => null };
        extensionRoutes.set('/quotes', realRoute);
        setNavMenuConfig({
            sections: [
                ...getNavMenuConfig().sections,
                {
                    id: 'quotes',
                    title: 'Quotes',
                    placement: 'top',
                    order: 270,
                    items: [{ id: 'quote-list', title: 'All Quotes', url: '/quotes', order: 100 }],
                },
            ],
        });
        registerLockedNavigation(promotion);
        expect(getNavMenuConfig().sections.filter(s => s.id === 'quotes')).toHaveLength(1);
        expect(extensionRoutes.get('/quotes')).toBe(realRoute);
    });

    it('does not take a plugin item with the id of a locked item as locked', () => {
        registerLockedNavigation(promotion);
        const pluginItem = { id: 'companies', title: 'Companies', url: '/companies', order: 400 };
        addNavMenuItem(pluginItem, 'customers');
        expect(item('customers', 'companies')).toBe(pluginItem);
        expect(getLockedNavItemCapability(pluginItem)).toBeUndefined();
    });

    it('is idempotent', () => {
        registerLockedNavigation(promotion);
        registerLockedNavigation(promotion);
        expect(getNavMenuConfig().sections.filter(s => s.id === 'quotes')).toHaveLength(1);
        expect(section('customers')?.items).toHaveLength(3);
    });

    it('adds only the promoted items, one per capability', () => {
        registerLockedNavigation(promotion);
        const ids = allItems().map(i => i.id);
        expect(ids).not.toContain('company-roles');
        expect(ids).not.toContain('approval-policies');
        expect(allItems().filter(i => getLockedNavItemCapability(i))).toHaveLength(8);
    });
});
