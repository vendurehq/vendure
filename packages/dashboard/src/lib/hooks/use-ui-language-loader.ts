import { loadI18nMessages } from '@/vdb/lib/load-i18n-messages.js';
import { toBcp47Tag } from '@/vdb/lib/utils.js';
import { useLingui } from '@lingui/react/macro';
import { useCallback } from 'react';

let currentlyLoading: string | null = null;

/**
 * @description
 * Loads the UI translations for the given locale and activates it
 * with the Lingui I18nProvider. Generally this is used internally
 * when the display language is set via the user > language dialog.
 *
 * @docsCategory hooks
 * @docsPage useUiLanguageLoader
 */
export function useUiLanguageLoader() {
    const { i18n } = useLingui();

    const loadAndActivateLocale = useCallback(
        async (locale: string) => {
            // Catalogs are named after the LanguageCode (e.g. `zh_Hans`), but Lingui passes
            // the active locale to `Intl.PluralRules`, which only accepts BCP 47 tags (`zh-Hans`).
            const bcp47Locale = toBcp47Tag(locale);
            if (currentlyLoading === locale || i18n.locale === bcp47Locale) {
                return;
            }
            currentlyLoading = locale;
            try {
                const messages = await loadI18nMessages(locale);
                i18n.load(bcp47Locale, messages);
                i18n.activate(bcp47Locale);
            } finally {
                currentlyLoading = null;
            }
        },
        [i18n],
    );

    return { loadAndActivateLocale };
}
