import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setNavMenuConfig } from '../../framework/nav-menu/nav-menu-extensions.js';
import { GeneratedBreadcrumbs } from './generated-breadcrumbs.js';

const routerState = vi.hoisted(() => ({
    pathname: '/',
    matches: [] as Array<{ pathname: string; loaderData?: { breadcrumb?: unknown } }>,
}));

vi.mock('@tanstack/react-router', () => ({
    useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
        select({ matches: routerState.matches, location: { pathname: routerState.pathname } }),
    Link: ({ to, children }: { to: string; children?: React.ReactNode }) => <a href={to}>{children}</a>,
}));

vi.mock('@lingui/react', () => ({
    useLingui: () => ({ i18n: { t: (value: string) => value, messages: {} } }),
}));

function render(pathname: string, breadcrumb: unknown): string {
    routerState.pathname = pathname;
    routerState.matches = [{ pathname, loaderData: { breadcrumb } }];
    return renderToStaticMarkup(<GeneratedBreadcrumbs />);
}

function crumbTexts(markup: string): string[] {
    return Array.from(markup.matchAll(/<(?:a href|span data-slot="breadcrumb-page")[^>]*>([^<]+)<\/(?:a|span)>/g)).map(m => m[1]);
}

describe('GeneratedBreadcrumbs', () => {
    beforeEach(() => {
        setNavMenuConfig({
            sections: [
                {
                    id: 'catalog',
                    title: 'Catalog',
                    placement: 'top',
                    items: [{ id: 'products', title: 'Products', url: '/products' }],
                },
                {
                    id: 'customers',
                    title: 'Customers',
                    placement: 'top',
                    items: [
                        { id: 'customers', title: 'Customers', url: '/customers' },
                        { id: 'customer-groups', title: 'Customer Groups', url: '/customer-groups' },
                    ],
                },
            ],
        });
    });

    it('renders the last crumb as the current page and the others as links', () => {
        const markup = render('/products/1', [{ path: '/products', label: 'Products' }, 'Laptop']);

        expect(crumbTexts(markup)).toEqual(['Catalog', 'Products', 'Laptop']);
        expect(markup).toContain('href="/products">Catalog</a>');
        expect(markup).toContain('href="/products">Products</a>');
        expect(markup).toMatch(/<span[^>]*aria-current="page"[^>]*>Laptop<\/span>/);
        expect(markup.match(/aria-current="page"/g)).toHaveLength(1);
    });

    // OSS-1237 — the customer detail page showed "Customers / Customers"
    it('drops a section crumb named like its item when the page has a crumb for that path', () => {
        const markup = render('/customers/1', [{ path: '/customers', label: <>Customers</> }, 'Jane Doe']);

        expect(crumbTexts(markup)).toEqual(['Customers', 'Jane Doe']);
    });

    it('keeps the section crumb on a sibling page of that section', () => {
        const markup = render('/customer-groups/1', [
            { path: '/customer-groups', label: 'Customer Groups' },
            'VIP',
        ]);

        expect(crumbTexts(markup)).toEqual(['Customers', 'Customer Groups', 'VIP']);
    });

    it('collapses the crumbs before the parent into an ellipsis below md', () => {
        const markup = render('/products/1/variants/2', [
            { path: '/products', label: 'Products' },
            { path: '/products/1', label: 'Laptop' },
            'Laptop 13 inch',
        ]);

        expect(markup).toMatch(/<li[^>]*class="[^"]*md:hidden[^"]*"[^>]*><span data-slot="breadcrumb-ellipsis"/);
        expect(markup).toMatch(/<li[^>]*class="[^"]*max-md:hidden[^"]*"[^>]*><a href="\/products">Catalog<\/a>/);
        expect(markup).toMatch(/<li[^>]*class="[^"]*max-md:hidden[^"]*"[^>]*><a href="\/products">Products<\/a>/);
        expect(markup).not.toMatch(/<li[^>]*class="[^"]*max-md:hidden[^"]*"[^>]*><a href="\/products\/1">Laptop/);
    });

    it('shows no ellipsis when the trail has only a parent and the current page', () => {
        const markup = render('/customers/1', [{ path: '/customers', label: 'Customers' }, 'Jane Doe']);

        expect(markup).not.toContain('breadcrumb-ellipsis');
        expect(markup).not.toContain('max-md:hidden');
    });
});
