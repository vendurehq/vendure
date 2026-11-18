import { lingui } from '@lingui/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'path';
import { PluginOption } from 'vite';

import { DashboardMode, PathAdapter } from './types.js';
import { PackageScannerConfig } from './utils/compiler.js';
import { buildTanstackRouterPluginConfig } from './utils/tanstack-router-config.js';
import { getDefaultTempCompilationDir } from './utils/temp-compilation-dir.js';
import { adminApiSchemaPlugin } from './vite-plugin-admin-api-schema.js';
import { bundleEntryPlugin } from './vite-plugin-bundle-entry.js';
import { chunkHashPlugin } from './vite-plugin-chunk-hash.js';
import { configLoaderPlugin } from './vite-plugin-config-loader.js';
import { viteConfigPlugin } from './vite-plugin-config.js';
import { dashboardMetadataPlugin } from './vite-plugin-dashboard-metadata.js';
import { deprecatedAliasPlugin } from './vite-plugin-deprecated-alias.js';
import { gqlTadaPlugin } from './vite-plugin-gql-tada.js';
import { hmrPlugin } from './vite-plugin-hmr.js';
import { linguiBabelPlugin } from './vite-plugin-lingui-babel.js';
import { platformPromotionPlugin } from './vite-plugin-platform-promotion.js';
import { dashboardTailwindSourcePlugin } from './vite-plugin-tailwind-source.js';
import { DashboardThemeOptions, themeVariablesPlugin } from './vite-plugin-theme.js';
import { transformIndexHtmlPlugin } from './vite-plugin-transform-index.js';
import { translationsPlugin } from './vite-plugin-translations.js';
import { uiConfigPlugin, UiConfigPluginOptions } from './vite-plugin-ui-config.js';

/**
 * @description
 * Options for the {@link vendureDashboardPlugin} Vite plugin.
 *
 * @docsCategory vite-plugin
 * @docsPage vendureDashboardPlugin
 * @since 3.4.0
 * @docsWeight 1
 */
export type VitePluginVendureDashboardOptions = {
    /**
     * @description
     * The path to the Vendure server configuration file.
     */
    vendureConfigPath: string | URL;
    /**
     * @description
     * The {@link PathAdapter} allows you to customize the resolution of paths
     * in the compiled Vendure source code which is used as part of the
     * introspection step of building the dashboard.
     *
     * It enables support for more complex repository structures, such as
     * monorepos, where the Vendure server configuration file may not
     * be located in the root directory of the project.
     *
     * If you get compilation errors like "Error loading Vendure config: Cannot find module",
     * you probably need to provide a custom `pathAdapter` to resolve the paths correctly.
     *
     * @example
     * ```ts
     * vendureDashboardPlugin({
     *     tempCompilationDir: join(import.meta.dirname, './__vendure-dashboard-temp'),
     *     pathAdapter: {
     *         getCompiledConfigPath: ({ inputRootDir, outputPath, configFileName }) => {
     *             const projectName = inputRootDir.split('/libs/')[1].split('/')[0];
     *             const pathAfterProject = inputRootDir.split(`/libs/${projectName}`)[1];
     *             const compiledConfigFilePath = `${outputPath}/${projectName}${pathAfterProject}`;
     *             return path.join(compiledConfigFilePath, configFileName);
     *         },
     *         transformTsConfigPathMappings: ({ phase, patterns }) => {
     *             // "loading" phase is when the compiled Vendure code is being loaded by
     *             // the plugin, in order to introspect the configuration of your app.
     *             if (phase === 'loading') {
     *                 return patterns.map((p) =>
     *                     p.replace('libs/', '').replace(/.ts$/, '.js'),
     *                 );
     *             }
     *             return patterns;
     *         },
     *     },
     *     // ...
     * }),
     * ```
     */
    pathAdapter?: PathAdapter;
    /**
     * @description
     * The name of the exported variable from the Vendure server configuration file, e.g. `config`.
     * This is only required if the plugin is unable to auto-detect the name of the exported variable.
     */
    vendureConfigExport?: string;
    /**
     * @description
     * The path to the directory where the generated GraphQL Tada files will be output.
     */
    gqlOutputPath?: string;
    /**
     * @description
     * The directory into which the VendureConfig is transpiled and loaded in order
     * to introspect the configuration during the dashboard build.
     *
     * Defaults to `<project>/node_modules/.cache/vendure-dashboard-temp`. It must
     * not be located inside a `"type": "module"` package (such as
     * `@vendure/dashboard` itself), because the config is compiled to CommonJS and
     * Node would then load it as ESM, failing with
     * `exports is not defined in ES module scope`.
     */
    tempCompilationDir?: string;
    /**
     * @description
     * Allows you to customize the location of node_modules & glob patterns used to scan for potential
     * Vendure plugins installed as npm packages. If not provided, the compiler will attempt to guess
     * the location based on the location of the `@vendure/core` package.
     */
    pluginPackageScanner?: PackageScannerConfig;
    /**
     * @description
     * Allows you to specify the module system to use when compiling and loading your Vendure config.
     * By default, the compiler will use CommonJS, but you can set it to `esm` if you are using
     * ES Modules in your Vendure project.
     *
     * **Status** Developer preview. If you are using ESM please try this out and provide us with feedback!
     *
     * @since 3.5.1
     * @default 'commonjs'
     */
    module?: 'commonjs' | 'esm';
    /**
     * @description
     * Allows you to selectively disable individual plugins.
     * @example
     * ```ts
     * vendureDashboardPlugin({
     *   vendureConfigPath: './config.ts',
     *   disablePlugins: {
     *     react: true,
     *     lingui: true,
     *   }
     * })
     * ```
     */
    disablePlugins?: {
        tanstackRouter?: boolean;
        linguiBabel?: boolean;
        react?: boolean;
        lingui?: boolean;
        themeVariables?: boolean;
        tailwindSource?: boolean;
        tailwindcss?: boolean;
        configLoader?: boolean;
        viteConfig?: boolean;
        chunkHash?: boolean;
        bundleEntry?: boolean;
        adminApiSchema?: boolean;
        dashboardMetadata?: boolean;
        platformPromotion?: boolean;
        uiConfig?: boolean;
        gqlTada?: boolean;
        transformIndexHtml?: boolean;
        translations?: boolean;
        hmr?: boolean;
    };
    /**
     * @description
     * Customizes the dashboard's appearance. Override design-token colours for
     * the `light` and `dark` themes, and/or layer in additional stylesheets via
     * `additionalStylesheets`.
     *
     * @example
     * ```ts
     * vendureDashboardPlugin({
     *     theme: {
     *         light: { brand: '#1a1a1a' },
     *         additionalStylesheets: [resolve(import.meta.dirname, 'src/dashboard.css')],
     *     },
     * })
     * ```
     */
    theme?: DashboardThemeOptions;
    /**
     * @description
     * Set to `false` to turn off the Vendure Platform items in the Dashboard: locked navigation
     * items, locked pages, page cards and the related page actions. The build then sends no
     * request to `api.vendure.io`. The environment variable
     * `VENDURE_DASHBOARD_PLATFORM_PROMOTION=false` has the same effect. Do not use
     * `disablePlugins.platformPromotion` for this: it removes a module that the Dashboard needs,
     * and the build fails.
     *
     * @default true
     * @since 3.9.0
     */
    platformPromotion?: boolean;
} & UiConfigPluginOptions;

/**
 * @description
 * This is a Vite plugin which configures a set of plugins required to build the Vendure Dashboard.
 */
type PluginKey = keyof NonNullable<VitePluginVendureDashboardOptions['disablePlugins']>;

type PluginMapEntry = {
    key: PluginKey;
    plugin: () => PluginOption | PluginOption[] | false | '';
};

/**
 * @description
 * This is the Vite plugin which powers the Vendure Dashboard, including:
 *
 * - Configuring routing, styling and React support
 * - Analyzing your VendureConfig file and introspecting your schema
 * - Loading your custom Dashboard extensions
 *
 * @docsCategory vite-plugin
 * @docsPage vendureDashboardPlugin
 * @since 3.4.0
 * @docsWeight 0
 */
export function vendureDashboardPlugin(options: VitePluginVendureDashboardOptions): PluginOption[] {
    const packageRoot = getDashboardPackageRoot();
    const mode = getDashboardMode();
    if (mode === 'bundle') {
        assertBundleExists(packageRoot);
    }
    return createDashboardPlugins(options, packageRoot, mode);
}

function getDashboardMode(): DashboardMode {
    return process.env.VENDURE_DASHBOARD_FROM_SOURCE === 'true' ? 'source' : 'bundle';
}

function assertBundleExists(packageRoot: string) {
    const libEntry = path.join(packageRoot, 'dist/bundle/lib.js');
    if (!fs.existsSync(libEntry)) {
        throw new Error(
            `[@vendure/dashboard] The pre-built dashboard bundle was not found at ${libEntry}. ` +
                `In the Vendure repo, either run "npm run build:lib" in packages/dashboard, or set ` +
                `VENDURE_DASHBOARD_FROM_SOURCE=true to serve the dashboard from its source.`,
        );
    }
}

/**
 * @description
 * Builds the plugin list for {@link vendureDashboardPlugin}. Takes the package
 * root as an argument because `import.meta.resolve`, used to find it, is not
 * available under Vitest.
 *
 * @internal
 */
export function createDashboardPlugins(
    options: VitePluginVendureDashboardOptions,
    packageRoot: string,
    mode: DashboardMode = 'bundle',
): PluginOption[] {
    const tempDir = options.tempCompilationDir ?? getDefaultTempCompilationDir();
    const tempInstanceId = `${process.pid}-${randomUUID()}`;
    const compilationTempDir = path.join(tempDir, 'compiler', tempInstanceId);
    const gqlTadaTempDir = path.join(tempDir, 'gql-tada', tempInstanceId);
    const normalizedVendureConfigPath = getNormalizedVendureConfigPath(options.vendureConfigPath);
    const linguiConfigPath = path.join(packageRoot, 'lingui.config.js');
    const disabled = options.disablePlugins ?? {};

    if (process.env.IS_LOCAL_DEV !== 'true') {
        process.env.LINGUI_CONFIG = linguiConfigPath;
    }

    const pluginMap: PluginMapEntry[] = [
        {
            // Generates the route tree of the dashboard's own routes. The bundle already
            // contains it, so this only runs in source mode. Extension routes are added at
            // runtime and don't go through this plugin.
            key: 'tanstackRouter',
            plugin: () => mode === 'source' && tanstackRouter(buildTanstackRouterPluginConfig(packageRoot)),
        },
        {
            // Custom plugin that transforms Lingui macros using Babel instead of SWC.
            // This runs BEFORE the react plugin to ensure macros are transformed first.
            // Using Babel eliminates the SWC binary compatibility issues that caused
            // "failed to invoke plugin" errors in external projects.
            // See: https://github.com/vendurehq/vendure/issues/3929
            key: 'linguiBabel',
            plugin: () => linguiBabelPlugin(),
        },
        {
            key: 'react',
            plugin: () => react(),
        },
        {
            key: 'lingui',
            plugin: () => {
                const linguiPlugins = lingui({});
                // Filter out the macro error reporter added in @lingui/vite-plugin 5.9+.
                // It throws on resolveId before our custom linguiBabelPlugin can transform
                // the macros away in its transform hook.
                return (Array.isArray(linguiPlugins) ? linguiPlugins : [linguiPlugins]).filter(
                    (p: any) => p?.name !== 'vite-plugin-lingui-report-macro-error',
                );
            },
        },
        {
            key: 'themeVariables',
            plugin: () =>
                themeVariablesPlugin({
                    theme: options.theme,
                    additionalStylesheets: options.theme?.additionalStylesheets,
                }),
        },
        {
            key: 'tailwindSource',
            plugin: () =>
                dashboardTailwindSourcePlugin({
                    packageRoot,
                    mode,
                }),
        },
        {
            key: 'tailwindcss',
            plugin: () => tailwindcss(),
        },
        {
            key: 'configLoader',
            plugin: () =>
                configLoaderPlugin({
                    vendureConfigPath: normalizedVendureConfigPath,
                    outputPath: compilationTempDir,
                    pathAdapter: options.pathAdapter,
                    pluginPackageScanner: options.pluginPackageScanner,
                    module: options.module,
                }),
        },
        {
            key: 'viteConfig',
            plugin: () => [
                viteConfigPlugin({
                    packageRoot,
                    gqlOutputPath: options.gqlOutputPath,
                    mode,
                }),
                mode === 'bundle' && deprecatedAliasPlugin({ packageRoot }),
            ],
        },
        {
            key: 'chunkHash',
            plugin: () => chunkHashPlugin(),
        },
        {
            key: 'bundleEntry',
            plugin: () => mode === 'bundle' && bundleEntryPlugin(),
        },
        {
            key: 'adminApiSchema',
            plugin: () => adminApiSchemaPlugin(),
        },
        {
            key: 'dashboardMetadata',
            plugin: () => dashboardMetadataPlugin(),
        },
        {
            key: 'platformPromotion',
            plugin: () => platformPromotionPlugin({ enabled: options.platformPromotion }),
        },
        {
            key: 'uiConfig',
            plugin: () => uiConfigPlugin(options),
        },
        {
            key: 'gqlTada',
            plugin: () =>
                options.gqlOutputPath &&
                gqlTadaPlugin({
                    gqlTadaOutputPath: options.gqlOutputPath,
                    tempDir: gqlTadaTempDir,
                    packageRoot,
                }),
        },
        {
            key: 'transformIndexHtml',
            plugin: () => transformIndexHtmlPlugin(),
        },
        {
            key: 'translations',
            plugin: () =>
                translationsPlugin({
                    packageRoot,
                }),
        },
        {
            key: 'hmr',
            plugin: () => hmrPlugin(),
        },
    ];

    const plugins: PluginOption[] = [];

    for (const entry of pluginMap) {
        if (!disabled[entry.key]) {
            const plugin = entry.plugin();
            if (plugin) {
                if (Array.isArray(plugin)) {
                    plugins.push(...plugin);
                } else {
                    plugins.push(plugin);
                }
            }
        }
    }

    return plugins;
}

/**
 * @description
 * Walks up from `fromFile` until it finds a `package.json` whose `name` field
 * matches `packageName`, and returns that directory.
 */
export function findPackageRoot(fromFile: string, packageName: string): string {
    let dir = path.dirname(fromFile);
    while (true) {
        const packageJsonPath = path.join(dir, 'package.json');
        if (
            fs.existsSync(packageJsonPath) &&
            JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')).name === packageName
        ) {
            return dir;
        }
        const parentDir = path.dirname(dir);
        if (parentDir === dir) {
            throw new Error(`Could not find the root of the "${packageName}" package above ${fromFile}`);
        }
        dir = parentDir;
    }
}

/**
 * @description
 * Returns the path to the root of the `@vendure/dashboard` package.
 */
function getDashboardPackageRoot(): string {
    // fileURLToPath (rather than URL.pathname) decodes percent-encoding, so paths
    // containing e.g. spaces resolve correctly, and handles Windows drive letters.
    const fileUrl = import.meta.resolve('@vendure/dashboard');
    const packagePath = fileUrl.startsWith('file:') ? fileURLToPath(fileUrl) : fileUrl;

    return findPackageRoot(packagePath, '@vendure/dashboard');
}

/**
 * Get the normalized path to the Vendure config file given either a string or URL.
 */
export function getNormalizedVendureConfigPath(vendureConfigPath: string | URL): string {
    const stringPath = typeof vendureConfigPath === 'string' ? vendureConfigPath : vendureConfigPath.href;
    if (stringPath.startsWith('file:')) {
        // fileURLToPath decodes percent-encoding (e.g. spaces) and handles Windows drive letters.
        return fileURLToPath(stringPath);
    }
    return fixWindowsPath(stringPath);
}

export function fixWindowsPath(filePath: string): string {
    // Fix Windows paths that might start with a leading slash
    if (process.platform === 'win32') {
        // Remove leading slash before drive letter on Windows
        if (/^[/\\][A-Za-z]:/.test(filePath)) {
            return filePath.substring(1);
        }
    }
    return filePath;
}
