import i18next from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';

import { I18nService } from './i18n.service';

// https://github.com/vendurehq/vendure/issues/4823
describe('I18nService', () => {
    let i18nService: I18nService;

    beforeAll(async () => {
        i18nService = new I18nService({} as any);
        await i18nService.onModuleInit();
    });

    it('sets supportedLngs to the bundled languages', () => {
        const supportedLngs = i18next.options.supportedLngs as string[];
        for (const code of ['en', 'de', 'es', 'fr', 'pt_BR', 'pt_PT', 'ru', 'uk']) {
            expect(supportedLngs).toContain(code);
        }
    });

    it('does not grow options.preload for unsupported language codes', async () => {
        const before = [...(i18next.options.preload as string[])];

        for (let i = 0; i < 50; i++) {
            await i18next.loadLanguages(`xx-${i}`);
        }
        await i18next.loadLanguages('zh-Hant-TW');

        expect(i18next.options.preload).toEqual(before);
    });

    it('resolves the exact underscore region code to its own bundle (pt_BR)', () => {
        // Vendure's LanguageCode enum uses underscores (e.g. `pt_BR`). Setting supportedLngs
        // must not collapse or reject these region-specific bundles.
        const match = i18next.services.languageUtils.getBestMatchFromCodes(['pt_BR']);
        expect(match).toBe('pt_BR');
    });

    it('falls back to en for a hyphenated region code with no matching bundle (pt-BR)', () => {
        // Browsers send `pt-BR` (hyphen) via Accept-Language, but we only ship `pt_BR`
        // (underscore). This resolves to the fallback — the same English result as before
        // the fix (which attempted a non-existent `pt-BR.json` load and then fell back),
        // so there is no regression.
        const match = i18next.services.languageUtils.getBestMatchFromCodes(['pt-BR']);
        expect(match).toBe('en');
    });

    it('addTranslation updates both the public and the cached supportedLngs', () => {
        // `zz` has no bundled message file, so it is only supported once registered.
        expect(i18next.options.supportedLngs).not.toContain('zz');

        i18nService.addTranslation('zz', { errorResult: {} });

        expect(i18next.options.supportedLngs).toContain('zz');
        // The cached copy read by isSupportedCode() must also be updated, otherwise the
        // language would be silently rejected by loadLanguages.
        expect((i18next as any).services.languageUtils.supportedLngs).toContain('zz');
    });

    it('loads a language into preload only after it has been registered', async () => {
        // Before registration: rejected by the supportedLngs filter, preload unchanged.
        const beforeRegistration = [...(i18next.options.preload as string[])];
        await i18next.loadLanguages('yy');
        expect(i18next.options.preload).toEqual(beforeRegistration);

        // After registration: accepted and appended to preload.
        i18nService.addTranslation('yy', { errorResult: {} });
        await i18next.loadLanguages('yy');
        expect(i18next.options.preload).toContain('yy');
    });
});
