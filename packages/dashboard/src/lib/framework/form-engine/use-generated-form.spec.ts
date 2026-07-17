import { describe, expect, it } from 'vitest';

import { ensureTranslationsForAllLanguages } from './use-generated-form.js';

describe('ensureTranslationsForAllLanguages', () => {
    it('adds drafts for active-channel languages while preserving existing out-of-channel translations', () => {
        const entity = {
            id: 'product-1',
            translations: [
                { id: 'translation-en', languageCode: 'en', name: 'English name', customFields: {} },
                { id: 'translation-es', languageCode: 'es', name: 'Nombre', customFields: {} },
            ],
        };
        const expectedStructure = {
            translations: [{ id: '', languageCode: 'en', name: '', customFields: {} }],
        };

        const result = ensureTranslationsForAllLanguages(entity, ['en', 'de'], expectedStructure);

        expect(result?.translations.map(translation => translation.languageCode)).toEqual(['en', 'es', 'de']);
        expect(result?.translations[1]).toEqual(entity.translations[1]);
        expect(result?.translations[2]).toEqual({
            languageCode: 'de',
            id: '',
            name: '',
            customFields: {},
        });
    });
});
