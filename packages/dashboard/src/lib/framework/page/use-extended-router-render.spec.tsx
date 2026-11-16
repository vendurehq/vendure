import {
    AnyRoute,
    AnyRouter,
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
    Outlet,
    RouterOptions,
    RouterProvider,
} from '@tanstack/react-router';
import { act, StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Each test imports fresh instances of these modules, because
// use-dashboard-extensions.js keeps the loaded state at module level.
let useDashboardExtensions: typeof import('../extension-api/use-dashboard-extensions.js').useDashboardExtensions;
let extensionRoutes: typeof import('./page-api.js').extensionRoutes;
let useExtendedRouter: typeof import('./use-extended-router.js').useExtendedRouter;

const runDashboardExtensions = vi.hoisted(() => vi.fn(async () => undefined));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('virtual:dashboard-extensions', () => ({
    runDashboardExtensions,
}));

vi.mock('../extension-api/define-dashboard-extension.js', () => ({
    onExtensionSourceChange: vi.fn(),
}));

vi.mock('../../components/shared/error-page.js', () => ({
    ErrorPage: () => null,
}));

const ROUTER_NOT_LOADED_MESSAGE = 'The Dashboard router did not load a route';

// Mirrors the generated route tree, initialised by createRouter() as main.tsx does.
function buildBaseRouteTree() {
    const rootRoute = createRootRoute();
    const authenticatedRoute = createRoute({
        id: '_authenticated',
        getParentRoute: () => rootRoute,
        component: () => <Outlet />,
    });
    const indexRoute = createRoute({
        path: '/',
        getParentRoute: () => authenticatedRoute,
        component: () => <div>Index page</div>,
    });
    const loginRoute = createRoute({
        path: '/login',
        getParentRoute: () => rootRoute,
        component: () => <div>Login page</div>,
    });
    const routeTree = rootRoute.addChildren([authenticatedRoute.addChildren([indexRoute]), loginRoute]);
    createRouter({ routeTree });
    return routeTree;
}

function buildRouterOptions(initialPath: string): Omit<RouterOptions<AnyRoute, any>, 'routeTree'> {
    return { history: createMemoryHistory({ initialEntries: [initialPath] }) };
}

// #5451 — the Dashboard went blank in dev mode when a second router replaced the first one
describe('useExtendedRouter rendering', () => {
    let container: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;
    let warn: ReturnType<typeof vi.spyOn>;
    let committedRouters: Set<AnyRouter>;
    let appRenders: boolean[];

    beforeEach(async () => {
        vi.resetModules();
        ({ useDashboardExtensions } = await import('../extension-api/use-dashboard-extensions.js'));
        ({ extensionRoutes } = await import('./page-api.js'));
        ({ useExtendedRouter } = await import('./use-extended-router.js'));
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        committedRouters = new Set();
        appRenders = [];
        // jsdom does not implement scrollTo, which the router calls after a navigation.
        vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
        warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(async () => {
        await act(async () => {
            root.unmount();
        });
        container.remove();
        vi.restoreAllMocks();
    });

    function InnerApp(props: {
        routeTree: AnyRoute;
        routerOptions: Omit<RouterOptions<AnyRoute, any>, 'routeTree'>;
        prepareRouter?: (router: AnyRouter) => void;
    }) {
        const router = useExtendedRouter(props.routeTree, props.routerOptions);
        props.prepareRouter?.(router);
        useEffect(() => {
            committedRouters.add(router);
        }, [router]);
        return <RouterProvider router={router} />;
    }

    // Mirrors App in main.tsx: the extensions load, then they register their routes,
    // then the component that builds the router mounts.
    function App(props: Parameters<typeof InnerApp>[0]) {
        const { extensionsLoaded } = useDashboardExtensions();
        appRenders.push(extensionsLoaded);
        const [extensionsRegistered, setExtensionsRegistered] = useState(false);
        useEffect(() => {
            if (extensionsLoaded) {
                extensionRoutes.set('/my-page', {
                    path: '/my-page',
                    component: () => <div>Extension page</div>,
                } as any);
                setExtensionsRegistered(true);
            }
        }, [extensionsLoaded]);
        return extensionsRegistered ? <InnerApp {...props} /> : null;
    }

    it('builds one router and renders an extension route after the extensions load', async () => {
        const routeTree = buildBaseRouteTree();
        const routerOptions = buildRouterOptions('/my-page');

        await act(async () => {
            root.render(
                <StrictMode>
                    <App routeTree={routeTree} routerOptions={routerOptions} />
                </StrictMode>,
            );
        });

        // The extensions load during this test: the first render of App has no extensions.
        expect(appRenders[0]).toBe(false);
        await vi.waitFor(() => expect(container.textContent).toContain('Extension page'));
        expect(container.textContent).not.toContain(ROUTER_NOT_LOADED_MESSAGE);
        expect(committedRouters.size).toBe(1);
        expect(warn).not.toHaveBeenCalled();
    });

    // @tanstack/react-router 1.170.x does not load a new router instance that a mounted
    // RouterProvider receives (dev builds only). Older versions load it.
    it('does not render a blank page when a mounted RouterProvider receives a second router', async () => {
        const routeTree = buildBaseRouteTree();

        await act(async () => {
            root.render(<App routeTree={routeTree} routerOptions={buildRouterOptions('/login')} />);
        });
        await vi.waitFor(() => expect(container.textContent).toContain('Login page'));

        await act(async () => {
            root.render(<App routeTree={routeTree} routerOptions={buildRouterOptions('/login')} />);
        });

        await vi.waitFor(() => expect(committedRouters.size).toBe(2));
        await vi.waitFor(() =>
            expect(container.textContent).toMatch(new RegExp(`Login page|${ROUTER_NOT_LOADED_MESSAGE}`)),
        );
    });

    it('shows an error message when the router does not load a route', async () => {
        const routeTree = buildBaseRouteTree();

        await act(async () => {
            root.render(
                <App
                    routeTree={routeTree}
                    routerOptions={buildRouterOptions('/login')}
                    // Simulates a router whose load never starts.
                    prepareRouter={router => {
                        router.load = async () => undefined;
                    }}
                />,
            );
        });

        await vi.waitFor(() => expect(container.textContent).toContain(ROUTER_NOT_LOADED_MESSAGE));
        expect(container.textContent).not.toContain('Login page');
    });
});
