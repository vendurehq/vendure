import { LanguageCode } from '@vendure/common/lib/generated-types';
import { beforeEach, describe, expect, it } from 'vitest';

import { TranslationInput } from '../../../common/types/locale-types';
import { ProductTranslation } from '../../../entity/product/product-translation.entity';
import { Product } from '../../../entity/product/product.entity';

import { TranslationDiffer } from './translation-differ';

describe('TranslationUpdater', () => {
    describe('diff()', () => {
        const existing: ProductTranslation[] = [
            new ProductTranslation({
                id: '10',
                languageCode: LanguageCode.en,
                name: '',
                slug: '',
                description: '',
            }),
            new ProductTranslation({
                id: '11',
                languageCode: LanguageCode.de,
                name: '',
                slug: '',
                description: '',
            }),
        ];

        let connection: any;

        beforeEach(() => {
            connection = {};
        });

        it('correctly marks translations for update', async () => {
            const updated: Array<TranslationInput<Product>> = [
                {
                    languageCode: LanguageCode.en,
                    name: '',
                    slug: '',
                    description: '',
                },
                {
                    languageCode: LanguageCode.de,
                    name: '',
                    slug: '',
                    description: '',
                },
            ];

            const diff = new TranslationDiffer(ProductTranslation as any, connection).diff(existing, updated);
            expect(diff.toUpdate).toEqual(existing);
        });

        it('correctly marks translations for addition', async () => {
            const updated: Array<TranslationInput<Product>> = [
                {
                    languageCode: LanguageCode.af,
                    name: '',
                    slug: '',
                    description: '',
                },
                {
                    languageCode: LanguageCode.zh,
                    name: '',
                    slug: '',
                    description: '',
                },
            ];
            const diff = new TranslationDiffer(ProductTranslation as any, connection).diff(existing, updated);
            expect(diff.toAdd).toEqual(updated);
        });

        it('correctly marks languages for update, addition and deletion', async () => {
            const updated: Array<TranslationInput<Product>> = [
                {
                    languageCode: LanguageCode.en,
                    name: '',
                    slug: '',
                    description: '',
                },
                {
                    languageCode: LanguageCode.zh,
                    name: '',
                    slug: '',
                    description: '',
                },
            ];
            const diff = new TranslationDiffer(ProductTranslation as any, connection).diff(existing, updated);
            expect(diff.toUpdate).toEqual([existing[0]]);
            expect(diff.toAdd).toEqual([updated[1]]);
        });
    });
});
