/**
 * Dependencies kept **external** in the pre-built dashboard bundle
 * (`dist/bundle`, produced by `vite.lib.config.mts`).
 *
 * Anything not listed here is frozen into the bundle's shared chunks. That is
 * fine for leaf utilities, but a library that (a) owns a React Context or other
 * module-level singleton AND (b) is reachable by extension code through the
 * `@vendure/dashboard` public API MUST be external. Otherwise the consumer's
 * separate extension build re-bundles a second copy: the two module instances
 * each call `createContext()`, and the extension's hook reads a different
 * context than the one the dashboard's provider populated — the "No QueryClient
 * set" class of failure. See issue #4919.
 *
 * A duplication audit that turns this contract into a test lives in
 * `vite/tests/bundle-singleton.spec.ts`.
 */

/**
 * Always-external: resolved from the consumer's own module graph at runtime
 * (React, Lingui) or injected by the consumer's Vite plugins (`virtual:*`).
 */
export const runtimePeers: Array<string | RegExp> = [
    // React core (peer deps in user projects)
    'react',
    'react-dom',
    'react-dom/client',
    'react/jsx-runtime',
    'react/jsx-dev-runtime',
    // Lingui — macros are transformed separately; keep the runtime external
    /^@lingui\//,
    // Virtual modules — resolved by the consumer's vendureDashboardPlugin
    /^virtual:/,
    // @vendure/common is a peer of every Vendure plugin
    /^@vendure\/common(\/|$)/,
    // The dashboard's own subpath exports
    '@vendure/dashboard/plugin',
    '@vendure/dashboard/vite',
];

/**
 * Context- and singleton-bearing libraries that must be **shared** between the
 * dashboard app and extension code rather than frozen into the bundle. Keeping
 * them external means both `main.js` (which renders the providers) and an
 * extension's separately-built code resolve to the consumer's single instance.
 */
export const singletonSharedDeps: Array<string | RegExp> = [
    // @tanstack/react-query — QueryClientContext
    '@tanstack/react-query',
    // react-hook-form — FormProvider context
    'react-hook-form',
    // @tanstack/react-router — RouterContext (companion packages travel with it
    // since the whole package stays external)
    /^@tanstack\/react-router(\/|$)/,
    // sonner — module-level toast observer
    'sonner',
];

/**
 * Bare specifiers of {@link singletonSharedDeps}, for the consumer dev server's
 * dep optimizer (`optimizeDeps.include`) so every bare import — from the
 * pre-built `main.js`, from `lib.js`, and from extension code — resolves to one
 * pre-bundled instance.
 */
export const singletonSharedDepNames: string[] = [
    '@tanstack/react-query',
    'react-hook-form',
    '@tanstack/react-router',
    'sonner',
];

/**
 * The full external list for the dashboard bundle build.
 */
export const dashboardBundleExternals: Array<string | RegExp> = [
    ...runtimePeers,
    ...singletonSharedDeps,
];

/**
 * Returns `true` if `id` is matched by any entry in `externals` (string exact
 * match or subpath, or RegExp test).
 */
export function isExternalId(id: string, externals: Array<string | RegExp>): boolean {
    return externals.some(entry =>
        typeof entry === 'string' ? id === entry || id.startsWith(`${entry}/`) : entry.test(id),
    );
}
