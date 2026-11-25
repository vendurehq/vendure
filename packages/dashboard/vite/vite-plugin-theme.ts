import {
    animation,
    brand,
    darkShadows,
    darkTheme,
    destructive,
    duration,
    easing,
    fontFamily,
    fontFeatureSettings,
    fontSize,
    fontSizeLineHeight,
    fontWeight,
    info,
    keyframes,
    letterSpacing,
    lightShadows,
    lightTheme,
    neutral,
    radii,
    shadows,
    success,
    textStyles,
    viz,
    warning,
} from '@vendure-io/design-tokens';
import path from 'node:path';
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
     * The loading screen of a cold load reads only the `light`/`dark` options,
     * because it paints before these stylesheets load.
     *
     * @example
     * ```ts
     * vendureDashboardPlugin({
     *     theme: {
     *         additionalStylesheets: [path.resolve(import.meta.dirname, 'src/dashboard.css')],
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
/**
 * One `--font-<key>` runtime variable per design-token font family (`sans`,
 * `heading`, `body`, `mono`, `display`), so a custom theme can override any of
 * them, e.g. `light: { 'font-body': '…' }`.
 */
const fontVariables: ThemeColors = Object.fromEntries(
    Object.entries(fontFamily).map(([key, value]) => [`font-${key}`, value]),
);

/**
 * The colour ramps (`--brand-500`, `--destructive-900`, `--viz-1`, …) and the
 * default `--radius`, as `@vendure-io/design-tokens/css/variables` declares
 * them. They are the same in light and dark. `@vendure-io/ui` reads them in
 * arbitrary values, e.g. the destructive button hover mixes toward
 * `--destructive-900` and the accent card border uses `--brand-500`. Without
 * them those declarations are invalid and the browser drops the colour.
 */
const paletteVariables: ThemeColors = {
    ...Object.fromEntries(
        Object.entries({ brand, neutral, success, warning, destructive, info, viz }).flatMap(
            ([range, steps]) => Object.entries(steps).map(([step, value]) => [`${range}-${step}`, value]),
        ),
    ),
    radius: radii.md,
};

const dashboardLightExtensions: ThemeColors = {
    ...paletteVariables,
    'dev-mode': brand[400],
    'dev-mode-foreground': brand[950],
    ...fontVariables,
};

const dashboardDarkExtensions: ThemeColors = {
    ...paletteVariables,
    'dev-mode': brand[400],
    'dev-mode-foreground': brand[950],
    ...fontVariables,
};

/**
 * Themed shadows (`overlay`, `control`, `scrolled`) differ between light and
 * dark, so they are runtime variables in `:root` and `.dark` (`--shadow-<key>`),
 * like the colours. A custom theme overrides them with the same keys, e.g.
 * `light: { 'shadow-overlay': '…' }`.
 */
function toShadowVariables(themed: Record<string, string>): ThemeColors {
    return Object.fromEntries(Object.entries(themed).map(([key, value]) => [`shadow-${key}`, value]));
}

const defaultVariables: ThemeVariables = {
    light: { ...lightTheme, ...toShadowVariables(lightShadows), ...dashboardLightExtensions },
    dark: { ...darkTheme, ...toShadowVariables(darkShadows), ...dashboardDarkExtensions },
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
 * Converts a camelCase identifier to kebab-case for use in CSS, e.g.
 * `inOut` → `in-out`, `backgroundPosition` → `background-position`.
 */
function camelToKebab(str: string): string {
    return str.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`);
}

/**
 * Renders a flat map of (camelCase) CSS properties to values as indented CSS
 * declarations. Property names are kebab-cased; values are emitted verbatim.
 */
function cssDeclarations(props: Record<string, string>, indent: string): string {
    return Object.entries(props)
        .map(([prop, value]) => `${indent}${camelToKebab(prop)}: ${value};`)
        .join('\n');
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

    // Themed shadows — var() indirection to the :root/.dark variables, so the
    // `shadow-overlay`, `shadow-control` and `shadow-scrolled` utilities follow
    // the active theme and any custom theme override
    const themedShadowLines = Object.keys(lightShadows).map(
        key => `    --shadow-${key}: var(--shadow-${key});`,
    );

    // Fonts — use var() indirection so user overrides via themeVariablesPlugin
    // options are picked up (the :root block sets --font-* from dashboardExtensions)
    const fontLines = Object.entries(fontFamily).map(([key]) => `    --font-${key}: var(--font-${key});`);

    // Type — the design-system scale, as in `@vendure-io/design-tokens/css/theme`.
    // `--text-*` and `--text-*--line-height` drive the `text-*` utilities
    // (`text-sm` is 13px on a 20px line, not Tailwind's 14px).
    // `--font-<family>--font-feature-settings` turns on Inter's `cv11`, `ss01`
    // and `ss03` for the page and each `font-*` utility, and turns off Geist
    // Mono's ligatures. Weights and tracking match Tailwind's defaults today and
    // are emitted so they follow the design system if it changes them.
    const fontFeatureLines = Object.entries(fontFeatureSettings).map(
        ([key, value]) => `    --font-${key}--font-feature-settings: ${value};`,
    );
    const textLines = Object.entries(fontSize).map(([key, value]) => `    --text-${key}: ${value};`);
    const textLineHeightLines = Object.entries(fontSizeLineHeight).map(
        ([key, value]) => `    --text-${key}--line-height: ${value};`,
    );
    const fontWeightLines = Object.entries(fontWeight).map(
        ([key, value]) => `    --font-weight-${key}: ${value};`,
    );
    const trackingLines = Object.entries(letterSpacing).map(
        ([key, value]) => `    --tracking-${key}: ${value};`,
    );

    // Motion — easing curves, transition durations and named animations, emitted
    // as direct values (like radius/shadows). The token keys are camelCase; the
    // CSS names are kebab-case, as `@vendure-io/ui` reads them (`rowEnter` →
    // `--transition-duration-row-enter`, `livePulse` → `--animate-live-pulse`). v2 `@vendure-io/ui` atoms reference
    // these as CSS variables via arbitrary utilities (e.g.
    // `duration-(--transition-duration-fast)`, `ease-(--ease-out)`) and via the
    // `animate-*` utilities, so the custom properties must exist in the theme.
    const easingLines = Object.entries(easing).map(
        ([key, value]) => `    --ease-${camelToKebab(key)}: ${value};`,
    );
    const durationLines = Object.entries(duration).map(
        ([key, value]) => `    --transition-duration-${camelToKebab(key)}: ${value};`,
    );
    const animationLines = Object.entries(animation).map(
        ([key, value]) => `    --animate-${camelToKebab(key)}: ${value};`,
    );

    // Dashboard-specific tokens not present in the base design-tokens.
    // `brand`/`brand-foreground` are published by @vendure-io/design-tokens v2
    // and flow through automatically via `colorKeys` above, so they are not
    // redefined here.
    const dashboardLines = [
        '    --color-dev-mode: var(--dev-mode);',
        '    --color-dev-mode-foreground: var(--dev-mode-foreground);',
    ];

    const allLines = [
        ...colorLines,
        ...radiusLines,
        ...shadowLines,
        ...themedShadowLines,
        ...fontLines,
        ...fontFeatureLines,
        ...textLines,
        ...textLineHeightLines,
        ...fontWeightLines,
        ...trackingLines,
        ...easingLines,
        ...durationLines,
        ...animationLines,
        ...dashboardLines,
    ];
    return `@theme inline {\n${allLines.join('\n')}\n}`;
}

/**
 * Generates the top-level `@keyframes` blocks for the design-token `keyframes`
 * group. These cannot live inside `@theme inline` (they are CSS at-rules, not
 * variable declarations) and back the `--animate-*` tokens emitted above.
 */
function generateKeyframesBlocks(): string {
    return Object.entries(keyframes)
        .map(([name, steps]) => {
            const stepBlocks = Object.entries(steps as Record<string, Record<string, string>>)
                .map(([selector, props]) => `    ${selector} {\n${cssDeclarations(props, '        ')}\n    }`)
                .join('\n');
            return `@keyframes ${camelToKebab(name)} {\n${stepBlocks}\n}`;
        })
        .join('\n\n');
}

/**
 * Generates a Tailwind `@utility text-style-*` block per design-token text
 * style. v2 `@vendure-io/ui` atoms (card, dialog, sheet, page-header, …) apply
 * these as utility classes (e.g. `text-style-section-title`), so they must be
 * registered for the dashboard's Tailwind build.
 */
function generateTextStyleUtilities(): string {
    return Object.entries(textStyles)
        .map(
            ([name, props]) =>
                `@utility text-style-${name} {\n${cssDeclarations(props as Record<string, string>, '    ')}\n}`,
        )
        .join('\n\n');
}

/**
 * The variables that the boot screen in `index.html` reads. The stylesheet loads
 * with the app, so `index.html` gets these in an inline style to paint the boot
 * screen in the saved theme from the first frame.
 */
export const BOOT_VARIABLES = ['background', 'muted-foreground'];

/**
 * Generates the inline style for `index.html`: the boot variables of the light
 * theme in `:root` and of the dark theme in `.dark`, with the user's overrides,
 * as the stylesheet declares them once it loads.
 */
function generateBootStyle(light: ThemeColors, dark: ThemeColors): string {
    const declarations = (theme: ThemeColors) =>
        BOOT_VARIABLES.filter(key => theme[key] !== undefined)
            .map(key => `--${key}: ${theme[key] as string};`)
            .join(' ');
    return `:root { ${declarations(light)} } .dark { ${declarations(dark)} }`;
}

export function themeVariablesPlugin(options: ThemeVariablesPluginOptions): Plugin {
    const additionalStylesheets = normalizeStylesheetPaths(options.additionalStylesheets);
    // Merge default themes with custom themes
    const mergedLightTheme = { ...defaultVariables.light, ...options.theme?.light };
    const mergedDarkTheme = { ...defaultVariables.dark, ...options.theme?.dark };

    return {
        name: 'vendure:admin-theme',
        enforce: 'pre', // This ensures our plugin runs before other CSS processors
        transformIndexHtml(html, ctx) {
            // Don't add the boot style to Storybook HTML files
            if (
                ctx.filename &&
                (ctx.filename.includes('iframe.html') || ctx.filename.includes('storybook'))
            ) {
                return html;
            }
            return [
                {
                    tag: 'style',
                    children: generateBootStyle(mergedLightTheme, mergedDarkTheme),
                    // First in the head, so every stylesheet after it wins once it loads.
                    injectTo: 'head-prepend',
                },
            ];
        },
        transform(code, id) {
            // Only transform the dashboard's main `styles.css` (used in both
            // bundle and source mode, see issue #4719).
            if (!id.endsWith('styles.css')) {
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
                    [
                        generateThemeInlineBlock(),
                        generateKeyframesBlocks(),
                        generateTextStyleUtilities(),
                    ].join('\n\n'),
                );
                modified = true;
            }

            return modified ? result : null;
        },
    };
}
