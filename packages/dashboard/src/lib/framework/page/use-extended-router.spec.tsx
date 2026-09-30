import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { extensionRoutes } from './page-api.js';
import { useExtendedRouter } from './use-extended-router.js';

vi.mock('../extension-api/use-dashboard-extensions.js', () => ({
    useDashboardExtensions: () => ({ extensionsLoaded: true, reloadCount: 0 }),
}));

vi.mock('../../components/shared/error-page.js', () => ({
    ErrorPage: () => null,
}));

// Mirrors the generated route tree: core routes declared with a leading slash,
// then initialised by createRouter() (as main.tsx does), which trims it.
function buildBaseRouteTree() {
    const rootRoute = createRootRoute();
    const authenticatedRoute = createRoute({ id: '_authenticated', getParentRoute: () => rootRoute });
    const orderModifyRoute = createRoute({
        path: '/orders/$id/modify',
        getParentRoute: () => authenticatedRoute,
    });
    const loginRoute = createRoute({ path: '/login', getParentRoute: () => rootRoute });
    const routeTree = rootRoute.addChildren([authenticatedRoute.addChildren([orderModifyRoute]), loginRoute]);
    createRouter({ routeTree });
    return routeTree;
}

function runHook(routeTree = buildBaseRouteTree()) {
    let routeIds: string[] = [];
    function Probe() {
        routeIds = Object.keys(useExtendedRouter(routeTree, {}).routesById);
        return null;
    }
    renderToStaticMarkup(<Probe />);
    return routeIds;
}

// #5200 — extension route collisions should be visible during development
describe('useExtendedRouter route collisions', () => {
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        extensionRoutes.clear();
        warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
        warn.mockRestore();
        extensionRoutes.clear();
    });

    it('warns when an authenticated extension route collides with a built-in route', () => {
        extensionRoutes.set('/orders/$id/modify', {
            path: '/orders/$id/modify',
            component: () => null,
        } as any);

        const routeIds = runHook();

        expect(routeIds.filter(id => id.endsWith('orders/$id/modify'))).toHaveLength(1);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('/orders/$id/modify'));
    });

    it('warns when an unauthenticated extension route collides with a built-in root route', () => {
        extensionRoutes.set('/login', { path: '/login', authenticated: false, component: () => null } as any);

        const routeIds = runHook();

        expect(routeIds.filter(id => id.endsWith('login'))).toHaveLength(1);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('/login'));
    });

    it('does not warn for a non-colliding extension route', () => {
        extensionRoutes.set('/my-page', { path: '/my-page', component: () => null } as any);

        const routeIds = runHook();

        expect(routeIds).toContain('/_authenticated/my-page');
        expect(warn).not.toHaveBeenCalled();
    });
});

// #5451 — the hook changed the shared base route tree, so a second run reported false collisions
describe('useExtendedRouter base route tree', () => {
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        extensionRoutes.clear();
        warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
        warn.mockRestore();
        extensionRoutes.clear();
    });

    it('does not change the base route tree', () => {
        extensionRoutes.set('/my-page', { path: '/my-page', component: () => null } as any);
        extensionRoutes.set('/public', {
            path: '/public',
            authenticated: false,
            component: () => null,
        } as any);
        const routeTree = buildBaseRouteTree();
        const authenticatedRoute = routeTree.children.find((r: any) => r.id === '/_authenticated');
        const rootChildren = routeTree.children;
        const rootChildIds = rootChildren.map((r: any) => r.id);
        const authenticatedChildren = authenticatedRoute.children;
        const authenticatedChildIds = authenticatedChildren.map((r: any) => r.id);

        const routeIds = runHook(routeTree);

        expect(routeIds).toContain('/_authenticated/my-page');
        expect(routeIds).toContain('/public');
        expect(routeTree.children).toBe(rootChildren);
        expect(routeTree.children.map((r: any) => r.id)).toEqual(rootChildIds);
        expect(authenticatedRoute.children).toBe(authenticatedChildren);
        expect(authenticatedRoute.children.map((r: any) => r.id)).toEqual(authenticatedChildIds);
    });

    // StrictMode and HMR run the hook again with the same base route tree.
    it('does not warn when the hook runs again with the same base route tree', () => {
        extensionRoutes.set('/my-page', { path: '/my-page', component: () => null } as any);
        extensionRoutes.set('/public', {
            path: '/public',
            authenticated: false,
            component: () => null,
        } as any);
        const routeTree = buildBaseRouteTree();

        const firstRouteIds = runHook(routeTree);
        const secondRouteIds = runHook(routeTree);

        expect(secondRouteIds).toEqual(firstRouteIds);
        expect(secondRouteIds).toContain('/_authenticated/my-page');
        expect(secondRouteIds).toContain('/public');
        expect(warn).not.toHaveBeenCalled();
    });
});
