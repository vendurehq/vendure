import { Plugin } from 'vite';

import { compile, CompileResult, CompilerOptions } from './utils/compiler.js';
import { filterActivePluginInfo } from './utils/get-active-plugin-info.js';
import { debugLogger } from './utils/logger.js';

export interface ConfigLoaderApi {
    getVendureConfig(): Promise<CompileResult>;
}

export const configLoaderName = 'vendure:config-loader';

/**
 * This Vite plugin loads the VendureConfig from the specified file path, and
 * makes it available to other plugins via the `ConfigLoaderApi`.
 */
export function configLoaderPlugin(options: CompilerOptions): Plugin {
    let result: CompileResult;
    let loadConfigPromise: Promise<CompileResult> | undefined;
    const onConfigLoaded: Array<() => void> = [];
    return {
        name: configLoaderName,
        async buildStart() {
            this.info(
                `Loading Vendure config. This can take a short while depending on the size of your project...`,
            );
            try {
                const startTime = Date.now();
                loadConfigPromise ??= compile({
                    ...options,
                    logger: process.env.LOG
                        ? debugLogger
                        : {
                              info: (message: string) => this.info(message),
                              warn: (message: string) => this.warn(message),
                              debug: (message: string) => this.debug(message),
                              error: (message: string) => this.error(message),
                          },
                }).finally(() => {
                    loadConfigPromise = undefined;
                });
                result = await loadConfigPromise;
                const endTime = Date.now();
                const duration = endTime - startTime;
                const activeNames = new Set(
                    filterActivePluginInfo(result.pluginInfo, result.vendureConfig).map(p => p.name),
                );
                const pluginNames = result.pluginInfo
                    .map(p => {
                        const source = p.sourcePluginPath ? '(local)' : '(npm)';
                        const inactive = activeNames.has(p.name) ? '' : ' (inactive)';
                        return `${p.name} ${source}${inactive}`;
                    })
                    .join(', ');
                this.info(
                    `Found ${result.pluginInfo.length} plugins (${activeNames.size} active in runtime config): ${pluginNames}`,
                );
                this.info(
                    `Vendure config loaded (using export "${result.exportedSymbolName}") in ${duration}ms`,
                );
            } catch (e: unknown) {
                if (e instanceof Error) {
                    const message = [
                        e.message,
                        `If you are using a monorepo, you may need to provide a custom pathAdapter to resolve the paths correctly.`,
                    ].join('\n');
                    this.error(`Error loading Vendure config: ${message}`);
                }
            }
            onConfigLoaded.forEach(fn => fn());
        },
        api: {
            getVendureConfig(): Promise<CompileResult> {
                if (result) {
                    return Promise.resolve(result);
                } else {
                    return new Promise<CompileResult>(resolve => {
                        onConfigLoaded.push(() => {
                            resolve(result);
                        });
                    });
                }
            },
        } satisfies ConfigLoaderApi,
    };
}

/**
 * Inter-plugin dependencies implemented following the pattern given here:
 * https://rollupjs.org/plugin-development/#direct-plugin-communication
 */
export function getConfigLoaderApi(plugins: readonly Plugin[]): ConfigLoaderApi {
    const parentPlugin = plugins.find(plugin => plugin.name === configLoaderName);
    if (!parentPlugin) {
        throw new Error(`This plugin depends on the "${configLoaderName}" plugin.`);
    }
    return parentPlugin.api as ConfigLoaderApi;
}
