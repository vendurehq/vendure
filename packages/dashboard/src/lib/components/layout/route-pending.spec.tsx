import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { RoutePending } from './route-pending.js';

const pendingMatch = vi.hoisted(() => ({
    routeId: '',
    staticData: {} as { pendingSkeleton?: 'list' | 'detail' },
}));

vi.mock('@tanstack/react-router', () => ({
    useMatch: () => pendingMatch,
}));

// The Trans macro compiles to the runtime Trans of @lingui/react
vi.mock('@lingui/react', () => ({
    Trans: ({ message, id }: { message?: string; id: string }) => <>{message ?? id}</>,
}));

function render(routeId: string, staticData: typeof pendingMatch.staticData = {}): string {
    pendingMatch.routeId = routeId;
    pendingMatch.staticData = staticData;
    return renderToStaticMarkup(<RoutePending />);
}

const skeletonKind = (markup: string) => markup.match(/data-skeleton="(\w+)"/)?.[1];

// OSS-1486 — a slow page change showed a centred spinner instead of the shape of the next page
describe('RoutePending', () => {
    it('shows the list page shape for a page without a path param', () => {
        const markup = render('/_authenticated/_products/products');

        expect(skeletonKind(markup)).toBe('list');
        expect(markup).toContain('role="status"');
        expect(markup).not.toContain('aria-busy');
    });

    it('shows the detail page shape for a page with a path param', () => {
        expect(skeletonKind(render('/_authenticated/_products/products_/$id'))).toBe('detail');
        expect(
            skeletonKind(
                render('/_authenticated/_orders/orders_/$aggregateOrderId_/seller-orders/$sellerOrderId'),
            ),
        ).toBe('detail');
    });

    it('shows the skeleton that the route declares', () => {
        expect(
            skeletonKind(
                render('/_authenticated/_global-settings/global-settings', { pendingSkeleton: 'detail' }),
            ),
        ).toBe('detail');
    });

    it('shows a spinner for the app shell, the sign-in pages and the home page', () => {
        for (const routeId of ['/_authenticated', '/login', '__root__', '/_authenticated/']) {
            const markup = render(routeId);
            expect(skeletonKind(markup), routeId).toBeUndefined();
            expect(markup, routeId).toContain('role="status"');
        }
    });
});
