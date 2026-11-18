import {
    createCompilationErrorMessage,
    createCompiledCatalog,
    getCatalogForFile,
    getCatalogs,
} from '@lingui/cli/api';
import { getConfig, LinguiConfigNormalized } from '@lingui/conf';
import glob from 'fast-glob';
import * as path from 'node:path';
import type { Plugin } from 'vite';

import { PluginInfo } from './types.js';
import { CompileResult } from './utils/compiler.js';
import { filterActivePluginInfo } from './utils/get-active-plugin-info.js';
import { getDashboardPaths } from './utils/get-dashboard-paths.js';
import { ConfigLoaderApi, getConfigLoaderApi } from './vite-plugin-config-loader.js';

type Catalog = Awaited<ReturnType<typeof getCatalogs>>[number];

export interface TranslationsPluginOptions {
    packageRoot: string;
}

type PluginTranslation = {
    pluginRootPath: string;
    translations: string[];
};

const virtualModuleId = 'virtual:plugin-translations';
const resolvedVirtualModuleId = `\0${virtualModuleId}`;

/**
 * @description
 * Serves the `virtual:plugin-translations` module, which holds the compiled translations of the
 * active plugins' dashboard extensions (their `.po` files). `loadI18nMessages` merges them with
 * the dashboard's own catalogs, which are compiled into the dashboard (the bundle, or in source
 * mode the `.po` files in `src/i18n/locales`), so this plugin never reads those.
 *
 * @param options
 */
export function translationsPlugin(options: TranslationsPluginOptions): Plugin {
    let configLoaderApi: ConfigLoaderApi;
    let loadVendureConfigResult: CompileResult;

    return {
        name: 'vendure:compile-translations',
        configResolved({ plugins }) {
            configLoaderApi = getConfigLoaderApi(plugins);
        },
        resolveId(id) {
            if (id === virtualModuleId) {
                return resolvedVirtualModuleId;
            }
        },
        async load(id) {
            if (id === resolvedVirtualModuleId) {
                this.debug('Loading plugin translations...');

                if (!loadVendureConfigResult) {
                    loadVendureConfigResult = await configLoaderApi.getVendureConfig();
                }

                const { pluginInfo, vendureConfig } = loadVendureConfigResult;
                const activePluginInfo = filterActivePluginInfo(pluginInfo, vendureConfig);
                const pluginTranslations = await getPluginTranslations(activePluginInfo);
                const linguiConfig = getConfig({
                    configPath: path.join(options.packageRoot, 'lingui.config.js'),
                });
                const catalogs = await getLinguiCatalogs(linguiConfig, pluginTranslations);

                const pluginFiles = pluginTranslations.flatMap(translation => translation.translations);

                const mergedMessageMap = await createMergedMessageMap({
                    files: pluginFiles,
                    packageRoot: options.packageRoot,
                    catalogs,
                    sourceLocale: linguiConfig.sourceLocale,
                });
                return `
                    const translations = {
                        ${[...mergedMessageMap.entries()]
                            .map(([locale, messages]) => {
                                const safeLocale = locale.replace(/-/g, '_');
                                // `@lingui/core` interpolates compiled token arrays, not ICU source
                                // strings. It registers a runtime compiler of its own only when
                                // `NODE_ENV !== 'production'`, so an uncompiled catalog here renders
                                // literally in a built dashboard: `Hello {name}` instead of `Hello Bob`.
                                const { source, errors } = createCompiledCatalog(locale, messages, {
                                    namespace: 'json',
                                    pseudoLocale: linguiConfig.pseudoLocale,
                                });
                                if (errors.length) {
                                    this.error(createCompilationErrorMessage(locale, errors));
                                }
                                const { messages: compiledMessages } = JSON.parse(source) as {
                                    messages: Record<string, unknown>;
                                };
                                return `${safeLocale}: ${JSON.stringify(compiledMessages)}`;
                            })
                            .join(',\n')}
                    };
                    export default translations;
                `;
            }
        },
    };
}

async function getPluginTranslations(pluginInfo: PluginInfo[]): Promise<PluginTranslation[]> {
    const dashboardPaths = getDashboardPaths(pluginInfo);
    const pluginTranslations: PluginTranslation[] = [];
    for (const dashboardPath of dashboardPaths) {
        const poPatterns = path.join(dashboardPath, '**/*.po').replace(/\\/g, '/');
        const translations = await glob(poPatterns, {
            ignore: [
                // Skip nested node_modules (transitive deps) but not .pnpm or .bun directories.
                '**/node_modules/[!.]*/**/node_modules/**',
                '**/*.spec.js',
                '**/*.test.js',
            ],
            onlyFiles: true,
            absolute: true,
            followSymbolicLinks: false,
            stats: false,
        });
        pluginTranslations.push({
            pluginRootPath: dashboardPath,
            translations,
        });
    }
    return pluginTranslations;
}

async function getLinguiCatalogs(
    linguiConfig: LinguiConfigNormalized,
    pluginTranslations: PluginTranslation[],
) {
    for (const pluginTranslation of pluginTranslations) {
        if (pluginTranslation.translations.length === 0) {
            continue;
        }
        linguiConfig.catalogs?.push({
            path: pluginTranslation.translations[0]?.replace(/[a-z_-]+\.po$/, '{locale}') ?? '',
            include: [],
        });
    }
    return getCatalogs(linguiConfig);
}

async function createMergedMessageMap({
    files,
    packageRoot,
    catalogs,
    sourceLocale,
}: {
    files: string[];
    packageRoot: string;
    catalogs: Catalog[];
    sourceLocale?: string;
}): Promise<Map<string, Record<string, string>>> {
    const mergedMessageMap = new Map<string, Record<string, string>>();

    for (const file of files) {
        const catalogRelativePath = path.relative(packageRoot, file);
        const fileCatalog = getCatalogForFile(catalogRelativePath, catalogs);

        const { locale, catalog } = fileCatalog;

        const { messages } = await catalog.getTranslations(locale, {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            fallbackLocales: { default: sourceLocale! },
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            sourceLocale: sourceLocale!,
        });

        const mergedMessages = mergedMessageMap.get(locale) ?? {};
        mergedMessageMap.set(locale, { ...mergedMessages, ...messages });
    }

    return mergedMessageMap;
}
