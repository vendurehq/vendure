import { LanguageCode } from '@vendure/common/lib/generated-types';
import { beforeEach, describe, expect, it } from 'vitest';

import { Translatable, Translation } from '../../../common/types/locale-types';
import { VendureEntity } from '../../../entity/base/base.entity';
import { CollectionTranslation } from '../../../entity/collection/collection-translation.entity';
import { Collection } from '../../../entity/collection/collection.entity';
import { ProductOptionTranslation } from '../../../entity/product-option/product-option-translation.entity';
import { ProductOption } from '../../../entity/product-option/product-option.entity';
import { ProductVariantTranslation } from '../../../entity/product-variant/product-variant-translation.entity';
import { ProductVariant } from '../../../entity/product-variant/product-variant.entity';
import { ProductTranslation } from '../../../entity/product/product-translation.entity';
import { Product } from '../../../entity/product/product.entity';

import { translateDeep, translateEntity, translateTree } from './translate-entity';

const LANGUAGE_CODE = LanguageCode.en;
const PRODUCT_NAME_EN = 'English Name';
const VARIANT_NAME_EN = 'English Variant';
const OPTION_NAME_EN = 'English Option';
const PRODUCT_NAME_DE = 'German Name';
const VARIANT_NAME_DE = 'German Variant';
const OPTION_NAME_DE = 'German Option';

describe('translateEntity()', () => {
    let product: Product;
    let productTranslationEN: ProductTranslation;
    let productTranslationDE: ProductTranslation;

    beforeEach(() => {
        productTranslationEN = new ProductTranslation({
            id: '2',
            languageCode: LanguageCode.en,
            name: PRODUCT_NAME_EN,
            slug: '',
            description: '',
        });
        productTranslationEN.base = { id: 1 } as any;
        productTranslationEN.customFields = {};

        productTranslationDE = new ProductTranslation({
            id: '3',
            languageCode: LanguageCode.de,
            name: PRODUCT_NAME_DE,
            slug: '',
            description: '',
        });
        productTranslationDE.base = { id: 1 } as any;
        productTranslationDE.customFields = {};

        product = new Product();
        product.id = '1';
        product.translations = [productTranslationEN, productTranslationDE];
        product.customFields = {};
    });

    it('should unwrap the matching translation', () => {
        const result = translateEntity(product, [LanguageCode.en, LanguageCode.en]);

        expect(result).toHaveProperty('name', PRODUCT_NAME_EN);
    });

    it('should not overwrite translatable id with translation id', () => {
        const result = translateEntity(product, [LanguageCode.en, LanguageCode.en]);

        expect(result).toHaveProperty('id', '1');
    });

    it('should note transfer the base from the selected translation', () => {
        const result = translateEntity(product, [LanguageCode.en, LanguageCode.en]);

        expect(result).not.toHaveProperty('base');
    });

    it('should transfer the languageCode from the selected translation', () => {
        const result = translateEntity(product, [LanguageCode.en, LanguageCode.en]);

        expect(result).toHaveProperty('languageCode', 'en');
    });

    describe('customFields handling', () => {
        it('should leave customFields with no localeStrings intact', () => {
            const customFields = {
                aBooleanField: true,
            };
            product.customFields = customFields;
            const result = translateEntity(product, [LanguageCode.en, LanguageCode.en]);

            expect(result.customFields).toEqual(customFields);
        });

        it('should translate customFields with localeStrings', () => {
            const translatedCustomFields = {
                aLocaleString1: 'translated1',
                aLocaleString2: 'translated2',
            };
            product.translations[0].customFields = translatedCustomFields;
            const result = translateEntity(product, [LanguageCode.en, LanguageCode.en]);

            expect(result.customFields).toEqual(translatedCustomFields);
        });

        it('should translate customFields with localeStrings and other types', () => {
            const productCustomFields = {
                aBooleanField: true,
                aStringField: 'foo',
            };
            const translatedCustomFields = {
                aLocaleString1: 'translated1',
                aLocaleString2: 'translated2',
            };
            product.customFields = productCustomFields;
            product.translations[0].customFields = translatedCustomFields;
            const result = translateEntity(product, [LanguageCode.en, LanguageCode.en]);

            expect(result.customFields).toEqual({ ...productCustomFields, ...translatedCustomFields });
        });
    });

    it('throw if there are no translations available', () => {
        product.translations = [];

        expect(() => translateEntity(product, [LanguageCode.en, LanguageCode.en])).toThrow(
            'error.entity-has-no-translation-in-language',
        );
    });

    it('falls back to default language when requested not found', () => {
        expect(translateEntity(product, [LanguageCode.zu, LanguageCode.en]).name).toEqual(PRODUCT_NAME_EN);
    });

    it('falls back to first in language code array when default not found', () => {
        expect(translateEntity(product, [LanguageCode.zu, LanguageCode.de]).name).toEqual(PRODUCT_NAME_DE);
    });

    describe('field-level fallback for empty values', () => {
        it('should fall back to default language for empty string fields', () => {
            productTranslationEN.name = PRODUCT_NAME_EN;
            productTranslationEN.slug = 'english-slug';
            productTranslationEN.description = 'English description';

            productTranslationDE.name = '';
            productTranslationDE.slug = '';
            productTranslationDE.description = '';

            const result = translateEntity(product, LanguageCode.de);

            expect(result.languageCode).toBe(LanguageCode.de);
            expect(result.name).toBe(PRODUCT_NAME_EN);
            expect(result.slug).toBe('english-slug');
            expect(result.description).toBe('English description');
        });

        it('should keep non-empty translated values and only fall back empty ones', () => {
            productTranslationEN.name = PRODUCT_NAME_EN;
            productTranslationEN.slug = 'english-slug';
            productTranslationEN.description = 'English description';

            productTranslationDE.name = PRODUCT_NAME_DE;
            productTranslationDE.slug = '';
            productTranslationDE.description = 'German description';

            const result = translateEntity(product, LanguageCode.de);

            expect(result.languageCode).toBe(LanguageCode.de);
            expect(result.name).toBe(PRODUCT_NAME_DE);
            expect(result.slug).toBe('english-slug');
            expect(result.description).toBe('German description');
        });

        it('should fall back custom field locale strings to default language', () => {
            productTranslationEN.customFields = {
                localeName: 'English locale name',
            };
            productTranslationDE.customFields = {
                localeName: '',
            };

            const result = translateEntity(product, LanguageCode.de);

            expect(result.customFields.localeName).toBe('English locale name');
        });

        it('should fall back null custom field values to default language', () => {
            productTranslationEN.customFields = {
                localeName: 'English locale name',
            };
            productTranslationDE.customFields = {
                localeName: null,
            };

            const result = translateEntity(product, LanguageCode.de);

            expect(result.customFields.localeName).toBe('English locale name');
        });

        it('should fall back null field values to default language', () => {
            productTranslationEN.name = PRODUCT_NAME_EN;
            (productTranslationDE as any).name = null;

            const result = translateEntity(product, LanguageCode.de);

            expect(result.languageCode).toBe(LanguageCode.de);
            expect(result.name).toBe(PRODUCT_NAME_EN);
        });

        it('should not fall back when the requested language is the default language and is first translation', () => {
            // When EN is both DEFAULT_LANGUAGE_CODE and translations[0], there's nothing to fall back to.
            productTranslationEN.name = '';
            productTranslationEN.slug = '';

            const result = translateEntity(product, LanguageCode.en);

            expect(result.languageCode).toBe(LanguageCode.en);
            expect(result.name).toBe('');
            expect(result.slug).toBe('');
        });

        it('should fall back to other translations when default language has empty values and is not first', () => {
            // EN is DEFAULT_LANGUAGE_CODE but DE is translations[0] — DE should be used as fallback
            productTranslationEN.name = '';
            productTranslationDE.name = PRODUCT_NAME_DE;
            product.translations = [productTranslationDE, productTranslationEN];

            const result = translateEntity(product, LanguageCode.en);

            expect(result.languageCode).toBe(LanguageCode.en);
            expect(result.name).toBe(PRODUCT_NAME_DE);
        });

        it('should fall back to first available translation if default also has empty values', () => {
            const productTranslationFR = new ProductTranslation({
                id: '4',
                languageCode: LanguageCode.fr,
                name: '',
                slug: '',
                description: '',
            });
            productTranslationFR.base = { id: 1 } as any;
            productTranslationFR.customFields = {};

            // EN (default) also has empty name, but DE (first) has a value
            productTranslationEN.name = '';
            productTranslationDE.name = PRODUCT_NAME_DE;

            product.translations = [productTranslationDE, productTranslationEN, productTranslationFR];

            const result = translateEntity(product, LanguageCode.fr);

            expect(result.languageCode).toBe(LanguageCode.fr);
            // Default (EN) is empty, so falls through to first translation (DE)
            expect(result.name).toBe(PRODUCT_NAME_DE);
        });

        it('should fall back to first translation when default translation row does not exist', () => {
            const productTranslationFR = new ProductTranslation({
                id: '4',
                languageCode: LanguageCode.fr,
                name: '',
                slug: '',
                description: '',
            });
            productTranslationFR.base = { id: 1 } as any;
            productTranslationFR.customFields = {};

            // No EN (default) translation exists at all, DE is first and has values
            product.translations = [productTranslationDE, productTranslationFR];

            const result = translateEntity(product, LanguageCode.fr);

            expect(result.languageCode).toBe(LanguageCode.fr);
            expect(result.name).toBe(PRODUCT_NAME_DE);
        });

        describe('with languageCode array (TranslatorService pattern)', () => {
            it('should respect array priority for field-level fallback', () => {
                const productTranslationFR = new ProductTranslation({
                    id: '4',
                    languageCode: LanguageCode.fr,
                    name: 'French Name',
                    slug: 'french-slug',
                    description: '',
                });
                productTranslationFR.base = { id: 1 } as any;
                productTranslationFR.customFields = {};

                productTranslationEN.description = 'English description';
                productTranslationDE.name = '';
                productTranslationDE.slug = '';
                productTranslationDE.description = '';

                product.translations = [productTranslationEN, productTranslationDE, productTranslationFR];

                // Simulates TranslatorService: [requested, channelDefault, systemDefault]
                // Channel default is FR, system default is EN
                const result = translateEntity(product, [LanguageCode.de, LanguageCode.fr, LanguageCode.en]);

                expect(result.languageCode).toBe(LanguageCode.de);
                // FR is higher priority in the array than EN, so field fallback goes to FR first
                expect(result.name).toBe('French Name');
                expect(result.slug).toBe('french-slug');
                // FR description is also empty, so falls through to EN
                expect(result.description).toBe('English description');
            });

            it('should fall back through array priority then to first translation', () => {
                const productTranslationFR = new ProductTranslation({
                    id: '4',
                    languageCode: LanguageCode.fr,
                    name: '',
                    slug: '',
                    description: '',
                });
                productTranslationFR.base = { id: 1 } as any;
                productTranslationFR.customFields = {};

                productTranslationEN.name = '';
                productTranslationDE.name = '';

                // Put a translation with content as first in the array
                const productTranslationES = new ProductTranslation({
                    id: '5',
                    languageCode: LanguageCode.es,
                    name: 'Spanish Name',
                    slug: '',
                    description: '',
                });
                productTranslationES.base = { id: 1 } as any;
                productTranslationES.customFields = {};

                product.translations = [
                    productTranslationES,
                    productTranslationEN,
                    productTranslationDE,
                    productTranslationFR,
                ];

                // None of the array languages have a name value
                const result = translateEntity(product, [LanguageCode.fr, LanguageCode.de, LanguageCode.en]);

                expect(result.languageCode).toBe(LanguageCode.fr);
                // All array entries empty, falls to first translation (ES)
                expect(result.name).toBe('Spanish Name');
            });
        });
    });
});

describe('translateDeep()', () => {
    interface TestProduct extends VendureEntity {
        singleTestVariant: TestVariant;
        singleRealVariant: ProductVariant;
    }

    class TestProductEntity extends VendureEntity implements Translatable {
        constructor() {
            super();
        }
        id: string;
        singleTestVariant: TestVariantEntity;
        singleRealVariant: ProductVariant;
        translations: Array<Translation<TestProduct>>;
    }

    interface TestVariant extends VendureEntity {
        singleOption: ProductOption;
    }

    class TestVariantEntity extends VendureEntity implements Translatable {
        constructor() {
            super();
        }
        id: string;
        singleOption: ProductOption;
        translations: Array<Translation<TestVariant>>;
    }

    let testProduct: TestProductEntity;
    let testVariant: TestVariantEntity;
    let product: Product;
    let productTranslation: ProductTranslation;
    let productVariant: ProductVariant;
    let productVariantTranslation: ProductVariantTranslation;
    let productOption: ProductOption;
    let productOptionTranslation: ProductOptionTranslation;

    beforeEach(() => {
        productTranslation = new ProductTranslation();
        productTranslation.id = '2';
        productTranslation.languageCode = LANGUAGE_CODE;
        productTranslation.name = PRODUCT_NAME_EN;

        productOptionTranslation = new ProductOptionTranslation();
        productOptionTranslation.id = '31';
        productOptionTranslation.languageCode = LANGUAGE_CODE;
        productOptionTranslation.name = OPTION_NAME_EN;

        productOption = new ProductOption();
        productOption.id = '3';
        productOption.translations = [productOptionTranslation];

        productVariantTranslation = new ProductVariantTranslation();
        productVariantTranslation.id = '41';
        productVariantTranslation.languageCode = LANGUAGE_CODE;
        productVariantTranslation.name = VARIANT_NAME_EN;

        productVariant = new ProductVariant();
        productVariant.id = '3';
        productVariant.translations = [productVariantTranslation];
        productVariant.options = [productOption];

        product = new Product();
        product.id = '1';
        product.translations = [productTranslation];
        product.variants = [productVariant];

        testVariant = new TestVariantEntity();
        testVariant.singleOption = productOption;

        testProduct = new TestProductEntity();
        testProduct.singleTestVariant = testVariant;
        testProduct.singleRealVariant = productVariant;
    });

    it('should translate the root entity', () => {
        const result = translateDeep(product, [LanguageCode.en, LanguageCode.en]);

        expect(result).toHaveProperty('name', PRODUCT_NAME_EN);
    });

    it('should not throw if root entity has no translations', () => {
        expect(() => translateDeep(testProduct, [LanguageCode.en, LanguageCode.en])).not.toThrow();
    });

    it('should not throw if first-level nested entity is not defined', () => {
        testProduct.singleRealVariant = undefined as any;
        expect(() =>
            translateDeep(testProduct, [LanguageCode.en, LanguageCode.en], ['singleRealVariant']),
        ).not.toThrow();
    });

    it('should not throw if second-level nested entity is not defined', () => {
        testProduct.singleRealVariant.options = undefined as any;
        expect(() =>
            translateDeep(
                testProduct,
                [LanguageCode.en, LanguageCode.en],
                [['singleRealVariant', 'options']],
            ),
        ).not.toThrow();
    });

    it('should translate a first-level nested non-array entity', () => {
        const result = translateDeep(testProduct, [LanguageCode.en, LanguageCode.en], ['singleRealVariant']);

        expect(result.singleRealVariant).toHaveProperty('name', VARIANT_NAME_EN);
    });

    it('should translate a first-level nested entity array', () => {
        const result = translateDeep(product, [LanguageCode.en, LanguageCode.en], ['variants']);

        expect(result).toHaveProperty('name', PRODUCT_NAME_EN);
        expect(result.variants[0]).toHaveProperty('name', VARIANT_NAME_EN);
    });

    it('should translate a second-level nested non-array entity', () => {
        const result = translateDeep(
            testProduct,
            [LanguageCode.en, LanguageCode.en],
            [['singleTestVariant', 'singleOption']],
        );

        expect(result.singleTestVariant.singleOption).toHaveProperty('name', OPTION_NAME_EN);
    });

    it('should translate a second-level nested entity array (first-level is not array)', () => {
        const result = translateDeep(
            testProduct,
            [LanguageCode.en, LanguageCode.en],
            [['singleRealVariant', 'options']],
        );

        expect(result.singleRealVariant.options[0]).toHaveProperty('name', OPTION_NAME_EN);
    });

    it('should translate a second-level nested entity array', () => {
        const result = translateDeep(
            product,
            [LanguageCode.en, LanguageCode.en],
            ['variants', ['variants', 'options']],
        );

        expect(result).toHaveProperty('name', PRODUCT_NAME_EN);
        expect(result.variants[0]).toHaveProperty('name', VARIANT_NAME_EN);
        expect(result.variants[0].options[0]).toHaveProperty('name', OPTION_NAME_EN);
    });
});

describe('translateTree()', () => {
    let cat1: Collection;
    let cat11: Collection;
    let cat12: Collection;
    let cat111: Collection;

    beforeEach(() => {
        cat1 = new Collection({
            translations: [
                new CollectionTranslation({
                    languageCode: LanguageCode.en,
                    name: 'cat1 en',
                }),
            ],
        });
        cat11 = new Collection({
            translations: [
                new CollectionTranslation({
                    languageCode: LanguageCode.en,
                    name: 'cat11 en',
                }),
            ],
        });
        cat12 = new Collection({
            translations: [
                new CollectionTranslation({
                    languageCode: LanguageCode.en,
                    name: 'cat12 en',
                }),
            ],
        });
        cat111 = new Collection({
            translations: [
                new CollectionTranslation({
                    languageCode: LanguageCode.en,
                    name: 'cat111 en',
                }),
            ],
        });

        cat1.children = [cat11, cat12];
        cat11.children = [cat111];
    });

    it('translates all entities in the tree', () => {
        const result = translateTree(cat1, [LanguageCode.en, LanguageCode.en], []);

        expect(result.languageCode).toBe(LanguageCode.en);
        expect(result.name).toBe('cat1 en');
        expect(result.children[0].name).toBe('cat11 en');
        expect(result.children[1].name).toBe('cat12 en');
        expect(result.children[0].children[0].name).toBe('cat111 en');
    });
});
