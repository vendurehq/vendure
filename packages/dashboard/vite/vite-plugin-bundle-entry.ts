import { Plugin } from 'vite';

/**
 * @description
 * Rewrites the dashboard's `index.html` script entry from the TypeScript source
 * (`/src/app/main.jsx`) to the pre-built ESM bundle
 * (`/dist/bundle/main.js`).
 *
 * The CSS `<link>` tag is left untouched so the consumer's Tailwind +
 * themeVariables pipeline processes the source `styles.css` at consumer-time.
 * This keeps extension-authored Tailwind utility classes working.
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
                    (ctx.filename.includes('iframe.html') ||
                        ctx.filename.includes('storybook'))
                ) {
                    return html;
                }

                // The pre-built dashboard CSS contains the dashboard's own
                // resolved styles. The source-supplied `extension-tailwind.css`
                // is loaded via a JS import (rather than a plain <link>) so it
                // travels through Vite's full transform-hook pipeline — that's
                // what wires up `themeVariablesPlugin`, `dashboardTailwindSourcePlugin`,
                // and `@tailwindcss/vite` to generate utility classes for the
                // consumer's extension code (a plain <link> bypasses those
                // hooks and the virtual `@import 'virtual:admin-theme'`
                // directives fail to resolve).
                const dashboardCssLink =
                    `<link rel="stylesheet" href="/dist/bundle/dashboard.css" />`;
                const extensionCssImport =
                    `<script type="module">import '/src/app/extension-tailwind.css';</script>`;
                const newScript = `<script type="module" src="/dist/bundle/main.js"></script>`;

                // Match the source-entry script regardless of whether Vite has
                // already prepended the configured `base` to the src attribute.
                return html.replace(
                    /<script\s+type="module"\s+src="[^"]*src\/app\/main\.jsx"\s*><\/script>/,
                    `${dashboardCssLink}\n${extensionCssImport}\n${newScript}`,
                );
            },
        },
    };
}
