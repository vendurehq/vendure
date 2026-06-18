import { CustomFieldConfig, LanguageCode } from '../../common/generated-types';

import { removeReadonlyCustomFields } from './remove-readonly-custom-fields';

describe('removeReadonlyCustomFields', () => {
    it('readonly field and writable field', () => {
        const config: CustomFieldConfig[] = [
            { name: 'weight', type: 'int', list: false },
            { name: 'rating', type: 'float', readonly: true, list: false },
        ];
        const entity = {
            id: 1,
            name: 'test',
            customFields: {
                weight: 500,
                rating: 123,
            },
        };

        const result = removeReadonlyCustomFields(entity, config);
        expect(result).toEqual({
            id: 1,
            name: 'test',
            customFields: {
                weight: 500,
            },
        } as any);
    });

    it('single readonly field', () => {
        const config: CustomFieldConfig[] = [{ name: 'rating', type: 'float', readonly: true, list: false }];
        const entity = {
            id: 1,
            name: 'test',
            customFields: {
                rating: 123,
            },
        };

        const result = removeReadonlyCustomFields(entity, config);
        expect(result).toEqual({
            id: 1,
            name: 'test',
            customFields: {},
        } as any);
    });

    it('readonly field and customFields is undefined', () => {
        const config: CustomFieldConfig[] = [{ name: 'alias', type: 'string', readonly: true, list: false }];

        const entity = {
            id: 1,
            name: 'test',
            customFields: undefined,
        };

        const result = removeReadonlyCustomFields(entity, config);
        expect(result).toEqual({
            id: 1,
            name: 'test',
            customFields: undefined,
        } as any);
    });

    it('readonly field in translation', () => {
        const config: CustomFieldConfig[] = [
            { name: 'alias', type: 'localeString', readonly: true, list: false },
        ];
        const entity = {
            id: 1,
            name: 'test',
            translations: [{ id: 1, languageCode: LanguageCode.en, customFields: { alias: 'testy' } }],
        };

        const result = removeReadonlyCustomFields(entity, config);
        expect(result).toEqual({
            id: 1,
            name: 'test',
            translations: [{ id: 1, languageCode: LanguageCode.en, customFields: {} }],
        } as any);
    });

    it('readonly field and customFields is undefined in translation', () => {
        const config: CustomFieldConfig[] = [
            { name: 'alias', type: 'localeString', readonly: true, list: false },
        ];
        const entity = {
            id: 1,
            name: 'test',
            translations: [{ id: 1, languageCode: LanguageCode.en, customFields: undefined }],
        };

        const result = removeReadonlyCustomFields(entity, config);
        expect(result).toEqual({
            id: 1,
            name: 'test',
            translations: [{ id: 1, languageCode: LanguageCode.en, customFields: undefined }],
        } as any);
    });

    it('wrapped in an input object', () => {
        const config: CustomFieldConfig[] = [
            { name: 'weight', type: 'int', list: false },
            { name: 'rating', type: 'float', readonly: true, list: false },
        ];
        const entity = {
            input: {
                id: 1,
                name: 'test',
                customFields: {
                    weight: 500,
                    rating: 123,
                },
            },
        };

        const result = removeReadonlyCustomFields(entity, config);
        expect(result).toEqual({
            input: {
                id: 1,
                name: 'test',
                customFields: {
                    weight: 500,
                },
            },
        } as any);
    });

    it('with array of input objects', () => {
        const config: CustomFieldConfig[] = [
            { name: 'weight', type: 'int', list: false },
            { name: 'rating', type: 'float', readonly: true, list: false },
        ];
        const entity = {
            input: [
                {
                    id: 1,
                    name: 'test',
                    customFields: {
                        weight: 500,
                        rating: 123,
                    },
                },
            ],
        };

        const result = removeReadonlyCustomFields(entity, config);
        expect(result).toEqual({
            input: [
                {
                    id: 1,
                    name: 'test',
                    customFields: {
                        weight: 500,
                    },
                },
            ],
        } as any);
    });
});
