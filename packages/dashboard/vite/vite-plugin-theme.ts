import path from 'node:path';

import { brand, darkTheme, fontFamily, lightTheme, radii, shadows } from '@vendure-io/design-tokens';
import { Plugin } from 'vite';

type ThemeColors = Record<string, string | undefined>;

export interface ThemeVariables {
    light?: ThemeColors;
    dark?: ThemeColors;
}

/**
 * @description
 * Appearance options for the dashboard. Extends {@link ThemeVariables} (the
 * `light`/`dark` colour-token overrides) with the ability to layer in
 * additional stylesheets.
 *
 * @docsCategory vite-plugin
 * @docsPage vendureDashboardPlugin
 * @since 3.5.1
 */
export interface DashboardThemeOptions extends ThemeVariables {
    /**
     * @description
     * One or more paths to additional CSS files that should be imported into
     * the dashboard's main stylesheet. Each path is injected as an `@import`
     * statement at a dedicated insertion point among the stylesheet's other
     * imports, so the file participates in Tailwind's build pipeline — you can
     * use `@source`, `@theme`, `@apply`, `@utility`, custom variants, etc.
     * inside it.
     *
     * Paths may be absolute or relative to the current working directory;
     * relative paths are resolved against `process.cwd()`. Backslashes are
     * normalized to forward slashes so the resulting `@import` statement is
     * valid on Windows.
     *
     * To override design tokens (e.g. brand colors), prefer the `light`/`dark`
     * theme options — `additionalStylesheets` is for layering custom CSS rules.
     *
     * @example
     * ```ts
     * vendureDashboardPlugin({
     *     theme: {
     *         additionalStylesheets: [path.resolve(__dirname, 'src/dashboard.css')],
     *     },
     * })
     * ```
     */
    additionalStylesheets?: string | string[];
}

/**
 * Dashboard-specific tokens that extend the base design-tokens themes.
 * These are layered on top of `@vendure-io/design-tokens` `lightTheme`/`darkTheme`.
 */
const dashboardLightExtensions: ThemeColors = {
    'dev-mode': brand[400],
    'dev-mode-foreground': brand[950],
    brand: brand[500],
    'brand-lighter': brand[300],
    'brand-darker': brand[700],
    'font-sans': fontFamily.sans,
    'font-heading': fontFamily.heading,
    'font-body': fontFamily.body,
    'font-mono': fontFamily.mono,
};

const dashboardDarkExtensions: ThemeColors = {
    'dev-mode': brand[400],
    'dev-mode-foreground': brand[950],
    brand: brand[500],
    'brand-lighter': brand[50],
    'brand-darker': brand[700],
    'font-sans': fontFamily.sans,
    'font-heading': fontFamily.heading,
    'font-body': fontFamily.body,
    'font-mono': fontFamily.mono,
};

const defaultVariables: ThemeVariables = {
    light: { ...lightTheme, ...dashboardLightExtensions },
    dark: { ...darkTheme, ...dashboardDarkExtensions },
};

/**
 * Internal options for {@link themeVariablesPlugin}. Kept flat — the public
 * surface nests `additionalStylesheets` under the `theme` option (see
 * {@link DashboardThemeOptions}); the dashboard plugin maps the nested field
 * onto this flat shape.
 */
export type ThemeVariablesPluginOptions = {
    theme?: ThemeVariables;
    additionalStylesheets?: string | string[];
};

function normalizeStylesheetPaths(input: string | string[] | undefined): string[] {
    if (!input) return [];
    const list = Array.isArray(input) ? input : [input];
    return list.map(p => path.resolve(p).replace(/\\/g, '/'));
}

/**
 * Generates the `@theme inline` block from design-token JS exports,
 * mirroring the approach used by `@vendure-io/design-tokens/scripts/generate-css.ts`.
 * This avoids duplicating token values in CSS and keeps the dashboard in sync
 * with the design system automatically.
 */
function generateThemeInlineBlock(): string {
    // Semantic color mappings — every lightTheme key except 'radius' gets a --color-* alias
    const colorKeys = Object.keys(lightTheme).filter(k => k !== 'radius');
    const colorLines = colorKeys.map(key => `    --color-${key}: var(--${key});`);

    // Radius — direct values from token definitions (not calc-based)
    const radiusLines = Object.entries(radii).map(([key, value]) => `    --radius-${key}: ${value};`);

    // Shadows — direct values from token definitions
    const shadowLines = Object.entries(shadows).map(([key, value]) => `    --shadow-${key}: ${value};`);

    // Fonts — use var() indirection so user overrides via themeVariablesPlugin
    // options are picked up (the :root block sets --font-* from dashboardExtensions)
    const fontLines = Object.entries(fontFamily).map(([key]) => `    --font-${key}: var(--font-${key});`);

    // Dashboard-specific tokens not present in the base design-tokens
    const dashboardLines = [
        '    --color-dev-mode: var(--dev-mode);',
        '    --color-dev-mode-foreground: var(--dev-mode-foreground);',
        '    --color-brand: var(--brand);',
        '    --color-brand-lighter: var(--brand-lighter);',
        '    --color-brand-darker: var(--brand-darker);',
        '    --color-vendure-brand: #17c1ff;',
    ];

    const allLines = [...colorLines, ...radiusLines, ...shadowLines, ...fontLines, ...dashboardLines];
    return `@theme inline {\n${allLines.join('\n')}\n}`;
}

export function themeVariablesPlugin(options: ThemeVariablesPluginOptions): Plugin {
    const additionalStylesheets = normalizeStylesheetPaths(options.additionalStylesheets);

    return {
        name: 'vendure:admin-theme',
        enforce: 'pre', // This ensures our plugin runs before other CSS processors
        transform(code, id) {
            // Only transform CSS files: the dashboard's main `styles.css` and
            // the dashboard-extension entry `extension-tailwind.css` (used in
            // experimental-bundle mode, see issue #4719).
            if (!id.endsWith('styles.css') && !id.endsWith('extension-tailwind.css')) {
                return null;
            }

            let result = code;
            let modified = false;

            // Replace the `virtual:vendure-user-styles` placeholder with the
            // user-supplied stylesheets as @import statements. The placeholder
            // marks a deliberate insertion point among the @import statements in
            // styles.css, so the CSS stays valid (imports must precede rules) and
            // the imported files contribute @source, @theme, @apply, etc. to the
            // dashboard build. When no stylesheets are configured, the placeholder
            // is simply removed.
            if (
                result.includes('@import "virtual:vendure-user-styles";') ||
                result.includes("@import 'virtual:vendure-user-styles';")
            ) {
                const userImports = additionalStylesheets.map(p => `@import '${p}';`).join('\n');
                result = result.replace(/@import ['"]virtual:vendure-user-styles['"];?/, userImports);
                modified = true;
            }

            // Replace @import 'virtual:admin-theme' with :root / .dark CSS custom properties
            if (
                result.includes('@import "virtual:admin-theme";') ||
                result.includes("@import 'virtual:admin-theme';")
            ) {
                const lightOverrides = options.theme?.light || {};
                const darkOverrides = options.theme?.dark || {};

                // Merge default themes with custom themes
                const mergedLightTheme = { ...defaultVariables.light, ...lightOverrides };
                const mergedDarkTheme = { ...defaultVariables.dark, ...darkOverrides };

                const themeCSS = `
                    :root {
                        ${Object.entries(mergedLightTheme)
                            .filter(([key, value]) => value !== undefined)
                            .map(([key, value]) => `--${key}: ${value as string};`)
                            .join('\n')}
                    }

                    .dark {
                        ${Object.entries(mergedDarkTheme)
                            .filter(([key, value]) => value !== undefined)
                            .map(([key, value]) => `--${key}: ${value as string};`)
                            .join('\n')}
                    }
                `;

                result = result.replace(/@import ['"]virtual:admin-theme['"];?/, themeCSS);
                modified = true;
            }

            // Replace @import 'virtual:admin-theme-inline' with the generated @theme inline block
            if (
                result.includes('@import "virtual:admin-theme-inline";') ||
                result.includes("@import 'virtual:admin-theme-inline';")
            ) {
                result = result.replace(
                    /@import ['"]virtual:admin-theme-inline['"];?/,
                    generateThemeInlineBlock(),
                );
                modified = true;
            }

            return modified ? result : null;
        },
    };
}
