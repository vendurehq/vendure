import { setupI18n } from '@lingui/core';
import { formatter } from '@lingui/format-po';
import { compileMessage } from '@lingui/message-utils/compileMessage';
import { generateMessageId } from '@lingui/message-utils/generateMessageId';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * #5641: the dashboard sidebar renders each nav title with `i18n.t(item.title)`, so the title
 * text itself is the message id. Without a catalog entry under that id the title is never
 * translated, and a production build logs "Uncompiled message detected!" for it.
 */
describe('dashboard nav titles', () => {
    const i18nDir = join(__dirname, 'i18n');
    const sourceLocale = 'en';
    const navTitles = ['MCP Server', 'Overview', 'Tools', 'Activity', 'Grants'];
    const locales = readdirSync(i18nDir)
        .filter(name => name.endsWith('.po'))
        .map(name => name.replace(/\.po$/, ''));

    async function parseCatalog(locale: string) {
        const filename = join(i18nDir, `${locale}.po`);
        return formatter().parse(readFileSync(filename, 'utf8'), { locale, sourceLocale, filename });
    }

    // Same fallback order as Lingui's `getTranslationsForCatalog`, which the dashboard Vite plugin
    // uses to merge plugin catalogs: locale translation, source translation, source text, id.
    async function loadI18n(locale: string) {
        const catalog = await parseCatalog(locale);
        const source = await parseCatalog(sourceLocale);
        const messages = Object.fromEntries(
            Object.entries(catalog).map(([id, entry]) => [
                id,
                compileMessage(
                    entry.translation ||
                        source[id]?.translation ||
                        source[id]?.message ||
                        entry.message ||
                        id,
                ),
            ]),
        );
        const i18n = setupI18n();
        i18n.load(locale, messages);
        i18n.activate(locale);
        return i18n;
    }

    it.each(locales)('%s resolves every nav title by its text', async locale => {
        const i18n = await loadI18n(locale);
        const missing: string[] = [];
        i18n.on('missing', event => missing.push(event.id));

        for (const title of navTitles) {
            // The page headings render the same words with <Trans>, which Lingui keys by a hash,
            // so the sidebar and the heading must resolve to the same text.
            expect(i18n.t(title), `${locale}: "${title}"`).toBe(i18n._(generateMessageId(title)));
        }

        expect(missing).toEqual([]);
    });

    it('translates the Tools nav title in Spanish', async () => {
        const i18n = await loadI18n('es');

        expect(i18n.t('Tools')).toBe('Herramientas');
    });
});
