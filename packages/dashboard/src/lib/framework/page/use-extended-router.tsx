import {
    AnyRoute,
    AnyRouter,
    createRoute,
    createRouter,
    RouterOptions,
    useRouter,
    useRouterState,
} from '@tanstack/react-router';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { ErrorPage } from '../../components/shared/error-page.js';
import { AUTHENTICATED_ROUTE_PREFIX } from '../../constants.js';
import { useDashboardExtensions } from '../extension-api/use-dashboard-extensions.js';
import { extensionRoutes } from './page-api.js';

/**
 * Creates a TanStack Router with the base route tree extended with additional
 * routes from dashboard extensions.
 */
export const useExtendedRouter = (
    baseRouteTree: AnyRoute,
    routerOptions: Omit<RouterOptions<AnyRoute, any>, 'routeTree'>,
) => {
    const { extensionsLoaded } = useDashboardExtensions();

    return useMemo(() => {
        // Start with the base route tree
        let routeTree = baseRouteTree;

        // Only extend if extensions are loaded
        if (!extensionsLoaded) {
            return createExtendedRouter(routerOptions, routeTree);
        }

        const authenticatedRoute: AnyRoute | undefined = routeTree.children.find(
            (r: AnyRoute) => r.id === AUTHENTICATED_ROUTE_PREFIX,
        );

        if (!authenticatedRoute) {
            if (process.env.NODE_ENV !== 'production') {
                console.error(
                    `[Dashboard] Could not find authenticated route with id ` +
                        `"${AUTHENTICATED_ROUTE_PREFIX}" in the route tree. Extension routes ` +
                        `will not be registered. This usually indicates a drift ` +
                        `between AUTHENTICATED_ROUTE_PREFIX (src/lib/constants.ts) and the ` +
                        `route id generated from src/app/routes/_authenticated.tsx.`,
                );
            }
            // No authenticated route found, return router with base tree
            return createExtendedRouter(routerOptions, routeTree);
        }

        const newAuthenticatedRoutes: AnyRoute[] = [];
        const newRootRoutes: AnyRoute[] = [];

        // Create new routes for each extension
        for (const [path, config] of extensionRoutes.entries()) {
            const pathWithoutLeadingSlash = path.startsWith('/') ? path.slice(1) : path;

            // Check if route should be authenticated (default is true)
            const isAuthenticated = config.authenticated !== false;

            if (isAuthenticated) {
                // Check if the route already exists under authenticated route
                if (
                    authenticatedRoute.children.findIndex(
                        (r: AnyRoute) => r.path === pathWithoutLeadingSlash,
                    ) > -1
                ) {
                    warnRouteCollision(path);
                    continue;
                }

                const newRoute: AnyRoute = createRoute({
                    path: `/${pathWithoutLeadingSlash}`,
                    getParentRoute: () => authenticatedRoute,
                    loader: config.loader,
                    validateSearch: config.validateSearch,
                    component: () => config.component(newRoute),
                    errorComponent: ({ error }) => <ErrorPage message={error.message} />,
                });
                newAuthenticatedRoutes.push(newRoute);
            } else {
                // Check if the route already exists at the root level
                // Check both by path and by id (which includes the leading slash)
                const routeExists =
                    routeTree.children.some(
                        (r: AnyRoute) =>
                            r.path === `/${pathWithoutLeadingSlash}` ||
                            r.path === pathWithoutLeadingSlash ||
                            r.id === `/${pathWithoutLeadingSlash}`,
                    ) ||
                    newRootRoutes.some(
                        (r: AnyRoute) =>
                            r.path === `/${pathWithoutLeadingSlash}` ||
                            r.id === `/${pathWithoutLeadingSlash}`,
                    );

                if (routeExists) {
                    warnRouteCollision(path);
                    continue;
                }

                const newRoute: AnyRoute = createRoute({
                    path: `/${pathWithoutLeadingSlash}`,
                    getParentRoute: () => routeTree,
                    loader: config.loader,
                    validateSearch: config.validateSearch,
                    component: () => config.component(newRoute),
                    errorComponent: ({ error }) => <ErrorPage message={error.message} />,
                });
                newRootRoutes.push(newRoute);
            }
        }

        // Only extend the tree if we have new routes to add
        if (newAuthenticatedRoutes.length === 0 && newRootRoutes.length === 0) {
            return createExtendedRouter(routerOptions, routeTree);
        }

        // The base route tree is shared, and this memo can run more than once (StrictMode, HMR).
        // The extended routes are views, so the base routes keep their original children.
        const extendedAuthenticatedRoute = withChildren(authenticatedRoute, [
            ...authenticatedRoute.children,
            ...newAuthenticatedRoutes,
        ]);

        const extendedRouteTree = withChildren(routeTree, [
            ...routeTree.children.filter((r: AnyRoute) => r !== authenticatedRoute),
            extendedAuthenticatedRoute,
            ...newRootRoutes,
        ]);

        return createExtendedRouter(routerOptions, extendedRouteTree);
    }, [baseRouteTree, routerOptions, extensionsLoaded]);
};

function warnRouteCollision(path: string) {
    if (process.env.NODE_ENV !== 'production') {
        console.warn(
            `[Dashboard] Extension route "${path}" conflicts with an existing route and will not be registered.`,
        );
    }
}

/**
 * Returns a view of the route with the given children. The view reads and writes all other
 * properties on the route itself, so the route and its `children` array stay unchanged.
 */
function withChildren(route: AnyRoute, children: AnyRoute[]): AnyRoute {
    return new Proxy(route, {
        get: (target, prop) => (prop === 'children' ? children : Reflect.get(target, prop)),
    });
}

/**
 * Shows an error message when the router has not loaded a route. Without it, the page is blank.
 * For example, the dev build of `@tanstack/react-router` 1.170.x does not load a new router
 * instance that a mounted `RouterProvider` receives.
 */
function RouterLoadGuard({ children }: Readonly<{ children: ReactNode }>) {
    const router = useRouter();
    const hasNoMatches = useRouterState({ select: s => s.status === 'idle' && s.matches.length === 0 });
    // The router starts to load in a layout effect of `RouterProvider`. This effect runs later,
    // so a router that still has no matches at that time did not start to load.
    const [mountedRouter, setMountedRouter] = useState<AnyRouter>();
    useEffect(() => setMountedRouter(router), [router]);

    return (
        <>
            {children}
            {hasNoMatches && mountedRouter === router ? (
                <div className="text-destructive p-6">
                    The Dashboard router did not load a route. Reload the page.
                </div>
            ) : null}
        </>
    );
}

/**
 * Helper to create a router with extended route tree, handling some
 * type issues with hydrate/dehydrate functions.
 */
function createExtendedRouter(
    routerOptions: Omit<RouterOptions<AnyRoute, any>, 'routeTree'>,
    extendedRouteTree: AnyRoute,
) {
    return createRouter({
        InnerWrap: RouterLoadGuard,
        ...routerOptions,
        dehydrate: routerOptions.dehydrate as any,
        hydrate: routerOptions.hydrate as any,
        routeTree: extendedRouteTree,
    });
}
