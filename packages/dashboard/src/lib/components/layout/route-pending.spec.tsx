import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { registerDashboardPageBlock } from '../../framework/layout-engine/layout-extensions.js';
import { DetailPageSkeletonLayout } from '../../framework/page/detail-page-skeleton.js';
import { createPlatformPromotionState } from '../../framework/platform-promotion/platform-promotion.fixture.js';
import { RoutePending } from './route-pending.js';

const pendingMatch = vi.hoisted(() => ({
    routeId: '',
    staticData: {} as { pendingSkeleton?: 'list' | 'detail' | DetailPageSkeletonLayout },
}));

vi.mock('@/vdb/hooks/use-platform-promotion.js', () => ({
    usePlatformPromotion: () => createPlatformPromotionState([], true),
}));

vi.mock('@/vdb/hooks/use-mobile.js', () => ({
    useIsMobile: () => false,
}));

vi.mock('@/vdb/hooks/use-permissions.js', () => ({
    usePermissions: () => ({ hasPermissions: () => true }),
}));

vi.mock('@/vdb/hooks/use-user-settings.js', () => ({
    useUserSettings: () => ({ settings: { devMode: false } }),
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

    // OSS-1514 — every detail page loaded into the same generic form skeleton
    it('shows the blocks of the layout that the route declares, in their columns', () => {
        const markup = render('/_authenticated/_facets/facets_/$id', {
            pendingSkeleton: {
                pageId: 'skeleton-spec-page',
                blocks: [
                    { column: 'side', blockId: 'privacy', content: 'list', rows: 1 },
                    { column: 'main', blockId: 'main-form' },
                    { column: 'main', blockId: 'facet-values', content: 'table' },
                ],
            },
        });

        expect(skeletonKind(markup)).toBe('detail');
        expect(markup.match(/data-slot="data-table"/g)).toHaveLength(1);
        const main = markup.indexOf('@3xl/layout:col-span-3');
        const side = markup.indexOf('@3xl/layout:col-span-1');
        expect(main).toBeGreaterThan(-1);
        expect(markup.indexOf('data-slot="data-table"')).toBeGreaterThan(main);
        expect(markup.indexOf('data-slot="data-table"')).toBeLessThan(side);
    });

    it('draws the extension blocks registered for the page as skeleton cards', () => {
        registerDashboardPageBlock({
            id: 'skeleton-spec-extension',
            title: 'Extension title',
            location: {
                pageId: 'skeleton-spec-extension-page',
                column: 'main',
                position: { blockId: 'main-form', order: 'after' },
            },
            component: () => <div>extension content</div>,
        });
        registerDashboardPageBlock({
            id: 'skeleton-spec-conditional',
            location: {
                pageId: 'skeleton-spec-extension-page',
                column: 'main',
                position: { blockId: 'main-form', order: 'after' },
            },
            component: () => <div>conditional content</div>,
            shouldRender: () => true,
        });

        const markup = render('/_authenticated/_facets/facets_/$id', {
            pendingSkeleton: {
                pageId: 'skeleton-spec-extension-page',
                blocks: [{ column: 'main', blockId: 'main-form' }],
            },
        });

        expect(markup).not.toContain('extension content');
        expect(markup).not.toContain('Extension title');
        expect(markup).not.toContain('conditional content');
        expect(markup.match(/data-slot="card"/g)).toHaveLength(2);
    });

    it('shows a spinner for the app shell, the sign-in pages and the home page', () => {
        for (const routeId of ['/_authenticated', '/login', '__root__', '/_authenticated/']) {
            const markup = render(routeId);
            expect(skeletonKind(markup), routeId).toBeUndefined();
            expect(markup, routeId).toContain('role="status"');
        }
    });
});
