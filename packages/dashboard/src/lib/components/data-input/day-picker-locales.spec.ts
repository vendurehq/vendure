import { describe, expect, it } from 'vitest';

import { getDayPickerLocaleLoader } from './day-picker-locales.js';

describe('getDayPickerLocaleLoader', () => {
    async function codeFor(tag: string) {
        const loader = getDayPickerLocaleLoader(tag);
        return loader ? (await loader()).code : undefined;
    }

    it('loads the locale of the language, ignoring the region', async () => {
        expect(await codeFor('de')).toBe('de');
        expect(await codeFor('de-AT')).toBe('de');
        expect(await codeFor('fr-CA')).toBe('fr');
    });

    it('prefers a language-region or language-script match', async () => {
        expect(await codeFor('pt-BR')).toBe('pt-BR');
        expect(await codeFor('pt-PT')).toBe('pt');
        expect(await codeFor('pt_BR')).toBe('pt-BR');
        expect(await codeFor('zh-Hans')).toBe('zh-CN');
        expect(await codeFor('zh-Hant')).toBe('zh-TW');
        expect(await codeFor('zh-Hant-TW')).toBe('zh-TW');
    });

    // react-day-picker's locales add translated labels to the date-fns locale
    it('includes DayPicker labels', async () => {
        const loader = getDayPickerLocaleLoader('de');
        const locale = (await loader?.()) as { labels?: { labelNext?: string } };
        expect(locale.labels?.labelNext).toBe('Zum nächsten Monat');
    });

    it('loads the Persian locale for fa', async () => {
        expect(await codeFor('fa')).toBe('fa-IR');
    });

    it('returns undefined for English and for languages without a locale', () => {
        expect(getDayPickerLocaleLoader('en')).toBeUndefined();
        expect(getDayPickerLocaleLoader('en-GB')).toBeUndefined();
        expect(getDayPickerLocaleLoader('ne')).toBeUndefined();
        expect(getDayPickerLocaleLoader('xx')).toBeUndefined();
    });

    it('has a loader for every dashboard language that react-day-picker has a locale for', async () => {
        const { default: config } = await import('../../../../lingui.config.js');
        const missing = (config.locales as string[]).filter(
            l => !['en', 'ne'].includes(l) && !getDayPickerLocaleLoader(l),
        );
        expect(missing).toEqual([]);
    });
});
