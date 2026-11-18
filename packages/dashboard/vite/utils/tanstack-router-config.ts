import type { Config } from '@tanstack/router-plugin/vite';
import path from 'path';

/**
 * @description
 * Builds the options passed to the `tanstackRouter` Vite plugin, which generates the route
 * tree of the dashboard's own routes. Only used when the dashboard is served from its source
 * (see `DashboardMode`); the pre-built bundle already contains the route tree.
 *
 * `components`/`hooks`/`utils` are siblings of the routes and must stay excluded.
 */
export function buildTanstackRouterPluginConfig(packageRoot: string): Partial<Config> {
    return {
        autoCodeSplitting: true,
        routeFileIgnorePattern: '.graphql.ts|components|hooks|utils',
        routesDirectory: path.join(packageRoot, 'src/app/routes'),
        generatedRouteTree: path.join(packageRoot, 'src/app/routeTree.gen.ts'),
    };
}
