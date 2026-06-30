import { lingui } from '@lingui/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { PluginOption } from 'vite';

import { PathAdapter } from './types.js';
import { PackageScannerConfig } from './utils/compiler.js';
import { adminApiSchemaPlugin } from './vite-plugin-admin-api-schema.js';
import { configLoaderPlugin } from './vite-plugin-config-loader.js';
import { viteConfigPlugin } from './vite-plugin-config.js';
import { dashboardMetadataPlugin } from './vite-plugin-dashboard-metadata.js';
import { gqlTadaPlugin } from './vite-plugin-gql-tada.js';
import { hmrPlugin } from './vite-plugin-hmr.js';
import { linguiBabelPlugin } from './vite-plugin-lingui-babel.js';
import { dashboardTailwindSourcePlugin } from './vite-plugin-tailwind-source.js';
import { themeVariablesPlugin, ThemeVariablesPluginOptions } from './vite-plugin-theme.js';
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
     *     tempCompilationDir: join(__dirname, './__vendure-dashboard-temp'),
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
        adminApiSchema?: boolean;
        dashboardMetadata?: boolean;
        uiConfig?: boolean;
        gqlTada?: boolean;
        transformIndexHtml?: boolean;
        translations?: boolean;
        hmr?: boolean;
    };
} & UiConfigPluginOptions &
    ThemeVariablesPluginOptions;

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
    const tempDir = options.tempCompilationDir ?? path.join(import.meta.dirname, './.vendure-dashboard-temp');
    const normalizedVendureConfigPath = getNormalizedVendureConfigPath(options.vendureConfigPath);
    const packageRoot = getDashboardPackageRoot();
    const linguiConfigPath = path.join(packageRoot, 'lingui.config.js');
    const disabled = options.disablePlugins ?? {};

    if (process.env.IS_LOCAL_DEV !== 'true') {
        process.env.LINGUI_CONFIG = linguiConfigPath;
    }

    const pluginMap: PluginMapEntry[] = [
        {
            key: 'tanstackRouter',
            plugin: () =>
                tanstackRouter({
                    autoCodeSplitting: true,
                    routeFileIgnorePattern: '.graphql.ts|components|hooks|utils',
                    routesDirectory: path.join(packageRoot, 'src/app/routes'),
                    generatedRouteTree: path.join(packageRoot, 'src/app/routeTree.gen.ts'),
                }),
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
            plugin: () => themeVariablesPlugin({ theme: options.theme }),
        },
        {
            key: 'tailwindSource',
            plugin: () => dashboardTailwindSourcePlugin(),
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
                    outputPath: tempDir,
                    pathAdapter: options.pathAdapter,
                    pluginPackageScanner: options.pluginPackageScanner,
                    module: options.module,
                }),
        },
        {
            key: 'viteConfig',
            plugin: () => viteConfigPlugin({ packageRoot }),
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
            key: 'uiConfig',
            plugin: () => uiConfigPlugin(options),
        },
        {
            key: 'gqlTada',
            plugin: () =>
                options.gqlOutputPath &&
                gqlTadaPlugin({ gqlTadaOutputPath: options.gqlOutputPath, tempDir, packageRoot }),
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
 * Returns the path to the root of the `@vendure/dashboard` package.
 */
function getDashboardPackageRoot(): string {
    const fileUrl = import.meta.resolve('@vendure/dashboard');
    const packagePath = fileUrl.startsWith('file:') ? new URL(fileUrl).pathname : fileUrl;
    return fixWindowsPath(path.join(packagePath, '../../../'));
}

/**
 * Get the normalized path to the Vendure config file given either a string or URL.
 */
export function getNormalizedVendureConfigPath(vendureConfigPath: string | URL): string {
    const stringPath = typeof vendureConfigPath === 'string' ? vendureConfigPath : vendureConfigPath.href;
    if (stringPath.startsWith('file:')) {
        return fixWindowsPath(new URL(stringPath).pathname);
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
