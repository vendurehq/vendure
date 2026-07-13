import path from 'path';
import { ConfigEnv, Plugin, UserConfig } from 'vite';

export interface ViteConfigPluginOptions {
    packageRoot: string;
    /**
     * EXPERIMENTAL — see `vendureDashboardPlugin`'s `useExperimentalBundle` option.
     * When true, the consumer's Vite serves the pre-built dashboard bundle from
     * `<packageRoot>/dist/bundle/` instead of compiling the dashboard's
     * TypeScript source file-by-file. This collapses ~3,000 raw module fetches
     * into ~40 bundled chunks on cold load and fixes issue #4715.
     */
    useExperimentalBundle?: boolean;
}

export function viteConfigPlugin({ packageRoot, useExperimentalBundle }: ViteConfigPluginOptions): Plugin {
    return {
        name: 'vendure:vite-config-plugin',
        config: (config: UserConfig, env: ConfigEnv) => {
            // Only set the vite `root` to the dashboard package when running the dev server.
            // During a production build we still need to reference the dashboard source which
            // lives in `node_modules`, but we don't want the build output to be emitted in there.
            // Therefore, we set `root` only for `serve` and, for `build`, we instead make sure that
            // an `outDir` **outside** of `node_modules` is used (defaulting to the current working
            // directory if the user did not provide one already).
            config.root = packageRoot;

            config.publicDir = config.publicDir ?? path.join(packageRoot, 'public');

            // If we are building and no explicit outDir has been provided (or it is a relative path),
            // set it to an **absolute** path relative to the cwd so that the output never ends up in
            // `node_modules`.
            if (env.command === 'build') {
                const buildConfig = config.build ?? {};
                const outDir = buildConfig.outDir;

                const hasOutDir = typeof outDir === 'string' && outDir.length > 0;
                const outDirIsAbsolute = hasOutDir && path.isAbsolute(outDir);

                const normalizedOutDir = hasOutDir
                    ? outDirIsAbsolute
                        ? outDir
                        : path.resolve(process.cwd(), outDir)
                    : path.resolve(process.cwd(), 'dist');

                config.build = {
                    ...buildConfig,
                    outDir: normalizedOutDir,
                };
            }

            config.resolve = {
                alias: {
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
                              '@vendure/dashboard': path.resolve(
                                  packageRoot,
                                  './dist/bundle/lib.js',
                              ),
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
                ],
            };
            return config;
        },
    };
}
