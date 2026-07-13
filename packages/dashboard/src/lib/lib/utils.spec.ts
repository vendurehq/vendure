import { describe, expect, it } from 'vitest';

import { removeReadonlyAndLocalizedCustomFields } from './utils.js';

describe('removeReadonlyAndLocalizedCustomFields', () => {
    it('should return values unchanged when no customFields present', () => {
        const values = { name: 'Test' };
        const result = removeReadonlyAndLocalizedCustomFields(values, []);
        expect(result).toEqual({ name: 'Test' });
    });

    it('should return falsy values as-is', () => {
        const result = removeReadonlyAndLocalizedCustomFields(null as any, []);
        expect(result).toBeNull();
    });

    it('should remove readonly custom fields', () => {
        const values = {
            customFields: {
                editable: 'yes',
                locked: 'no',
            },
        };
        const configs = [
            { name: 'editable', type: 'string' },
            { name: 'locked', type: 'string', readonly: true },
        ];
        const result = removeReadonlyAndLocalizedCustomFields(values, configs);
        expect(result.customFields).toEqual({ editable: 'yes' });
    });

    it('should remove localeString and localeText fields from root customFields', () => {
        const values = {
            customFields: {
                regularField: 'value',
                localeName: 'should be removed',
                localeDescription: 'should be removed',
            },
        };
        const configs = [
            { name: 'regularField', type: 'string' },
            { name: 'localeName', type: 'localeString' },
            { name: 'localeDescription', type: 'localeText' },
        ];
        const result = removeReadonlyAndLocalizedCustomFields(values, configs);
        expect(result.customFields).toEqual({ regularField: 'value' });
    });

    it('should remove non-permitted custom fields (fields not in config)', () => {
        const values = {
            customFields: {
                allowed: 'yes',
                superAdminOnly: 'secret',
            },
        };
        // Only 'allowed' is in the config (user has permission for it)
        const configs = [{ name: 'allowed', type: 'string' }];
        const result = removeReadonlyAndLocalizedCustomFields(values, configs);
        expect(result.customFields).toEqual({ allowed: 'yes' });
    });

    it('should strip all custom fields when config is empty (no permitted fields)', () => {
        const values = {
            customFields: {
                field1: 'a',
                field2: 'b',
            },
        };
        const result = removeReadonlyAndLocalizedCustomFields(values, []);
        expect(result.customFields).toEqual({});
    });

    it('should handle relation fields with Id suffix for permitted fields', () => {
        const values = {
            customFields: {
                featuredProductId: '123',
                relatedProductsIds: ['1', '2'],
            },
        };
        const configs = [
            { name: 'featuredProduct', type: 'relation' },
            { name: 'relatedProducts', type: 'relation' },
        ];
        const result = removeReadonlyAndLocalizedCustomFields(values, configs);
        expect(result.customFields).toEqual({
            featuredProductId: '123',
            relatedProductsIds: ['1', '2'],
        });
    });

    it('should remove non-permitted relation fields (Id/Ids suffixed)', () => {
        const values = {
            customFields: {
                allowedProductId: '123',
                restrictedProductId: '456',
            },
        };
        // Only 'allowedProduct' is permitted
        const configs = [{ name: 'allowedProduct', type: 'relation' }];
        const result = removeReadonlyAndLocalizedCustomFields(values, configs);
        expect(result.customFields).toEqual({ allowedProductId: '123' });
    });

    it('should remove readonly relation fields with Id suffix', () => {
        const values = {
            customFields: {
                editableProductId: '123',
                lockedProductId: '456',
            },
        };
        const configs = [
            { name: 'editableProduct', type: 'relation' },
            { name: 'lockedProduct', type: 'relation', readonly: true },
        ];
        const result = removeReadonlyAndLocalizedCustomFields(values, configs);
        expect(result.customFields).toEqual({ editableProductId: '123' });
    });

    it('should remove readonly relation fields with Ids suffix (list relations)', () => {
        const values = {
            customFields: {
                editableItemsIds: ['1', '2'],
                lockedItemsIds: ['3', '4'],
            },
        };
        const configs = [
            { name: 'editableItems', type: 'relation' },
            { name: 'lockedItems', type: 'relation', readonly: true },
        ];
        const result = removeReadonlyAndLocalizedCustomFields(values, configs);
        expect(result.customFields).toEqual({ editableItemsIds: ['1', '2'] });
    });

    it('should not mutate the original values', () => {
        const values = {
            customFields: {
                allowed: 'yes',
                restricted: 'secret',
            },
        };
        const configs = [{ name: 'allowed', type: 'string' }];
        removeReadonlyAndLocalizedCustomFields(values, configs);
        expect(values.customFields).toEqual({ allowed: 'yes', restricted: 'secret' });
    });

    describe('translations', () => {
        it('should remove non-permitted custom fields from translations', () => {
            const values = {
                translations: [
                    {
                        languageCode: 'en',
                        customFields: {
                            allowedField: 'hello',
                            restrictedField: 'secret',
                        },
                    },
                ],
            };
            const configs = [{ name: 'allowedField', type: 'localeString' }];
            const result = removeReadonlyAndLocalizedCustomFields(values, configs);
            expect(result.translations[0].customFields).toEqual({ allowedField: 'hello' });
        });

        it('should remove readonly custom fields from translations', () => {
            const values = {
                translations: [
                    {
                        languageCode: 'en',
                        customFields: {
                            editable: 'can edit',
                            locked: 'cannot edit',
                        },
                    },
                ],
            };
            const configs = [
                { name: 'editable', type: 'localeString' },
                { name: 'locked', type: 'localeString', readonly: true },
            ];
            const result = removeReadonlyAndLocalizedCustomFields(values, configs);
            expect(result.translations[0].customFields).toEqual({ editable: 'can edit' });
        });

        it('should handle multiple translations', () => {
            const values = {
                translations: [
                    {
                        languageCode: 'en',
                        customFields: { allowed: 'hello', restricted: 'secret' },
                    },
                    {
                        languageCode: 'de',
                        customFields: { allowed: 'hallo', restricted: 'geheim' },
                    },
                ],
            };
            const configs = [{ name: 'allowed', type: 'localeString' }];
            const result = removeReadonlyAndLocalizedCustomFields(values, configs);
            expect(result.translations[0].customFields).toEqual({ allowed: 'hello' });
            expect(result.translations[1].customFields).toEqual({ allowed: 'hallo' });
        });

        it('should handle translations without customFields', () => {
            const values = {
                translations: [{ languageCode: 'en', name: 'Test' }],
            };
            const configs = [{ name: 'someField', type: 'localeString' }];
            const result = removeReadonlyAndLocalizedCustomFields(values, configs);
            expect(result.translations[0]).toEqual({ languageCode: 'en', name: 'Test' });
        });
    });

    describe('combined scenarios', () => {
        it('should handle a mix of readonly, locale, permitted, and non-permitted fields', () => {
            const values = {
                customFields: {
                    editableString: 'yes',
                    readonlyString: 'no',
                    localeName: 'root locale',
                    nonPermittedField: 'should go',
                    allowedRelationId: '1',
                    readonlyRelationId: '2',
                    nonPermittedRelationId: '3',
                },
                translations: [
                    {
                        languageCode: 'en',
                        customFields: {
                            localeName: 'English name',
                            nonPermittedLocale: 'should go',
                        },
                    },
                ],
            };
            const configs = [
                { name: 'editableString', type: 'string' },
                { name: 'readonlyString', type: 'string', readonly: true },
                { name: 'localeName', type: 'localeString' },
                { name: 'allowedRelation', type: 'relation' },
                { name: 'readonlyRelation', type: 'relation', readonly: true },
                // 'nonPermittedField' and 'nonPermittedRelation' are not in config
            ];
            const result = removeReadonlyAndLocalizedCustomFields(values, configs);
            expect(result.customFields).toEqual({
                editableString: 'yes',
                allowedRelationId: '1',
            });
            expect(result.translations[0].customFields).toEqual({
                localeName: 'English name',
            });
        });
    });
});
