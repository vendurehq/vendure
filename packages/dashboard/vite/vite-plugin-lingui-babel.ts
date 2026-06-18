import * as babel from '@babel/core';
import { createRequire } from 'node:module';
import type { Plugin } from 'vite';

import { CompileResult } from './utils/compiler.js';
import { ConfigLoaderApi, getConfigLoaderApi } from './vite-plugin-config-loader.js';

const require = createRequire(import.meta.url);

/**
 * Options for the linguiBabelPlugin.
 */
export interface LinguiBabelPluginOptions {
    /**
     * For testing: manually specify package paths that should have Lingui macros transformed.
     * In production, these are automatically discovered from the VendureConfig plugins.
     */
    additionalPackagePaths?: string[];
}

/**
 * @description
 * A custom Vite plugin that transforms Lingui macros in files using Babel instead of SWC.
 *
 * This plugin solves a critical compatibility issue with SWC plugins:
 * - SWC plugins are compiled Wasm binaries that require exact version matching with `@swc/core`
 * - When users have different SWC versions in their projects (e.g., from Next.js, Nx, etc.),
 *   the Lingui SWC plugin fails with "failed to invoke plugin" errors
 * - Babel has no such binary compatibility issues, making it much more reliable for library code
 *
 * The plugin runs BEFORE `@vitejs/plugin-react` and transforms files containing Lingui macros
 * (imports from `@lingui/core/macro` or `@lingui/react/macro`) using the Babel-based
 * `@lingui/babel-plugin-lingui-macro`.
 *
 * Files processed:
 * - `@vendure/dashboard/src` files (in node_modules for external projects)
 * - `packages/dashboard/src` files (in monorepo development)
 * - User's dashboard extension files (e.g., custom plugins using Lingui)
 * - Third-party npm packages that provide dashboard extensions (discovered automatically)
 *
 * Files NOT processed:
 * - Files that don't contain Lingui macro imports (fast check via string matching)
 * - Non-JS/TS files
 * - node_modules packages that are not discovered as Vendure plugins
 *
 * @see https://github.com/vendurehq/vendure/issues/3929
 * @see https://github.com/lingui/swc-plugin/issues/179
 */
export function linguiBabelPlugin(options?: LinguiBabelPluginOptions): Plugin {
    // Paths of npm packages that should have Lingui macros transformed.
    // This is populated from plugin discovery when transform is first called.
    const allowedNodeModulesPackages = new Set<string>(options?.additionalPackagePaths ?? []);

    // API reference to the config loader plugin (set in configResolved)
    let configLoaderApi: ConfigLoaderApi | undefined;
    // Cached result from config loader (set on first transform that needs it)
    let configResult: CompileResult | undefined;

    return {
        name: 'vendure:lingui-babel',
        // Run BEFORE @vitejs/plugin-react so the macros are already transformed
        // when the react plugin processes the file
        enforce: 'pre',

        configResolved({ plugins }) {
            // Get reference to the config loader API.
            // This doesn't load the config yet - that happens lazily in transform.
            try {
                configLoaderApi = getConfigLoaderApi(plugins);
            } catch {
                // configLoaderPlugin not available (e.g., plugin used standalone for testing)
            }
        },

        async transform(code, id) {
            // Strip query params for path matching (Vite adds ?v=xxx for cache busting)
            const cleanId = id.split('?')[0];

            // Only process TypeScript/JavaScript files
            if (!/\.[tj]sx?$/.test(cleanId)) {
                return null;
            }

            // Only process files that actually contain Lingui macro imports
            // This is a fast check to avoid running Babel on files that don't need it
            if (!code.includes('@lingui/') || !code.includes('/macro')) {
                return null;
            }

            // Check if this file should be transformed
            if (cleanId.includes('node_modules')) {
                // Always allow @vendure/dashboard source files
                const isVendureDashboard =
                    cleanId.includes('@vendure/dashboard/src') || cleanId.includes('packages/dashboard/src');

                if (!isVendureDashboard) {
                    // Load discovered plugins on first need (lazy loading with caching)
                    if (configLoaderApi && !configResult) {
                        try {
                            configResult = await configLoaderApi.getVendureConfig();
                            // Extract package paths from discovered npm plugins
                            for (const plugin of configResult.pluginInfo) {
                                if (!plugin.sourcePluginPath && plugin.pluginPath.includes('node_modules')) {
                                    const packagePath = extractPackagePath(plugin.pluginPath);
                                    if (packagePath) {
                                        allowedNodeModulesPackages.add(packagePath);
                                    }
                                }
                            }
                        } catch (error) {
                            // Log but continue - will use only manually specified paths
                            // eslint-disable-next-line no-console
                            console.warn('[vendure:lingui-babel] Failed to load plugin config:', error);
                        }
                    }

                    // Check if this is from a discovered Vendure plugin package
                    let isDiscoveredPlugin = false;
                    for (const pkgPath of allowedNodeModulesPackages) {
                        if (cleanId.includes(pkgPath)) {
                            isDiscoveredPlugin = true;
                            break;
                        }
                    }

                    if (!isDiscoveredPlugin) {
                        return null;
                    }
                }
            }

            try {
                const result = await babel.transformAsync(code, {
                    filename: id,
                    presets: [
                        [require.resolve('@babel/preset-typescript'), { isTSX: true, allExtensions: true }],
                    ],
                    plugins: [require.resolve('@lingui/babel-plugin-lingui-macro')],
                    sourceMaps: true,
                    // Don't look for babel config files - we want to control the config completely
                    configFile: false,
                    babelrc: false,
                });

                if (!result?.code) {
                    return null;
                }

                return {
                    code: result.code,
                    map: result.map,
                };
            } catch (error) {
                // Log the error but don't crash - let the build continue
                // The lingui vite plugin will catch untransformed macros later
                // eslint-disable-next-line no-console
                console.error(`[vendure:lingui-babel] Failed to transform ${id}:`, error);
                return null;
            }
        },
    };
}

/**
 * Extracts the npm package name from a full file path.
 *
 * Examples:
 * - /path/to/node_modules/@vendure-ee/plugin/dist/index.js -> @vendure-ee/plugin
 * - /path/to/node_modules/some-plugin/lib/index.js -> some-plugin
 * - /path/to/node_modules/.pnpm/@vendure-ee+plugin@1.0.0/node_modules/@vendure-ee/plugin/dist/index.js -> @vendure-ee/plugin
 */
function extractPackagePath(filePath: string): string | undefined {
    // Normalize path separators
    const normalizedPath = filePath.replace(/\\/g, '/');

    // Find the last occurrence of node_modules (handles pnpm structure)
    const lastNodeModulesIndex = normalizedPath.lastIndexOf('node_modules/');
    if (lastNodeModulesIndex === -1) {
        return undefined;
    }

    const afterNodeModules = normalizedPath.slice(lastNodeModulesIndex + 'node_modules/'.length);

    // Handle scoped packages (@scope/package)
    if (afterNodeModules.startsWith('@')) {
        const parts = afterNodeModules.split('/');
        if (parts.length >= 2) {
            return `${parts[0]}/${parts[1]}`;
        }
    } else {
        // Unscoped package
        const parts = afterNodeModules.split('/');
        if (parts.length >= 1) {
            return parts[0];
        }
    }

    return undefined;
}
