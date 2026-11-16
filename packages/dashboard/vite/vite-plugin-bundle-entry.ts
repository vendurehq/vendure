import { Plugin } from 'vite';

/**
 * @description
 * Rewrites the dashboard's `index.html` script entry from the TypeScript source
 * (`/src/app/main.jsx`) to the pre-built ESM bundle
 * (`/dist/bundle/main.js`).
 *
 * The bundle does not import any CSS. Instead, the dashboard's source
 * `styles.css` is imported right after the bundle, so the consumer's Tailwind +
 * themeVariables pipeline processes it exactly as in source-shipping mode. The
 * `dashboardTailwindSourcePlugin` adds a `@source` for the bundle, so the
 * dashboard's own utility classes are generated along with the extension ones.
 *
 * Active only when `useExperimentalBundle` is enabled on
 * {@link vendureDashboardPlugin}. The bundle is generated at publish time by
 * `vite.lib.config.mts` and shipped inside the npm package.
 */
export function bundleEntryPlugin(): Plugin {
    return {
        name: 'vendure:bundle-entry',
        transformIndexHtml: {
            order: 'pre',
            handler(html, ctx) {
                // Don't transform Storybook HTML or anything else outside the dashboard's own entry
                if (
                    ctx.filename &&
                    (ctx.filename.includes('iframe.html') || ctx.filename.includes('storybook'))
                ) {
                    return html;
                }

                const newScript = `<script type="module" src="/dist/bundle/main.js"></script>`;
                // `styles.css` is loaded via a JS import (rather than a plain <link>)
                // so it travels through Vite's full transform-hook pipeline — that's
                // what wires up `themeVariablesPlugin`, `dashboardTailwindSourcePlugin`,
                // and `@tailwindcss/vite` (a plain <link> bypasses those hooks and the
                // virtual `@import 'virtual:admin-theme'` directives fail to resolve).
                //
                // We deliberately do NOT load the pre-built `dist/bundle/dashboard.css`
                // next to it: two Tailwind outputs with the same utilities in two
                // stylesheets break the cascade order of equal-specificity rules
                // (e.g. `.w-fit` would win over `*:w-full`).
                //
                // The import comes after the bundle, so the stylesheet is added after
                // the styles that libraries (e.g. sonner) inject when imported — the
                // same order as `import './styles.css'` in `main.tsx` in source mode.
                const stylesImport = `<script type="module">import '/src/app/styles.css';</script>`;

                // Match the source-entry script regardless of whether Vite has
                // already prepended the configured `base` to the src attribute.
                return html.replace(
                    /<script\s+type="module"\s+src="[^"]*src\/app\/main\.jsx"\s*><\/script>/,
                    `${newScript}\n${stylesImport}`,
                );
            },
        },
    };
}
