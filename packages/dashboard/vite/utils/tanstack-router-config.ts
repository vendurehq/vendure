import type { Config } from '@tanstack/router-plugin/vite';
import path from 'path';

/**
 * @description
 * The options accepted by the underlying TanStack Router Vite plugin (`tanstackRouter()`).
 */
export type TanstackRouterPluginOptions = Partial<Config>;

// Managed by the Dashboard: the route directory layout and generated tree path are wired to fixed
// locations, and `components`/`hooks`/`utils` are siblings of the routes that must stay excluded.
// User overrides of these are ignored (with a warning) rather than silently breaking the build.
const DASHBOARD_MANAGED_KEYS = [
    'routesDirectory',
    'generatedRouteTree',
    'routeFileIgnorePattern',
] as const;

/**
 * @description
 * Builds the options passed to the `tanstackRouter` Vite plugin. The Dashboard's own defaults are
 * merged with the user-provided `pluginOptions`, which can override anything except the keys the
 * Dashboard manages itself ({@link DASHBOARD_MANAGED_KEYS}).
 *
 * This lets deployments customize most aspects of the TanStack Router plugin — for example setting
 * `tmpDir` when the default temp directory is on a different device than the generated route tree,
 * which otherwise causes the build to fail with `EXDEV: cross-device link not permitted` during
 * route-tree generation. See #4048.
 */
export function buildTanstackRouterPluginConfig(
    packageRoot: string,
    pluginOptions: TanstackRouterPluginOptions = {},
): TanstackRouterPluginOptions {
    const ignored = DASHBOARD_MANAGED_KEYS.filter(key => key in pluginOptions);
    if (ignored.length) {
        console.warn(
            `[vendure:dashboard] Ignoring tanstackRouterPluginOptions managed by the Dashboard: ` +
                `${ignored.join(', ')}. These are fixed to ensure route generation works.`,
        );
    }
    return {
        autoCodeSplitting: true,
        ...pluginOptions,
        routeFileIgnorePattern: '.graphql.ts|components|hooks|utils',
        routesDirectory: path.join(packageRoot, 'src/app/routes'),
        generatedRouteTree: path.join(packageRoot, 'src/app/routeTree.gen.ts'),
    };
}
