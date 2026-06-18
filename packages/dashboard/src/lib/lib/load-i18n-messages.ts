import { Messages } from '@lingui/core';

export async function loadI18nMessages(locale: string): Promise<Messages> {
    if (import.meta.env.PROD) {
        // We add the vite-ignore directive because we do not want to transform and
        // bundle this dynamic import. Instead, we actually want to load it at runtime
        // as a normal dynamic JS import.
        // These i18n JS files are generated during build by the `translationsPlugin` in the
        // vite-plugin-translations.ts file.
        const { messages } = await import(/* @vite-ignore */ `./i18n/${locale}.js`);
        return messages;
    } else {
        // In dev mode we allow the dynamic import behaviour
        const { messages } = await import(`../../i18n/locales/${locale}.po`);
        const pluginTranslations = await import('virtual:plugin-translations');
        const safeLocale = locale.replace(/-/g, '_');
        const pluginTranslationsForLocale = pluginTranslations.default[safeLocale] ?? {};
        return { ...messages, ...pluginTranslationsForLocale };
    }
}
