import rolldownBabel from '@rolldown/plugin-babel';
import { createRequire } from 'node:module';
import type { Plugin } from 'vite';

import { CompileResult } from './utils/compiler.js';
import { filterActivePluginInfo } from './utils/get-active-plugin-info.js';
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
    /**
     * Run Babel in worker threads (passed to `@rolldown/plugin-babel`'s `parallel` option).
     * `true` uses one worker per CPU core, up to 4. The workers are only started once the
     * first file containing Lingui macros is transformed.
     *
     * By default the workers are used for `vite build` only. A build stops them when it
     * finishes; a dev server would keep them (about 270 MB) for its whole lifetime, to save
     * about 0.4 s on the first page load.
     *
     * @default true for `vite build`, false for the dev server
     */
    parallel?: boolean | number;
}

/**
 * Matches the Lingui macro entry points: `@lingui/core/macro`, `@lingui/react/macro`
 * and the legacy `@lingui/macro`. Used as the transform hook's code filter: Rolldown applies it
 * in builds and Vite's plugin container applies it in dev, so the transform handler is skipped
 * for modules that don't import a macro.
 */
const LINGUI_MACRO_IMPORT = /@lingui\/(?:[a-z]+\/)?macro/;

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
 * The Babel pass is run by `@rolldown/plugin-babel`, which can spread the work over worker
 * threads. The plugin runs BEFORE `@vitejs/plugin-react` and only parses the TypeScript/JSX
 * syntax: stripping types is left to Vite's own (Oxc) transform.
 *
 * Files processed:
 * - `@vendure/dashboard/src` files (in node_modules for external projects)
 * - `packages/dashboard/src` files (in monorepo development)
 * - User's dashboard extension files (e.g., custom plugins using Lingui)
 * - Third-party npm packages that provide dashboard extensions (discovered automatically)
 *
 * Files NOT processed:
 * - Files that don't contain Lingui macro imports (skipped by the transform hook's code filter)
 * - Non-JS/TS files
 * - node_modules packages that are not discovered as Vendure plugins
 *
 * `@rolldown/plugin-babel` sends its `include`/`exclude` options to the worker threads, so they
 * cannot be functions. The node_modules allowlist, which needs the (async) plugin discovery
 * result, is therefore checked here in the main thread before the file is handed to Babel.
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
    // Cached discovery of the allowed npm packages (started on first transform that needs it)
    let discoveredPackages: Promise<void> | undefined;

    const discoverPluginPackages = async () => {
        if (!configLoaderApi) {
            return;
        }
        try {
            const configResult: CompileResult = await configLoaderApi.getVendureConfig();
            // Extract package paths from discovered npm plugins,
            // restricted to plugins active in the runtime config.
            const activePluginInfo = filterActivePluginInfo(
                configResult.pluginInfo,
                configResult.vendureConfig,
            );
            for (const plugin of activePluginInfo) {
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
    };

    // The hook filter (see configResolved) has already limited `id` to JS/TS modules that
    // import a Lingui macro, so only the node_modules allowlist is left to check here.
    const shouldTransform = async (id: string): Promise<boolean> => {
        // Strip query params for path matching (Vite adds ?v=xxx for cache busting)
        const cleanId = id.split('?')[0];

        if (!cleanId.includes('node_modules')) {
            return true;
        }

        // Always allow @vendure/dashboard source files
        if (cleanId.includes('@vendure/dashboard/src') || cleanId.includes('packages/dashboard/src')) {
            return true;
        }

        // Load discovered plugins on first need (lazy loading with caching)
        discoveredPackages ??= discoverPluginPackages();
        await discoveredPackages;

        // Check if this is from a discovered Vendure plugin package
        for (const pkgPath of allowedNodeModulesPackages) {
            if (cleanId.includes(pkgPath)) {
                return true;
            }
        }
        return false;
    };

    // The @rolldown/plugin-babel instance that runs Babel. It is created in the `config` hook,
    // where the command (build or serve) is known, and the hooks below delegate to it.
    let babelPlugin: Plugin | undefined;
    const transform: Extract<Plugin['transform'], { handler: unknown }> = {
        async handler(code, id, meta) {
            if (!babelPlugin || !(await shouldTransform(id))) {
                return null;
            }
            return callHook(babelPlugin.transform, this, code, id, meta);
        },
    };

    return {
        name: 'vendure:lingui-babel',
        // Run BEFORE @vitejs/plugin-react so the macros are already transformed
        // when the react plugin processes the file
        enforce: 'pre',

        async config(config, env) {
            // Safe when one instance serves several servers (Vitest projects with `extends: true`):
            // each call builds an equivalent plugin, whose state is keyed by environment name.
            // Plugins are referenced by module path so that the options can be sent to worker threads.
            babelPlugin = (await rolldownBabel({
                plugins: [require.resolve('@lingui/babel-plugin-lingui-macro')],
                parallel: options?.parallel ?? env.command === 'build',
                // The default `exclude` skips everything in node_modules. The node_modules allowlist
                // is applied in `shouldTransform` instead, so only Rolldown's runtime helper is
                // excluded here. Babel evaluates this option too, inside the workers, so it must be
                // cloneable (no functions).
                exclude: [/^\0rolldown\/runtime\.js$/],
                // @rolldown/plugin-babel only enables the TypeScript parser for .ts and .tsx files;
                // .mts and .cts files are TypeScript too (without JSX).
                overrides: [{ include: /\.[cm]ts(?:$|\?)/, parserOpts: { plugins: ['typescript'] } }],
            })) as unknown as Plugin;
            return callHook(babelPlugin.config, this, config, env);
        },

        configResolved(config) {
            // Lets @rolldown/plugin-babel resolve its options and compute its hook filter.
            callHook(babelPlugin?.configResolved, this, config);
            // Narrow the hook filter to files that import a Lingui macro. Rolldown (build) and
            // Vite's plugin container (dev) skip the handler for modules whose code doesn't match.
            const babelTransform = babelPlugin?.transform as typeof transform | undefined;
            transform.filter = {
                ...babelTransform?.filter,
                code: LINGUI_MACRO_IMPORT,
            };
            // Get reference to the config loader API.
            // This doesn't load the config yet - that happens lazily in transform.
            try {
                configLoaderApi = getConfigLoaderApi(config.plugins);
            } catch {
                // configLoaderPlugin not available (e.g., plugin used standalone for testing)
            }
        },

        applyToEnvironment(environment) {
            return callHook(babelPlugin?.applyToEnvironment, this, environment) ?? true;
        },

        transform,

        closeBundle(...args) {
            return callHook(babelPlugin?.closeBundle, this, ...args);
        },

        closeWatcher() {
            return callHook(babelPlugin?.closeWatcher, this);
        },
    };
}

/**
 * Calls a plugin hook that may be given as a function or as an object with a `handler`.
 */
function callHook(hook: unknown, context: unknown, ...args: unknown[]): any {
    if (typeof hook === 'function') {
        return hook.apply(context, args);
    }
    if (hook && typeof hook === 'object' && 'handler' in hook && typeof hook.handler === 'function') {
        return hook.handler.apply(context, args);
    }
    return undefined;
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
