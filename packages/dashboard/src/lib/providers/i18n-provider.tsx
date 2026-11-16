import { loadI18nMessages } from '@/vdb/lib/load-i18n-messages.js';
import { toBcp47Tag } from '@/vdb/lib/utils.js';
import { i18n } from '@lingui/core';
import { I18nProvider as LinguiI18nProvider } from '@lingui/react';
import React from 'react';

export const defaultLocale = 'en';

// Dashboard extensions are evaluated asynchronously during app bootstrap and
// may translate source-locale strings at module scope. Activate an empty source
// catalog synchronously so those translations are safe while the compiled
// dashboard and plugin catalogs load in parallel.
i18n.load(defaultLocale, {});
i18n.activate(defaultLocale);

/**
 * We do a dynamic import of just the catalog that we need
 * @param locale any locale string
 */
export async function dynamicActivate(locale: string, onActivate?: () => void) {
    const messages = await loadI18nMessages(locale);
    const bcp47Locale = toBcp47Tag(locale);
    i18n.load(bcp47Locale, messages);
    i18n.activate(bcp47Locale);
    onActivate?.();
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
    return <LinguiI18nProvider i18n={i18n}>{children}</LinguiI18nProvider>;
}
