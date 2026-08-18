import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    addNavMenuTransform,
    getNavMenuTransforms,
    type NavMenuItem,
    type NavMenuSection,
} from '../../framework/nav-menu/nav-menu-extensions.js';
import { resetNavMenuWarnings } from '../../framework/nav-menu/resolve-nav-menu.js';
import {
    buildDashboardUserContext,
    type DashboardUserContext,
} from '../../framework/user-context/dashboard-user-context.js';
import { NavMain } from './nav-main.js';

const useDashboardUserContextMock = vi.hoisted(() => vi.fn());
const hasPermissionsMock = vi.hoisted(() => vi.fn((_permissions: string[]) => true));

// NavItemWrapper is a dev-mode-only decorator which returns its children unchanged in
// production. Stubbing it as a marker element is what makes the resolved entry ids
// observable in the static markup, so the assertions below can pin ids and order
// rather than markup details.
vi.mock('./nav-item-wrapper.js', () => ({
    NavItemWrapper: ({ children, locationId }: { children: React.ReactNode; locationId: string }) => (
        <div data-nav-id={locationId}>{children}</div>
    ),
}));

vi.mock('@/vdb/components/ui/sidebar.js', () => {
    const passThrough =
        (tag: string) =>
        ({ children }: { children?: React.ReactNode }) =>
            React.createElement(tag, null, children);
    return {
        useSidebar: () => ({ state: 'expanded', isMobile: false, setOpenMobile: () => undefined }),
        SidebarGroup: passThrough('div'),
        SidebarGroupLabel: passThrough('div'),
        SidebarMenu: passThrough('div'),
        SidebarMenuButton: passThrough('div'),
        SidebarMenuItem: passThrough('div'),
        SidebarMenuSub: passThrough('div'),
        SidebarMenuSubButton: passThrough('div'),
        SidebarMenuSubItem: passThrough('div'),
    };
});

// A closed Collapsible must still render its children here, otherwise item ids would be
// absent for reasons unrelated to the resolution logic under test.
vi.mock('@/vdb/components/ui/collapsible.js', () => {
    const passThrough = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
    return {
        Collapsible: passThrough,
        CollapsibleContent: passThrough,
        CollapsibleTrigger: passThrough,
    };
});

vi.mock('@/vdb/components/ui/hover-card.js', () => {
    const passThrough = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
    return {
        HoverCard: passThrough,
        HoverCardContent: passThrough,
        HoverCardTrigger: passThrough,
    };
});

vi.mock('@/vdb/hooks/use-dashboard-user-context.js', () => ({
    useDashboardUserContext: useDashboardUserContextMock,
}));

vi.mock('@tanstack/react-router', () => ({
    useRouter: () => ({ basepath: '' }),
    useRouterState: () => ({ location: { pathname: '/' } }),
    Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
}));

vi.mock('@lingui/react', () => ({
    useLingui: () => ({ i18n: { t: (value: string) => value } }),
}));

function makeCtx(): DashboardUserContext {
    const channel = { id: '1', token: 'default', code: '__default_channel__', permissions: [] };
    return buildDashboardUserContext({
        administrator: {
            id: '1',
            firstName: 'Test',
            lastName: 'Admin',
            emailAddress: 'test@example.com',
            user: { id: '1', identifier: 'test', roles: [] },
        },
        channels: [channel],
        activeChannel: channel,
        customFields: undefined,
        hasPermissions: (permissions: string[]) => hasPermissionsMock(permissions),
    });
}

function render(items: Array<NavMenuSection | NavMenuItem>, { ready = true } = {}): string {
    useDashboardUserContextMock.mockReturnValue({ ctx: makeCtx(), ready });
    return renderToStaticMarkup(<NavMain items={items} />);
}

/**
 * The ids of every rendered nav entry, in document order. Top-placement entries are
 * emitted before bottom-placement ones, and each section is immediately followed by
 * its own items.
 */
function getRenderedNavIds(markup: string): string[] {
    return Array.from(markup.matchAll(/data-nav-id="([^"]+)"/g)).map(match => match[1]);
}

/**
 * A config in the shape of the built-in Vendure nav: one top-level link, two top
 * sections and one bottom section, with `order` values that are deliberately not in
 * declaration order so that sorting is exercised.
 */
function vanillaConfig(): Array<NavMenuSection | NavMenuItem> {
    return [
        {
            id: 'catalog',
            title: 'Catalog',
            placement: 'top',
            order: 200,
            items: [
                { id: 'facets', title: 'Facets', url: '/facets', order: 300 },
                { id: 'products', title: 'Products', url: '/products', order: 100 },
            ],
        },
        { id: 'insights', title: 'Insights', url: '/', placement: 'top', order: 100 },
        {
            id: 'settings',
            title: 'Settings',
            placement: 'bottom',
            order: 400,
            items: [{ id: 'channels', title: 'Channels', url: '/channels', order: 100 }],
        },
        {
            id: 'sales',
            title: 'Sales',
            placement: 'top',
            order: 300,
            items: [{ id: 'orders', title: 'Orders', url: '/orders', order: 100 }],
        },
    ];
}

const VANILLA_IDS = ['insights', 'catalog', 'products', 'facets', 'sales', 'orders', 'settings', 'channels'];

describe('NavMain', () => {
    beforeEach(() => {
        useDashboardUserContextMock.mockReset();
        hasPermissionsMock.mockReset();
        hasPermissionsMock.mockReturnValue(true);
        // The transform registry is global; leaking one transform into a later test
        // would silently flip `hasUserDependentRules` and change what is rendered.
        getNavMenuTransforms().length = 0;
        resetNavMenuWarnings();
    });

    // Master-equivalence: with no isVisible predicates and no transforms, NavMain must
    // render exactly the entries a vanilla install has always shown, sorted by `order`.
    it('renders a vanilla config in order, top placement before bottom', () => {
        expect(getRenderedNavIds(render(vanillaConfig()))).toEqual(VANILLA_IDS);
    });

    it('omits an item whose requiresPermission is not held', () => {
        hasPermissionsMock.mockImplementation((permissions: string[]) => !permissions.includes('ReadOrder'));

        const items = vanillaConfig();
        const sales = items.find(entry => entry.id === 'sales') as NavMenuSection;
        sales.items = [
            { id: 'orders', title: 'Orders', url: '/orders', order: 100, requiresPermission: 'ReadOrder' },
            { id: 'drafts', title: 'Draft Orders', url: '/draft-orders', order: 200 },
        ];

        const renderedIds = getRenderedNavIds(render(items));

        expect(renderedIds).not.toContain('orders');
        expect(renderedIds).toEqual([
            'insights',
            'catalog',
            'products',
            'facets',
            'sales',
            'drafts',
            'settings',
            'channels',
        ]);
    });

    it('omits an entry whose isVisible predicate returns false', () => {
        const items = vanillaConfig();
        const catalog = items.find(entry => entry.id === 'catalog') as NavMenuSection;
        catalog.isVisible = () => false;
        const sales = items.find(entry => entry.id === 'sales') as NavMenuSection;
        (sales.items ?? [])[0].isVisible = () => false;

        const renderedIds = getRenderedNavIds(render(items));

        expect(renderedIds).not.toContain('catalog');
        expect(renderedIds).not.toContain('products');
        expect(renderedIds).not.toContain('orders');
        // `sales` has no items left after filtering, so it drops out too.
        expect(renderedIds).toEqual(['insights', 'settings', 'channels']);
    });

    // The readiness gate: rules that read administrator custom fields must not be
    // evaluated before those custom fields have loaded, so nothing is rendered at all.
    it('renders nothing while the user context is not ready and a predicate is present', () => {
        const items = vanillaConfig();
        const catalog = items.find(entry => entry.id === 'catalog') as NavMenuSection;
        catalog.isVisible = () => true;

        expect(getRenderedNavIds(render(items, { ready: false }))).toEqual([]);
    });

    it('renders nothing while the user context is not ready and a transform is registered', () => {
        addNavMenuTransform(config => config);

        expect(getRenderedNavIds(render(vanillaConfig(), { ready: false }))).toEqual([]);
    });

    // The gate is scoped: a vanilla install has no user-dependent rules, so its output
    // cannot depend on the user context and must never be withheld. Without this,
    // every page load would start with a blank sidebar.
    it('renders a vanilla config even while the user context is not ready', () => {
        expect(getRenderedNavIds(render(vanillaConfig(), { ready: false }))).toEqual(VANILLA_IDS);
    });
});
