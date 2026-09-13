import { AnyRoute, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { extensionRoutes, registerRoute } from './page-api.js';
import { useExtendedRouter } from './use-extended-router.js';

vi.mock('../extension-api/use-dashboard-extensions.js', () => ({
    useDashboardExtensions: () => ({ extensionsLoaded: true }),
}));

vi.mock('../../components/shared/error-page.js', () => ({
    ErrorPage: () => null,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useExtendedRouter', () => {
    let container: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;

    beforeEach(() => {
        extensionRoutes.clear();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => {
            root.unmount();
        });
        container.remove();
        extensionRoutes.clear();
        vi.restoreAllMocks();
    });

    // #5200 — extension route collisions should be visible during development
    it.each([
        { path: '/products', authenticated: true },
        { path: '/login', authenticated: false },
    ])('warns when $path collides with an existing route', async ({ path, authenticated }) => {
        const rootRoute = createRootRoute();
        const authenticatedRoute = createRoute({
            getParentRoute: () => rootRoute,
            id: '_authenticated',
        });
        const existingRoute = createRoute({
            getParentRoute: () => (authenticated ? authenticatedRoute : rootRoute),
            path,
        });
        const routeTree = rootRoute.addChildren([
            authenticatedRoute.addChildren(authenticated ? [existingRoute] : []),
            ...(authenticated ? [] : [existingRoute]),
        ]);
        createRouter({ routeTree });

        registerRoute({
            path,
            authenticated,
            component: () => null,
        });
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        function DashboardRouter() {
            useExtendedRouter(routeTree as AnyRoute, {});
            return null;
        }

        await act(async () => {
            root.render(<DashboardRouter />);
        });

        expect(warnSpy).toHaveBeenCalledOnce();
        expect(warnSpy).toHaveBeenCalledWith(
            `[Dashboard] Extension route "${path}" conflicts with an existing route and will not be registered.`,
        );
    });
});
