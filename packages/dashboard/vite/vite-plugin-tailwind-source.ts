import path from 'node:path';
import { Plugin } from 'vite';

import { CompileResult } from './utils/compiler.js';
import { getDashboardPaths } from './utils/get-dashboard-paths.js';
import { ConfigLoaderApi, getConfigLoaderApi } from './vite-plugin-config-loader.js';
import { fixWindowsPath } from './vite-plugin-vendure-dashboard.js';

/**
 * Resolve the absolute path to the `@vendure-io/ui` source directory.
 * This is needed because Tailwind CSS v4 excludes `node_modules` from
 * its default filesystem scan, and @vendure-io/ui ships raw `.tsx` source
 * files whose class names must be included in the generated CSS.
 */
function resolveVendureUiSourcePath(): string | undefined {
    try {
        const resolved = import.meta.resolve('@vendure-io/ui/components/ui/button');
        const filePath = resolved.startsWith('file:') ? fixWindowsPath(new URL(resolved).pathname) : resolved;
        return path.resolve(filePath, '../../../');
    } catch (error) {
        // eslint-disable-next-line no-console
        console.warn(
            '[@vendure/dashboard] Could not resolve @vendure-io/ui source path. ' +
                'Tailwind CSS classes from @vendure-io/ui may be missing.',
            error,
        );
        return undefined;
    }
}

export interface DashboardTailwindSourcePluginOptions {
    /**
     * Absolute path to the dashboard package root. Required when
     * `useExperimentalBundle` is enabled (so we can resolve the bundled
     * JS path for Tailwind's `@source` scan).
     */
    packageRoot?: string;
    /**
     * When true, also emit a `@source` directive pointing at the dashboard's
     * pre-built JS bundle so Tailwind picks up the dashboard's own utility
     * classes (which are otherwise invisible to consumer-side scanning since
     * the bundle lives in node_modules).
     */
    useExperimentalBundle?: boolean;
}

/**
 * This Vite plugin transforms the `app/styles.css` file to include a `@source` directive
 * for each dashboard extension's source directory. This allows Tailwind CSS to
 * include styles from these extensions when processing the CSS.
 */
export function dashboardTailwindSourcePlugin(
    options: DashboardTailwindSourcePluginOptions = {},
): Plugin {
    const { packageRoot, useExperimentalBundle } = options;
    let configLoaderApi: ConfigLoaderApi;
    let loadVendureConfigResult: CompileResult;
    return {
        name: 'vendure:dashboard-tailwind-source',
        // Ensure this plugin runs before Tailwind CSS processing
        enforce: 'pre',
        configResolved({ plugins }) {
            configLoaderApi = getConfigLoaderApi(plugins);
        },
        async transform(src, id) {
            const isMainStyles = /app\/styles.css$/.test(id);
            const isExtensionStyles = /app\/extension-tailwind.css$/.test(id);
            if (isMainStyles || isExtensionStyles) {
                if (!loadVendureConfigResult) {
                    loadVendureConfigResult = await configLoaderApi.getVendureConfig();
                }
                const { pluginInfo } = loadVendureConfigResult;
                const dashboardExtensionDirs = getDashboardPaths(pluginInfo);

                const vendureUiSrcPath = resolveVendureUiSourcePath();
                if (vendureUiSrcPath) {
                    dashboardExtensionDirs.push(vendureUiSrcPath);
                }

                if (isExtensionStyles && useExperimentalBundle && packageRoot) {
                    // In bundle mode the dashboard's own utility classes live
                    // inside the published JS chunks rather than the readable
                    // src files. Point Tailwind at the bundle so those classes
                    // are also generated.
                    dashboardExtensionDirs.push(
                        path.join(packageRoot, 'dist/bundle'),
                    );
                }

                const sources = dashboardExtensionDirs
                    .map(extension => {
                        return `@source '${extension}';`;
                    })
                    .join('\n');

                // Find the line with the specific comment and insert sources after it
                const lines = src.split('\n');
                const sourceCommentIndex = lines.findIndex(line =>
                    line.includes(
                        '/* @source rules from extensions will be added here by the dashboardTailwindSourcePlugin */',
                    ),
                );

                if (sourceCommentIndex !== -1) {
                    // Insert the sources after the comment line
                    lines.splice(sourceCommentIndex + 1, 0, sources);
                    const modifiedSrc = lines.join('\n');
                    return {
                        code: modifiedSrc,
                    };
                }

                // If the comment is not found, append sources at the end
                return {
                    code: src + '\n' + sources,
                };
            }
        },
    };
}
