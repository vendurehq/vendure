import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'path';
import { ConfigEnv, Plugin, UserConfig } from 'vite';

import { singletonSharedDepNames } from './lib-externals.js';

export interface ViteConfigPluginOptions {
    packageRoot: string;
    /**
     * The directory that receives the generated GraphQL types, matching what the
     * caller passes to `vendureDashboardPlugin`. Gives the `@/gql` import a target.
     */
    gqlOutputPath?: string;
    /**
     * EXPERIMENTAL — see `vendureDashboardPlugin`'s `useExperimentalBundle` option.
     * When true, the consumer's Vite serves the pre-built dashboard bundle from
     * `<packageRoot>/dist/bundle/` instead of compiling the dashboard's
     * TypeScript source file-by-file. This collapses ~3,000 raw module fetches
     * into ~40 bundled chunks on cold load and fixes issue #4715.
     */
    useExperimentalBundle?: boolean;
}

export function viteConfigPlugin({
    packageRoot,
    gqlOutputPath,
    useExperimentalBundle,
}: ViteConfigPluginOptions): Plugin {
    return {
        name: 'vendure:vite-config-plugin',
        config: (config: UserConfig, env: ConfigEnv) => {
            // Vite `root` is set to the dashboard package so that its source can be served and built.
            // Keep the user's root before replacing it, so that a relative `build.outDir` resolves against it.
            const userRoot = config.root ? path.resolve(config.root) : process.cwd();
            config.root = packageRoot;

            config.publicDir = config.publicDir ?? path.join(packageRoot, 'public');

            // When building, resolve `outDir` (default `dist`) against the user's root, so that the output
            // never ends up in the dashboard package inside `node_modules`.
            if (env.command === 'build') {
                const buildConfig = config.build ?? {};
                const outDir = buildConfig.outDir;

                const hasOutDir = typeof outDir === 'string' && outDir.length > 0;
                const outDirIsAbsolute = hasOutDir && path.isAbsolute(outDir);

                const normalizedOutDir = hasOutDir
                    ? outDirIsAbsolute
                        ? outDir
                        : path.resolve(userRoot, outDir)
                    : path.resolve(userRoot, 'dist');

                config.build = {
                    ...buildConfig,
                    outDir: normalizedOutDir,
                };
            }

            config.resolve = {
                alias: {
                    ...(gqlOutputPath ? { '@/gql': path.resolve(gqlOutputPath, 'graphql.ts') } : {}),
                    ...(config.resolve?.alias ?? {}),
                    // See the readme for an explanation of this alias.
                    '@/vdb': path.resolve(packageRoot, './src/lib'),
                    '@/graphql': path.resolve(packageRoot, './src/lib/graphql'),
                    // In experimental-bundle mode, redirect imports of
                    // `@vendure/dashboard` (from extension code) to the bundled
                    // library entry rather than the TypeScript source. The
                    // package's `exports."."` still points at the source so
                    // that TypeScript and other static tooling see types
                    // resolve correctly; this alias only affects Vite's
                    // module resolution at runtime.
                    ...(useExperimentalBundle
                        ? {
                              '@vendure/dashboard': getBundleLibEntry(packageRoot),
                          }
                        : {}),
                },
            };
            // Exclude the dashboard's source from Vite's dep optimizer in both
            // source mode and experimental-bundle mode. In source mode this
            // prevents Vite from trying to pre-bundle the dashboard source. In
            // bundle mode it stops Vite's scanner from following imports from
            // the dashboard's source files in node_modules (e.g. `await
            // import('virtual:plugin-translations')` inside load-i18n-messages),
            // which would otherwise fail because the virtual module isn't
            // resolvable to esbuild.
            config.optimizeDeps = {
                ...config.optimizeDeps,
                exclude: [
                    ...(config.optimizeDeps?.exclude || []),
                    '@vendure/dashboard',
                    '@/vdb',
                    'virtual:vendure-ui-config',
                    'virtual:admin-api-schema',
                    'virtual:dashboard-extensions',
                    'virtual:plugin-translations',
                ],
                // We however do want to pre-bundle recharts, as it depends
                // on lodash which is a CJS packages and _does_ require
                // pre-bundling.
                include: [
                    ...(config.optimizeDeps?.include || []),
                    '@/components > recharts',
                    '@/components > react-dropzone',
                    '@/components > @tiptap/react', // https://github.com/fawmi/vue-google-maps/issues/148#issuecomment-1235143844
                    '@vendure/common/lib/generated-types',
                    '@vendure/common/lib/shared-types',
                    '@vendure/common/lib/shared-utils',
                    'use-sync-external-store/shim',
                    'use-sync-external-store/shim/with-selector',
                    '@messageformat/parser',
                    // The Lingui runtime is only imported by macro-transformed code
                    // (and, in bundle mode, from within node_modules), so the
                    // scanner never finds it: it would be discovered late, forcing
                    // a reload. In bundle mode an un-optimized `@lingui/core` is
                    // also served raw to the bundle while extension code gets an
                    // optimized copy, i.e. two `i18n` singletons.
                    '@lingui/core',
                    '@lingui/react',
                    // In bundle mode these context/singleton libraries are kept
                    // external from the pre-built bundle (see lib-externals.ts),
                    // so pre-bundle them here to guarantee that main.js, lib.js
                    // and extension code all resolve to ONE instance. Without
                    // this the dashboard's provider and an extension's hook can
                    // bind to different module instances — issue #4919.
                    ...(useExperimentalBundle ? singletonSharedDepNames : []),
                ],
            };
            return config;
        },
    };
}

/**
 * Returns the bundle's library entry with a `?v=` derived from its contents.
 * Vite's own `?v=` (added for files in node_modules, served as immutable) does not
 * change with the bundle, so a rebuilt bundle would be shadowed by a stale cached
 * `lib.js`. Vite does not add its own `v` when one is present. The chunks have
 * content-hashed names referenced by `lib.js`, so hashing `lib.js` covers them.
 */
function getBundleLibEntry(packageRoot: string): string {
    const libEntry = path.resolve(packageRoot, './dist/bundle/lib.js');
    try {
        const version = createHash('sha256').update(fs.readFileSync(libEntry)).digest('hex').slice(0, 8);
        return `${libEntry}?v=${version}`;
    } catch {
        return libEntry;
    }
}
