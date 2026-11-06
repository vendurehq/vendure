import { lingui } from '@lingui/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig, esmExternalRequirePlugin } from 'vite';

import { dashboardBundleExternals } from './vite/lib-externals.js';
import { linguiBabelPlugin } from './vite/vite-plugin-lingui-babel.js';
import { themeVariablesPlugin } from './vite/vite-plugin-theme.js';

/**
 * Library build config for the spike (#4719) investigating whether
 * `@vendure/dashboard` can ship as a pre-built ESM bundle instead of
 * TypeScript source.
 *
 * This config is NOT used by `build:standalone` (the existing prod-app
 * build) — it produces a single `dist/lib/index.js` ESM bundle suitable
 * for consumer projects to import via `@vendure/dashboard`.
 *
 * Run with: `vite build --config vite.lib.config.mts`
 *
 * Minimal first pass:
 *  - bundle as much as possible
 *  - keep react/react-dom + lingui externals so consumer provides them
 *  - keep `virtual:*` ids unresolved so the consumer's vite plugins
 *    can still inject their runtime values
 */
// Ensure the Lingui CLI uses the dashboard's own config when run from this dir.
process.env.LINGUI_CONFIG = path.resolve(import.meta.dirname, './lingui.config.js');

export default defineConfig({
    plugins: [
        themeVariablesPlugin({}),
        tailwindcss(),
        // Compiles the Lingui macros before @vitejs/plugin-react, which does not run Babel.
        linguiBabelPlugin(),
        react(),
        lingui(),
        // Marks the externals and rewrites bundled CommonJS `require()` calls of them
        // (e.g. use-sync-external-store's `require('react')`) into ESM imports. Without it
        // they stay runtime `require()` calls, which throw in the browser.
        esmExternalRequirePlugin({ external: dashboardBundleExternals }),
    ],
    resolve: {
        alias: {
            '@/vdb': path.resolve(import.meta.dirname, './src/lib'),
            '@/graphql': path.resolve(import.meta.dirname, './src/lib/graphql'),
        },
    },
    build: {
        outDir: path.resolve(import.meta.dirname, './dist/bundle'),
        emptyOutDir: true,
        // Skip sourcemaps in the published bundle: they would inflate the
        // npm tarball by ~5-10x with no end-user benefit (sourcemaps are only
        // useful for developers of the dashboard itself, who work from source).
        sourcemap: false,
        minify: false,
        lib: {
            entry: {
                // Library entry — extension authors import from here via `@vendure/dashboard`
                lib: path.resolve(import.meta.dirname, './src/lib/index.ts'),
                // App entry — bootstraps the dashboard UI (used by index.html)
                main: path.resolve(import.meta.dirname, './src/app/main.tsx'),
            },
            formats: ['es'],
            fileName: name => `${name}.js`,
        },
        rolldownOptions: {
            // The externals are declared through esmExternalRequirePlugin above. The list is the
            // single source of truth shared with the duplication audit
            // (vite/tests/bundle-singleton.spec.ts). See vite/lib-externals.ts.
            output: {
                // Predictable entry names so index.html can reference them
                entryFileNames: '[name].js',
                chunkFileNames: 'chunks/[name]-[hash].js',
                assetFileNames: '[name][extname]',
            },
        },
    },
});
