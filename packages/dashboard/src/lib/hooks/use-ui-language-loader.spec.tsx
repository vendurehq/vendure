import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useUiLanguageLoader } from './use-ui-language-loader.js';

const loadI18nMessages = vi.hoisted(() => vi.fn());

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/vdb/lib/load-i18n-messages.js', () => ({
    loadI18nMessages,
}));

const pluralMessageId = 'items-count';

describe('useUiLanguageLoader', () => {
    let container: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        loadI18nMessages.mockResolvedValue({
            [pluralMessageId]: '{count, plural, one {# item} other {# items}}',
        });
        i18n.loadAndActivate({ locale: 'en', messages: {} });
    });

    afterEach(async () => {
        await act(async () => {
            root.unmount();
        });
        container.remove();
        vi.clearAllMocks();
    });

    async function renderLoader() {
        let loader: ReturnType<typeof useUiLanguageLoader> | undefined;
        function Harness() {
            loader = useUiLanguageLoader();
            return null;
        }
        await act(async () => {
            root.render(
                <I18nProvider i18n={i18n}>
                    <Harness />
                </I18nProvider>,
            );
        });
        return loader!;
    }

    // #5538 — underscore LanguageCodes crashed every plural message with "Invalid language tag"
    it.each([
        ['zh_Hans', 'zh-Hans'],
        ['zh_Hant', 'zh-Hant'],
        ['pt_BR', 'pt-BR'],
        ['pt_PT', 'pt-PT'],
    ])('activates %s as the BCP 47 tag %s so plural messages format', async (languageCode, bcp47) => {
        const { loadAndActivateLocale } = await renderLoader();

        await act(async () => {
            await loadAndActivateLocale(languageCode);
        });

        expect(loadI18nMessages).toHaveBeenCalledWith(languageCode);
        expect(i18n.locale).toBe(bcp47);
        expect(i18n._(pluralMessageId, { count: 2 })).toBe('2 items');
    });

    it('does not reload the catalog when the same underscore LanguageCode is already active', async () => {
        const { loadAndActivateLocale } = await renderLoader();

        await act(async () => {
            await loadAndActivateLocale('zh_Hans');
        });
        await act(async () => {
            await loadAndActivateLocale('zh_Hans');
        });

        expect(loadI18nMessages).toHaveBeenCalledOnce();
    });
});
