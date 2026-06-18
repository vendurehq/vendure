import { useUserSettings } from './use-user-settings.js';

const rtlLanguageCodes = ['ar', 'he', 'fa', 'ur', 'ps'];

/**
 * @description
 * Returns information about the current display language & region.
 *
 * @example
 * ```tsx
 * const {
 *   bcp47Tag,
 *   humanReadableLanguageAndLocale,
 *   humanReadableLanguage,
 *   isRTL,
 * } = useDisplayLocale();
 *
 * console.log(bcp47Tag) // "en-GB"
 * console.log(humanReadableLanguage) // "English"
 * console.log(humanReadableLanguageAndLocale) // "British English"
 * console.log(isRTL) // false
 * ```
 *
 * @docsCategory hooks
 * @docsPage useDisplayLocale
 */
export function useDisplayLocale() {
    const { settings } = useUserSettings();
    const language = settings.displayLanguage.replace(/[_-]/, '-');
    const locale = settings.displayLocale;
    const bcp47Tag = language.match(/[_-]/)
        ? language.replace(/[_-]/, '-')
        : [language, locale].filter(x => !!x).join('-');
    const humanReadableLanguageAndLocale = new Intl.DisplayNames([bcp47Tag], { type: 'language' }).of(
        bcp47Tag,
    );
    const isRTL = rtlLanguageCodes.includes(language);
    const humanReadableLanguage = new Intl.DisplayNames([bcp47Tag], { type: 'language' }).of(language);
    return { bcp47Tag, humanReadableLanguageAndLocale, humanReadableLanguage, isRTL };
}
