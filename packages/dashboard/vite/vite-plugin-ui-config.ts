import { LanguageCode } from '@vendure/common/lib/generated-types';
import type { VendureConfig } from '@vendure/core';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { Plugin } from 'vite';

import { getUiConfig } from './utils/ui-config.js';
import { ConfigLoaderApi, getConfigLoaderApi } from './vite-plugin-config-loader.js';

const virtualModuleId = 'virtual:vendure-ui-config';
const resolvedVirtualModuleId = `\0${virtualModuleId}`;

/**
 * @description
 * Options used by the {@link vendureDashboardPlugin} to configure how the Dashboard
 * connects to the Vendure Admin API
 *
 * @docsCategory vite-plugin
 * @docsPage vendureDashboardPlugin
 * @since 3.4.0
 */
export interface ApiConfig {
    /**
     * @description
     * The hostname of the Vendure server which the admin UI will be making API calls
     * to. If set to "auto", the Admin UI app will determine the hostname from the
     * current location (i.e. `window.location.hostname`).
     *
     * @default 'auto'
     */
    host?: string | 'auto';
    /**
     * @description
     * The port of the Vendure server which the admin UI will be making API calls
     * to. If set to "auto", the Admin UI app will determine the port from the
     * current location (i.e. `window.location.port`).
     *
     * @default 'auto'
     */
    port?: number | 'auto';
    /**
     * @description
     * The path to the GraphQL Admin API.
     *
     * @default 'admin-api'
     */
    adminApiPath?: string;
    /**
     * @description
     * Whether to use cookies or bearer tokens to track sessions.
     * Should match the setting of in the server's `tokenMethod` config
     * option.
     *
     * @default 'cookie'
     */
    tokenMethod?: 'cookie' | 'bearer';
    /**
     * @description
     * The header used when using the 'bearer' auth method. Should match the
     * setting of the server's `authOptions.authTokenHeaderKey` config option.
     *
     * @default 'vendure-auth-token'
     */
    authTokenHeaderKey?: string;
    /**
     * @description
     * The name of the header which contains the channel token. Should match the
     * setting of the server's `apiOptions.channelTokenKey` config option.
     *
     * @default 'vendure-token'
     */
    channelTokenKey?: string;
}

/**
 * @description
 * Options used by the {@link vendureDashboardPlugin} to configure aspects of the
 * Dashboard UI behaviour.
 *
 * @docsCategory vite-plugin
 * @docsPage vendureDashboardPlugin
 * @since 3.4.0
 */
export interface I18nConfig {
    /**
     * @description
     * The default language for the Admin UI. Must be one of the
     * items specified in the `availableLanguages` property.
     *
     * @default LanguageCode.en
     */
    defaultLanguage?: LanguageCode;
    /**
     * @description
     * The default locale for the Admin UI. The locale affects the formatting of
     * currencies & dates. Must be one of the items specified
     * in the `availableLocales` property.
     *
     * If not set, the browser default locale will be used.
     *
     * @since 2.2.0
     */
    defaultLocale?: string;
    /**
     * @description
     * An array of languages for which translations exist for the Admin UI.
     */
    availableLanguages?: LanguageCode[];
    /**
     * @description
     * An array of locales to be used on Admin UI.
     *
     * @since 2.2.0
     */
    availableLocales?: string[];
}

/**
 * @description
 * Options used by the {@link vendureDashboardPlugin} to configure order-related
 * Dashboard UI behaviour.
 *
 * @docsCategory vite-plugin
 * @docsPage vendureDashboardPlugin
 * @since 3.4.0
 */
export interface OrdersConfig {
    /**
     * @description
     * An array of refund reasons to display in the refund order dialog.
     * Each reason has a `value` (used as the identifier) and a `label` (displayed to the user).
     * If not provided, default reasons will be used.
     */
    refundReasons?: Array<{ value: string; label: string }>;
}

/**
 * @description
 * Options used by the {@link vendureDashboardPlugin} to configure aspects of the
 * Dashboard UI behaviour.
 *
 * @docsCategory vite-plugin
 * @docsPage vendureDashboardPlugin
 * @since 3.4.0
 */
export interface UiConfigPluginOptions {
    /**
     * @description
     * Configuration for API connection settings
     */
    api?: ApiConfig;
    /**
     * @description
     * Configuration for internationalization settings
     */
    i18n?: I18nConfig;
    /**
     * @description
     * Configuration for order-related settings
     */
    orders?: OrdersConfig;
}

/**
 * @description
 * The resolved UI configuration with all defaults applied.
 * This is the type of the configuration object available at runtime.
 */
export interface ResolvedUiConfig {
    /**
     * @description
     * API connection settings with all defaults applied
     */
    api: Required<ApiConfig>;
    /**
     * @description
     * Internationalization settings with all defaults applied.
     * Note: defaultLocale remains optional as it can be undefined.
     */
    i18n: Required<Omit<I18nConfig, 'defaultLocale'>> & Pick<I18nConfig, 'defaultLocale'>;
    /**
     * @description
     * Order-related settings with all defaults applied
     */
    orders: Required<OrdersConfig>;
    /**
     * @description
     * The version of the @vendure/dashboard package.
     * Note: also declared in src/lib/virtual.d.ts (see TODO there about type sharing).
     */
    version: string;
}

/**
 * Resolves the @vendure/dashboard version from its package.json.
 * Uses Node's module resolution via createRequire so it works regardless
 * of package manager layout (npm, pnpm, yarn PnP).
 */
function readDashboardVersion(root: string): string {
    const rootRequire = createRequire(root.endsWith('/') ? root : `${root}/`);
    try {
        // Resolve the main entry point of @vendure/dashboard, then walk up
        // to find its package.json. This respects Node's module resolution
        // regardless of package manager layout (npm, pnpm, yarn PnP).
        const mainPath = rootRequire.resolve('@vendure/dashboard');
        let dir = dirname(mainPath);
        while (dir !== dirname(dir)) {
            try {
                const pkg = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf-8'));
                if (pkg.name === '@vendure/dashboard') {
                    return pkg.version as string;
                }
            } catch {
                /* no package.json at this level */
            }
            dir = dirname(dir);
        }
    } catch {
        /* module resolution failed */
    }
    return 'unknown';
}

export function uiConfigPlugin(options: UiConfigPluginOptions = {}): Plugin {
    let configLoaderApi: ConfigLoaderApi;
    let vendureConfig: VendureConfig;
    let dashboardVersion: string;

    return {
        name: 'vendure:dashboard-ui-config',
        configResolved(config) {
            configLoaderApi = getConfigLoaderApi(config.plugins);
            dashboardVersion = readDashboardVersion(config.root);
        },
        resolveId(id) {
            if (id === virtualModuleId) {
                return resolvedVirtualModuleId;
            }
        },
        async load(id) {
            if (id === resolvedVirtualModuleId) {
                if (!vendureConfig) {
                    const result = await configLoaderApi.getVendureConfig();
                    vendureConfig = result.vendureConfig;
                }
                const config = getUiConfig(vendureConfig, options);
                return `
                    export const uiConfig = ${JSON.stringify({ ...config, version: dashboardVersion })}
                `;
            }
        },
    };
}
