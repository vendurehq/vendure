import { RwPermissionDefinition } from '@vendure/core';
import { join } from 'node:path';

export const DEFAULT_APP_PATH = join(__dirname, 'dist');
export const loggerCtx = 'DashboardPlugin';
export const defaultLanguage = 'en';
export const defaultLocale = undefined;
export const defaultAvailableLanguages = [
    'en',
    'de',
    'es',
    'cs',
    'zh_Hans',
    'pt_BR',
    'pt_PT',
    'zh_Hant',
    'bg',
    'nl',
];
export const defaultAvailableLocales = [
    'en-US',
    'de-DE',
    'es-ES',
    'zh-CN',
    'zh-TW',
    'pt-BR',
    'pt-PT',
    'bg_BG',
    'nl-NL',
];

export const manageDashboardGlobalViews = new RwPermissionDefinition('DashboardGlobalViews');
