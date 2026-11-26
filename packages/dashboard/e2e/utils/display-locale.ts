import { type Page } from '@playwright/test';

import { LS_KEY_USER_SETTINGS } from '../../src/lib/storage-keys.js';

/**
 * Sets the display locale before the page loads, keeping the English display language so that
 * labels stay the same. For example, `DE` formats numbers with a comma decimal separator. The
 * e2e server has no settings store, so the setting only lives in the page's own localStorage.
 */
export async function setDisplayLocale(page: Page, displayLocale: string) {
    await page.addInitScript(
        ({ key, locale }) => {
            const settings = JSON.parse(localStorage.getItem(key) || '{}');
            localStorage.setItem(
                key,
                JSON.stringify({ ...settings, displayLanguage: 'en', displayLocale: locale }),
            );
        },
        { key: LS_KEY_USER_SETTINGS, locale: displayLocale },
    );
}
