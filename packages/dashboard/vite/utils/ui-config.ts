import {
    ADMIN_API_PATH,
    DEFAULT_AUTH_TOKEN_HEADER_KEY,
    DEFAULT_CHANNEL_TOKEN_KEY,
} from '@vendure/common/lib/shared-constants';
import type { VendureConfig } from '@vendure/core';

import {
    defaultAvailableLanguages,
    defaultAvailableLocales,
    defaultLanguage,
    defaultLocale,
} from '../constants.js';
import { ResolvedUiConfig, UiConfigPluginOptions } from '../vite-plugin-ui-config.js';

export function getUiConfig(
    config: VendureConfig,
    pluginOptions: UiConfigPluginOptions,
): Omit<ResolvedUiConfig, 'version'> {
    const { authOptions, apiOptions } = config;

    const serverTokenMethod = authOptions.tokenMethod;
    const serverUsesBearer =
        serverTokenMethod === 'bearer' ||
        (Array.isArray(serverTokenMethod) && serverTokenMethod.includes('bearer'));

    // Merge API configuration with defaults
    const api = {
        adminApiPath: pluginOptions.api?.adminApiPath ?? apiOptions.adminApiPath ?? ADMIN_API_PATH,
        host: pluginOptions.api?.host ?? 'auto',
        port: pluginOptions.api?.port ?? 'auto',
        tokenMethod: pluginOptions.api?.tokenMethod ?? (serverUsesBearer ? 'bearer' : 'cookie'),
        authTokenHeaderKey:
            pluginOptions.api?.authTokenHeaderKey ??
            authOptions.authTokenHeaderKey ??
            DEFAULT_AUTH_TOKEN_HEADER_KEY,
        channelTokenKey:
            pluginOptions.api?.channelTokenKey ?? apiOptions.channelTokenKey ?? DEFAULT_CHANNEL_TOKEN_KEY,
    };

    // Merge i18n configuration with defaults
    const i18n = {
        defaultLanguage: pluginOptions.i18n?.defaultLanguage ?? defaultLanguage,
        defaultLocale: pluginOptions.i18n?.defaultLocale ?? defaultLocale,
        availableLanguages:
            pluginOptions.i18n?.availableLanguages && pluginOptions.i18n.availableLanguages.length > 0
                ? pluginOptions.i18n.availableLanguages
                : defaultAvailableLanguages,
        availableLocales:
            pluginOptions.i18n?.availableLocales && pluginOptions.i18n.availableLocales.length > 0
                ? pluginOptions.i18n.availableLocales
                : defaultAvailableLocales,
    };

    // Merge orders configuration with defaults
    // Default labels are identifiers that get translated via getTranslatedRefundReason()
    const orders = {
        refundReasons:
            pluginOptions.orders?.refundReasons && pluginOptions.orders.refundReasons.length > 0
                ? pluginOptions.orders.refundReasons
                : [
                      { value: 'customer-request', label: 'CustomerRequest' },
                      { value: 'not-available', label: 'NotAvailable' },
                      { value: 'damaged-shipping', label: 'DamagedInShipping' },
                      { value: 'wrong-item', label: 'WrongItem' },
                      { value: 'other', label: 'Other' },
                  ],
    };

    return {
        api,
        i18n,
        orders,
    };
}
