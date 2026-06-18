import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';

/**
 * Computes a fallback placeholder string from the default language translation
 * when the user is viewing a non-default content language.
 *
 * Returns `undefined` if no fallback is needed (same language, no default value, etc.).
 *
 * @param translations - The translations array from form state
 * @param defaultLanguageCode - The channel's default language code
 * @param contentLanguage - The currently selected content language
 * @param fieldPath - Dot-separated path to the field value within a translation object (e.g. 'name' or 'customFields.seoTitle')
 */
export function getLocaleFallbackPlaceholder(
    translations: Array<Record<string, any>> | undefined | null,
    defaultLanguageCode: string | undefined,
    contentLanguage: string,
    fieldPath: string,
): string | undefined {
    if (!defaultLanguageCode || contentLanguage === defaultLanguageCode || !Array.isArray(translations)) {
        return undefined;
    }
    const defaultTranslation = translations.find((t: any) => t?.languageCode === defaultLanguageCode);
    if (!defaultTranslation) {
        return undefined;
    }
    // Resolve dot-separated field paths like 'customFields.seoTitle'
    const value = fieldPath.split('.').reduce<any>((obj, key) => obj?.[key], defaultTranslation);
    if (typeof value === 'string' && value.length > 0) {
        return i18n.t(msg`Fallback: ${value}`);
    }
    return undefined;
}
