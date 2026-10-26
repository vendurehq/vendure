import { pathToFileURL } from 'node:url';
import path from 'path';
import { normalizePath, Plugin } from 'vite';

import { CompileResult } from './utils/compiler.js';
import { filterActivePluginInfo } from './utils/get-active-plugin-info.js';
import { ConfigLoaderApi, getConfigLoaderApi } from './vite-plugin-config-loader.js';

const virtualModuleId = 'virtual:dashboard-extensions';
const resolvedVirtualModuleId = `\0${virtualModuleId}`;

/**
 * This Vite plugin scans the configured plugins for any dashboard extensions and dynamically
 * generates an import statement for each one, wrapped up in a `runDashboardExtensions()`
 * function which can then be imported and executed in the Dashboard app.
 */
export function dashboardMetadataPlugin(): Plugin {
    let configLoaderApi: ConfigLoaderApi;
    let loadVendureConfigResult: CompileResult;
    return {
        name: 'vendure:dashboard-extensions-metadata',
        configResolved({ plugins }) {
            configLoaderApi = getConfigLoaderApi(plugins);
        },
        configureServer(server) {
            // Extensions load via dynamic `import()`, which Vite's cold-start crawl
            // skips, so their deps would otherwise be found after the app boots.
            // Wait for `listening`: the config loads in `buildStart`, before the deps
            // optimizer is initialized. Not applied in middleware mode (no httpServer).
            server.httpServer?.once('listening', () => {
                void configLoaderApi.getVendureConfig().then(result => {
                    if (!result) {
                        return;
                    }
                    for (const extension of getExtensionEntryPaths(result)) {
                        void server.environments.client.warmupRequest(
                            fileToServerUrl(extension, server.config.root),
                        );
                    }
                });
            });
        },
        resolveId(id) {
            if (id === virtualModuleId) {
                return resolvedVirtualModuleId;
            }
        },
        async load(id) {
            if (id === resolvedVirtualModuleId) {
                const startTime = Date.now();
                this.debug('Loading dashboard extensions...');

                if (!loadVendureConfigResult) {
                    const configStart = Date.now();
                    loadVendureConfigResult = await configLoaderApi.getVendureConfig();
                    this.debug(`Loaded Vendure config in ${Date.now() - configStart}ms`);
                }

                const resolveStart = Date.now();
                const pluginsWithExtensions = getExtensionEntryPaths(loadVendureConfigResult);
                pluginsWithExtensions.forEach(resolved => this.debug(`Resolved extension path: ${resolved}`));

                this.info(
                    `Found ${pluginsWithExtensions.length} Dashboard extensions in ${Date.now() - resolveStart}ms`,
                );
                this.debug(`Total dashboard extension loading completed in ${Date.now() - startTime}ms`);

                return `
                    export async function runDashboardExtensions() {
                        ${pluginsWithExtensions
                            .map(extension => {
                                return `await import(\`${pathToFileURL(extension).toString()}\`);`;
                            })
                            .join('\n')}
                }`;
            }
        },
    };
}

/**
 * Returns the absolute paths of the dashboard extension entry files of all
 * plugins that are active in the Vendure config.
 */
function getExtensionEntryPaths({ pluginInfo, vendureConfig }: CompileResult): string[] {
    return (
        filterActivePluginInfo(pluginInfo, vendureConfig)
            ?.map(({ dashboardEntryPath, pluginPath, sourcePluginPath }) => {
                if (!dashboardEntryPath) {
                    return null;
                }
                // For local plugins, use the sourcePluginPath to resolve the dashboard extension
                const basePath = sourcePluginPath ? path.dirname(sourcePluginPath) : path.dirname(pluginPath);
                return path.resolve(basePath, dashboardEntryPath);
            })
            .filter(x => x != null) ?? []
    );
}

/**
 * Converts an absolute file path to the URL the Vite dev server serves it at:
 * root-relative inside the root, `/@fs/` otherwise.
 */
function fileToServerUrl(file: string, root: string): string {
    const relative = path.relative(root, file);
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
        return `/${normalizePath(relative)}`;
    }
    const normalized = normalizePath(file);
    return `/@fs${normalized.startsWith('/') ? '' : '/'}${normalized}`;
}
