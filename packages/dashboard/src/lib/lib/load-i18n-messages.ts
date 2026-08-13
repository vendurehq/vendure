import { Messages } from '@lingui/core';

// `import.meta.glob` produces a static map of locale loaders that survives both
// dev (Vite intercepts) and publish-time bundling (esbuild emits each match as
// a chunk it can resolve). Previously this was a template-literal dynamic
// `import()` with `@vite-ignore`, which broke esbuild's dep scanner when the
// dashboard ships as a pre-built bundle (see issue #4719).
const localeMessages = import.meta.glob<{ messages: Messages }>(
    '../../i18n/locales/*.po',
);

export async function loadI18nMessages(locale: string): Promise<Messages> {
    const loader = localeMessages[`../../i18n/locales/${locale}.po`];
    if (!loader) {
        throw new Error(`No translation catalog for locale "${locale}"`);
    }
    const { messages } = await loader();
    const pluginTranslations = await import('virtual:plugin-translations');
    const safeLocale = locale.replace(/-/g, '_');
    const pluginTranslationsForLocale = pluginTranslations.default[safeLocale] ?? {};
    return { ...messages, ...pluginTranslationsForLocale };
}
