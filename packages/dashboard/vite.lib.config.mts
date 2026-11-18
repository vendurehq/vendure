import { lingui } from '@lingui/vite-plugin';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig, esmExternalRequirePlugin, Plugin } from 'vite';

import { dashboardBundleExternals } from './vite/lib-externals.js';
import { linguiBabelPlugin } from './vite/vite-plugin-lingui-babel.js';

/**
 * Builds the pre-built dashboard bundle in `dist/bundle` (`npm run build:lib`), which projects
 * get through `vendureDashboardPlugin`:
 *
 *  - `lib.js`: the `@vendure/dashboard` entry that extension code imports
 *  - `main.js`: the app entry, which the bundle-entry plugin loads from `index.html`
 *
 * React, Lingui, the context/singleton libraries and the `virtual:*` modules stay external
 * (see `vite/lib-externals.ts`), so that the project provides them and its Vite plugins can
 * fill in the virtual modules.
 *
 * The bundle contains no CSS. The project builds the dashboard's `styles.css` with its own
 * Tailwind and theme plugins, together with its extensions' classes, so the import of
 * `styles.css` in `main.tsx` is replaced with an empty module here.
 *
 * This config is not used by `build:standalone`.
 */
// Ensure the Lingui CLI uses the dashboard's own config when run from this dir.
process.env.LINGUI_CONFIG = path.resolve(import.meta.dirname, './lingui.config.js');

const EMPTY_STYLES = '\0vendure-dashboard-empty-styles';

/**
 * Replaces the import of the app's `styles.css` with an empty module (see above).
 */
function skipAppStylesPlugin(): Plugin {
    const stylesPath = path.resolve(import.meta.dirname, './src/app/styles.css');
    return {
        name: 'vendure:skip-app-styles',
        enforce: 'pre',
        async resolveId(source, importer) {
            if (!source.endsWith('.css')) {
                return;
            }
            const resolved = await this.resolve(source, importer, { skipSelf: true });
            if (resolved?.id.split('?')[0] === stylesPath) {
                return EMPTY_STYLES;
            }
        },
        load(id) {
            if (id === EMPTY_STYLES) {
                return '';
            }
        },
    };
}

export default defineConfig({
    // `public/` is published at the package root and served from there, so it is not copied in
    publicDir: false,
    plugins: [
        skipAppStylesPlugin(),
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
