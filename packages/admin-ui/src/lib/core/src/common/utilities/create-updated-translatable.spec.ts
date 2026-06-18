import { DeepPartial } from '@vendure/common/lib/shared-types';

import { CustomFieldConfig, LanguageCode, ProductDetailFragment } from '../generated-types';

import { createUpdatedTranslatable } from './create-updated-translatable';

/* eslint-disable @typescript-eslint/no-non-null-assertion */
describe('createUpdatedTranslatable()', () => {
    let product: any;

    beforeEach(() => {
        product = {
            id: '1',
            languageCode: LanguageCode.en,
            name: 'Old Name EN',
            image: 'old-image.jpg',
            translations: [
                { languageCode: LanguageCode.en, name: 'Old Name EN' },
                { languageCode: LanguageCode.de, name: 'Old Name DE' },
            ],
        } as DeepPartial<ProductDetailFragment>;
    });

    it('returns a clone', () => {
        const formValue = {};
        const result = createUpdatedTranslatable({
            translatable: product,
            updatedFields: formValue,
            languageCode: LanguageCode.en,
        });

        expect(result).not.toBe(product);
    });

    it('creates new translation if the specified translation does not exist', () => {
        const formValue = {
            name: 'New Name AF',
        };
        const result = createUpdatedTranslatable({
            translatable: product,
            updatedFields: formValue,
            languageCode: LanguageCode.af,
            defaultTranslation: {
                languageCode: LanguageCode.af,
                name: product.name || '',
            },
        });

        expect(result.translations[2]).toEqual({
            languageCode: LanguageCode.af,
            name: 'New Name AF',
        });
    });

    it('updates the non-translatable properties', () => {
        const formValue = {
            image: 'new-image.jpg',
        };

        const result = createUpdatedTranslatable({
            translatable: product,
            updatedFields: formValue,
            languageCode: LanguageCode.en,
        });

        if (!result) {
            fail('Expected result to be truthy');
            return;
        }

        expect(result.image).toBe('new-image.jpg');
    });

    it('updates only the specified translation', () => {
        const formValue = {
            name: 'New Name EN',
        };

        const result = createUpdatedTranslatable({
            translatable: product,
            updatedFields: formValue,
            languageCode: LanguageCode.en,
        });

        if (!result) {
            fail('Expected result to be truthy');
            return;
        }

        expect(result.translations).not.toBe(product.translations);
        expect(result.translations[0]!.name).toBe('New Name EN');
        expect(result.translations[1]!.name).toBe('Old Name DE');
    });

    it('omits the customFields property if the customFieldConfig is not defined', () => {
        const formValue = {
            name: 'New Name EN',
        };

        const result = createUpdatedTranslatable({
            translatable: product,
            updatedFields: formValue,
            languageCode: LanguageCode.en,
        });

        if (!result) {
            fail('Expected result to be truthy');
            return;
        }

        expect(result.customFields).toBeUndefined();
    });

    it('updates custom fields correctly', () => {
        const customFieldConfig: CustomFieldConfig[] = [
            { name: 'available', type: 'boolean', list: false },
            { name: 'shortName', type: 'localeString', list: false },
        ];
        product.customFields = {
            available: true,
            shortName: 'foo',
        };
        product.translations[0].customFields = { shortName: 'foo' };

        const formValue = {
            customFields: {
                available: false,
                shortName: 'bar',
            },
        };

        const result = createUpdatedTranslatable({
            translatable: product,
            updatedFields: formValue,
            customFieldConfig,
            languageCode: LanguageCode.en,
        });

        if (!result) {
            fail('Expected result to be truthy');
            return;
        }

        expect(result.customFields).toEqual({
            available: false,
        });
        expect(result.translations[0].customFields).toEqual({
            shortName: 'bar',
        });
    });

    it('updates custom fields when none initially exists', () => {
        const customFieldConfig: CustomFieldConfig[] = [
            { name: 'available', type: 'boolean', list: false },
            { name: 'shortName', type: 'localeString', list: false },
        ];

        const formValue = {
            customFields: {
                available: false,
                shortName: 'bar',
            },
        };

        const result = createUpdatedTranslatable({
            translatable: product,
            updatedFields: formValue,
            customFieldConfig,
            languageCode: LanguageCode.en,
        });

        if (!result) {
            fail('Expected result to be truthy');
            return;
        }

        expect(result.customFields).toEqual({
            available: false,
        });
        expect(result.translations[0].customFields).toEqual({
            shortName: 'bar',
        });
    });

    it('coerces empty customFields to correct type (non-nullable)', () => {
        const customFieldConfig: CustomFieldConfig[] = [
            { name: 'a', type: 'boolean', list: false, nullable: false },
            { name: 'b', type: 'int', list: false, nullable: false },
            { name: 'c', type: 'float', list: false, nullable: false },
            { name: 'd', type: 'datetime', list: false, nullable: false },
            { name: 'e', type: 'string', list: false, nullable: false },
        ];

        const formValue = {
            customFields: {
                a: '',
                b: '',
                c: '',
                d: '',
                e: '',
            },
        };

        const result = createUpdatedTranslatable({
            translatable: product,
            updatedFields: formValue,
            customFieldConfig,
            languageCode: LanguageCode.en,
        });

        expect(result.customFields.a).toBe(false);
        expect(result.customFields.b).toBe(0);
        expect(result.customFields.c).toBe(0);
        expect(result.customFields.d instanceof Date).toBe(true);
        expect(result.customFields.e).toBe('');
    });

    it('coerces empty customFields to correct type (nullable)', () => {
        const customFieldConfig: CustomFieldConfig[] = [
            { name: 'a', type: 'boolean', list: false, nullable: true },
            { name: 'b', type: 'int', list: false, nullable: true },
            { name: 'c', type: 'float', list: false, nullable: true },
            { name: 'd', type: 'datetime', list: false, nullable: true },
            { name: 'e', type: 'string', list: false, nullable: true },
        ];

        const formValue = {
            customFields: {
                a: '',
                b: '',
                c: '',
                d: '',
                e: '',
            },
        };

        const result = createUpdatedTranslatable({
            translatable: product,
            updatedFields: formValue,
            customFieldConfig,
            languageCode: LanguageCode.en,
        });

        expect(result.customFields.a).toBe(null);
        expect(result.customFields.b).toBe(null);
        expect(result.customFields.c).toBe(null);
        expect(result.customFields.d).toBe(null);
        expect(result.customFields.e).toBe(null);
    });
});
