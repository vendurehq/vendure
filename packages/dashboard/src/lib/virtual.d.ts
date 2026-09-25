declare module 'virtual:admin-api-schema' {
    import { SchemaInfo } from '../../vite/vite-plugin-admin-api-schema.js';
    export const schemaInfo: SchemaInfo;
}
declare module 'virtual:dashboard-extensions' {
    export const runDashboardExtensions: () => Promise<void>;
}
declare module 'virtual:plugin-translations' {
    import { Messages } from '@lingui/core';

    // Keyed by locale with `-` replaced by `_`, as emitted by `translationsPlugin`.
    const translations: Record<string, Messages>;
    export default translations;
}

declare module 'virtual:vendure-ui-config' {
    import { LanguageCode } from '@vendure/core';

    // TODO: Find a better way to share types between vite plugin and virtual module declaration
    // Currently we have duplicated type definitions here and in vite-plugin-ui-config.ts
    interface ResolvedApiConfig {
        host: string | 'auto';
        port: number | 'auto';
        adminApiPath: string;
        tokenMethod: 'cookie' | 'bearer';
        authTokenHeaderKey: string;
        channelTokenKey: string;
    }

    interface ResolvedI18nConfig {
        defaultLanguage: LanguageCode;
        defaultLocale: string | undefined;
        availableLanguages: LanguageCode[];
        availableLocales: string[];
    }

    interface ResolvedOrdersConfig {
        refundReasons: Array<{ value: string; label: string }>;
    }

    interface ResolvedUiConfig {
        api: ResolvedApiConfig;
        i18n: ResolvedI18nConfig;
        orders: ResolvedOrdersConfig;
        version: string;
    }

    export const uiConfig: ResolvedUiConfig;
}
