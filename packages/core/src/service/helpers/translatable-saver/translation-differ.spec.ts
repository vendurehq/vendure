import { LanguageCode } from '@vendure/common/lib/generated-types';
import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';

import { InternalServerError } from '../../../common/error/errors';
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

    // #4884 — when a concurrent request has already inserted a translation for the same
    // (base, languageCode), the insert hits the unique constraint and applyDiff must
    // converge on the concurrently inserted row instead of throwing.
    describe('applyDiff() concurrent-insert recovery', () => {
        const ctx = {} as any;
        let ctxRepo: { save: Mock };
        let rawRepo: { findOne: Mock };
        let connection: any;

        const duplicateKeyError = Object.assign(
            new Error("Duplicate entry 'de-1' for key 'product_translation.UQ_dcc35f0d2b8d422634e878b813c'"),
            { code: 'ER_DUP_ENTRY', errno: 1062 },
        );

        beforeEach(() => {
            ctxRepo = { save: vi.fn(async (translation: any) => translation) };
            rawRepo = { findOne: vi.fn() };
            connection = {
                getRepository: vi.fn(() => ctxRepo),
                withTransaction: vi.fn((transactionCtx: any, work: any) => work(transactionCtx)),
                rawConnection: { getRepository: vi.fn(() => rawRepo) },
            };
        });

        function createEntity(): Product {
            return { id: 1, translations: [] } as any;
        }

        function createToAdd(): ProductTranslation {
            return new ProductTranslation({
                languageCode: LanguageCode.de,
                name: 'de name',
                slug: 'de-slug',
                description: '',
            });
        }

        it('inserts the new translation when there is no conflict', async () => {
            const differ = new TranslationDiffer(ProductTranslation as any, connection);
            const entity = createEntity();

            const result = await differ.applyDiff(ctx, entity, { toUpdate: [], toAdd: [createToAdd()] });

            expect(ctxRepo.save).toHaveBeenCalledTimes(1);
            expect(rawRepo.findOne).not.toHaveBeenCalled();
            expect(result.translations).toHaveLength(1);
            expect(result.translations[0].languageCode).toBe(LanguageCode.de);
        });

        it('adopts the concurrently inserted row on a unique constraint violation', async () => {
            ctxRepo.save.mockRejectedValueOnce(duplicateKeyError);
            const winnerRow = new ProductTranslation({
                id: 42,
                languageCode: LanguageCode.de,
                name: 'winner name',
                slug: 'winner-slug',
                description: '',
            });
            rawRepo.findOne.mockResolvedValueOnce(winnerRow);
            const differ = new TranslationDiffer(ProductTranslation as any, connection);
            const entity = createEntity();

            const result = await differ.applyDiff(ctx, entity, { toUpdate: [], toAdd: [createToAdd()] });

            expect(rawRepo.findOne).toHaveBeenCalledWith({
                where: { base: { id: 1 }, languageCode: LanguageCode.de },
            });
            expect(result.translations).toEqual([winnerRow]);
        });

        it('throws InternalServerError when the conflicting row cannot be found', async () => {
            ctxRepo.save.mockRejectedValueOnce(duplicateKeyError);
            rawRepo.findOne.mockResolvedValueOnce(null);
            const differ = new TranslationDiffer(ProductTranslation as any, connection);

            await expect(
                differ.applyDiff(ctx, createEntity(), { toUpdate: [], toAdd: [createToAdd()] }),
            ).rejects.toBeInstanceOf(InternalServerError);
        });

        it('rethrows errors that are not unique constraint violations', async () => {
            ctxRepo.save.mockRejectedValueOnce(new Error('connection lost'));
            const differ = new TranslationDiffer(ProductTranslation as any, connection);

            await expect(
                differ.applyDiff(ctx, createEntity(), { toUpdate: [], toAdd: [createToAdd()] }),
            ).rejects.toBeInstanceOf(InternalServerError);
            expect(rawRepo.findOne).not.toHaveBeenCalled();
        });
    });
});
