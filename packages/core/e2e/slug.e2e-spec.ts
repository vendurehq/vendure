import { LanguageCode } from '@vendure/common/lib/generated-types';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { graphql } from './graphql/graphql-admin';
import { createCollectionDocument, createProductDocument } from './graphql/shared-definitions';

describe('Slug generation', () => {
    const { server, adminClient } = createTestEnvironment(testConfig());

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    describe('slugForEntity query', () => {
        describe('basic slug generation', () => {
            it('generates a simple slug', async () => {
                const result = await adminClient.query(slugForEntityDocument, {
                    input: {
                        entityName: 'Product',
                        fieldName: 'slug',
                        inputValue: 'Test Product',
                    },
                });

                expect(result.slugForEntity).toBe('test-product');
            });

            it('handles multiple spaces', async () => {
                const result = await adminClient.query(slugForEntityDocument, {
                    input: {
                        entityName: 'Product',
                        fieldName: 'slug',
                        inputValue: 'Test   Product   Name',
                    },
                });

                expect(result.slugForEntity).toBe('test-product-name');
            });

            it('converts uppercase to lowercase', async () => {
                const result = await adminClient.query(slugForEntityDocument, {
                    input: {
                        entityName: 'Product',
                        fieldName: 'slug',
                        inputValue: 'TEST PRODUCT NAME',
                    },
                });

                expect(result.slugForEntity).toBe('test-product-name');
            });

            it('preserves numbers', async () => {
                const result = await adminClient.query(slugForEntityDocument, {
                    input: {
                        entityName: 'Product',
                        fieldName: 'slug',
                        inputValue: 'Product 123 Version 2',
                    },
                });

                expect(result.slugForEntity).toBe('product-123-version-2');
            });
        });

        describe('special characters and unicode', () => {
            it('removes special characters', async () => {
                const result = await adminClient.query(slugForEntityDocument, {
                    input: {
                        entityName: 'Product',
                        fieldName: 'slug',
                        inputValue: 'Product!@#$%^&*()_+Name',
                    },
                });

                expect(result.slugForEntity).toBe('productname');
            });

            it('handles special characters with spaces', async () => {
                const result = await adminClient.query(slugForEntityDocument, {
                    input: {
                        entityName: 'Product',
                        fieldName: 'slug',
                        inputValue: 'Product !@#$ Name',
                    },
                });

                expect(result.slugForEntity).toBe('product-name');
            });

            it('handles diacritical marks (accents)', async () => {
                const result = await adminClient.query(slugForEntityDocument, {
                    input: {
                        entityName: 'Product',
                        fieldName: 'slug',
                        inputValue: 'Café Français naïve résumé',
                    },
                });

                expect(result.slugForEntity).toBe('cafe-francais-naive-resume');
            });

            it('handles German umlauts', async () => {
                const result = await adminClient.query(slugForEntityDocument, {
                    input: {
                        entityName: 'Product',
                        fieldName: 'slug',
                        inputValue: 'Über größer schön',
                    },
                });

                expect(result.slugForEntity).toBe('uber-groer-schon');
            });

            it('handles Spanish characters', async () => {
                const result = await adminClient.query(slugForEntityDocument, {
                    input: {
                        entityName: 'Product',
                        fieldName: 'slug',
                        inputValue: 'Niño Español Añejo',
                    },
                });

                expect(result.slugForEntity).toBe('nino-espanol-anejo');
            });

            it('handles non-Latin scripts (removes them)', async () => {
                const result = await adminClient.query(slugForEntityDocument, {
                    input: {
                        entityName: 'Product',
                        fieldName: 'slug',
                        inputValue: 'Product 商品 المنتج उत्पाद',
                    },
                });

                expect(result.slugForEntity).toBe('product');
            });

            it('handles emoji (removes them)', async () => {
                const result = await adminClient.query(slugForEntityDocument, {
                    input: {
                        entityName: 'Product',
                        fieldName: 'slug',
                        inputValue: 'Cool Product 😎 🚀 Amazing',
                    },
                });

                expect(result.slugForEntity).toBe('cool-product-amazing');
            });

            it('handles punctuation and symbols', async () => {
                const result = await adminClient.query(slugForEntityDocument, {
                    input: {
                        entityName: 'Product',
                        fieldName: 'slug',
                        inputValue: 'Product: The Best! (Version 2.0) - New & Improved',
                    },
                });

                expect(result.slugForEntity).toBe('product-the-best-version-20-new-improved');
            });
        });

        describe('edge cases', () => {
            it('handles leading and trailing spaces', async () => {
                const result = await adminClient.query(slugForEntityDocument, {
                    input: {
                        entityName: 'Product',
                        fieldName: 'slug',
                        inputValue: '   Test Product   ',
                    },
                });

                expect(result.slugForEntity).toBe('test-product');
            });

            it('handles hyphens correctly', async () => {
                const result = await adminClient.query(slugForEntityDocument, {
                    input: {
                        entityName: 'Product',
                        fieldName: 'slug',
                        inputValue: 'Test--Product---Name',
                    },
                });

                expect(result.slugForEntity).toBe('test-product-name');
            });

            it('handles leading and trailing hyphens', async () => {
                const result = await adminClient.query(slugForEntityDocument, {
                    input: {
                        entityName: 'Product',
                        fieldName: 'slug',
                        inputValue: '-Test Product-',
                    },
                });

                expect(result.slugForEntity).toBe('test-product');
            });

            it('handles empty string', async () => {
                const result = await adminClient.query(slugForEntityDocument, {
                    input: {
                        entityName: 'Product',
                        fieldName: 'slug',
                        inputValue: '',
                    },
                });

                expect(result.slugForEntity).toBe('');
            });

            it('handles only special characters', async () => {
                const result = await adminClient.query(slugForEntityDocument, {
                    input: {
                        entityName: 'Product',
                        fieldName: 'slug',
                        inputValue: '!@#$%^&*()',
                    },
                });

                expect(result.slugForEntity).toBe('');
            });

            it('handles mixed case with numbers and special chars', async () => {
                const result = await adminClient.query(slugForEntityDocument, {
                    input: {
                        entityName: 'Product',
                        fieldName: 'slug',
                        inputValue: '100% Natural & Organic Product #1',
                    },
                });

                expect(result.slugForEntity).toBe('100-natural-organic-product-1');
            });
        });

        describe('uniqueness handling', () => {
            it('appends number for duplicate slugs', async () => {
                // First, create a product with slug 'laptop'
                await adminClient.query(createProductDocument, {
                    input: {
                        translations: [
                            {
                                languageCode: 'en',
                                name: 'Laptop',
                                slug: 'laptop',
                                description: 'A laptop computer',
                            },
                        ],
                    },
                });

                // Now try to generate slug for another product with the same base slug
                const result = await adminClient.query(slugForEntityDocument, {
                    input: {
                        entityName: 'Product',
                        fieldName: 'slug',
                        inputValue: 'Laptop',
                    },
                });

                expect(result.slugForEntity).toBe('laptop-1');
            });

            it('increments counter for multiple duplicates', async () => {
                // Create products with slugs 'phone' and 'phone-1'
                await adminClient.query(createProductDocument, {
                    input: {
                        translations: [
                            {
                                languageCode: 'en',
                                name: 'Phone',
                                slug: 'phone',
                                description: 'A smartphone',
                            },
                        ],
                    },
                });

                await adminClient.query(createProductDocument, {
                    input: {
                        translations: [
                            {
                                languageCode: 'en',
                                name: 'Phone 2',
                                slug: 'phone-1',
                                description: 'Another smartphone',
                            },
                        ],
                    },
                });

                // Now generate slug for another phone
                const result = await adminClient.query(slugForEntityDocument, {
                    input: {
                        entityName: 'Product',
                        fieldName: 'slug',
                        inputValue: 'Phone',
                    },
                });

                expect(result.slugForEntity).toBe('phone-2');
            });

            it('excludes own ID when checking uniqueness', async () => {
                // Create a product
                const createResult = await adminClient.query(createProductDocument, {
                    input: {
                        translations: [
                            {
                                languageCode: 'en',
                                name: 'Tablet',
                                slug: 'tablet',
                                description: 'A tablet device',
                            },
                        ],
                    },
                });

                const productId = createResult.createProduct.id;

                // Generate slug for the same product (updating scenario)
                const result = await adminClient.query(slugForEntityDocument, {
                    input: {
                        entityName: 'Product',
                        fieldName: 'slug',
                        inputValue: 'Tablet',
                        entityId: productId,
                    },
                });

                // Should return the same slug without appending number
                expect(result.slugForEntity).toBe('tablet');
            });

            it('works with different entity types', async () => {
                // Test with Collection entity (slug field is in CollectionTranslation)
                const result = await adminClient.query(slugForEntityDocument, {
                    input: {
                        entityName: 'Collection',
                        fieldName: 'slug',
                        inputValue: 'Summer Collection 2024',
                    },
                });

                expect(result.slugForEntity).toBe('summer-collection-2024');
            });

            it('handles multi-language slug generation', async () => {
                // Create a product with English translation first
                const createProduct = await adminClient.query(createProductDocument, {
                    input: {
                        translations: [
                            {
                                languageCode: LanguageCode.en,
                                name: 'English Product',
                                slug: 'english-product',
                                description: 'Product in English',
                            },
                        ],
                    },
                });

                const productId = createProduct.createProduct.id;

                // Test generating slug for German translation of the same product
                const germanResult = await adminClient.query(slugForEntityDocument, {
                    input: {
                        entityName: 'Product',
                        fieldName: 'slug',
                        inputValue: 'Deutsches Produkt',
                        entityId: productId,
                    },
                });

                expect(germanResult.slugForEntity).toBe('deutsches-produkt');

                // Test generating slug for French translation
                const frenchResult = await adminClient.query(slugForEntityDocument, {
                    input: {
                        entityName: 'Product',
                        fieldName: 'slug',
                        inputValue: 'Produit Français',
                        entityId: productId,
                    },
                });

                expect(frenchResult.slugForEntity).toBe('produit-francais');
            });

            it('handles uniqueness across different language translations', async () => {
                // Create first product with multiple language translations
                await adminClient.query(createProductDocument, {
                    input: {
                        translations: [
                            {
                                languageCode: LanguageCode.en,
                                name: 'Computer',
                                slug: 'computer',
                                description: 'A computer',
                            },
                            {
                                languageCode: LanguageCode.de,
                                name: 'Computer',
                                slug: 'computer-de',
                                description: 'Ein Computer',
                            },
                        ],
                    },
                });

                // Generate slug for a new product with same English name
                const englishSlugResult = await adminClient.query(slugForEntityDocument, {
                    input: {
                        entityName: 'Product',
                        fieldName: 'slug',
                        inputValue: 'Computer',
                    },
                });

                expect(englishSlugResult.slugForEntity).toBe('computer-1');

                // Generate slug with German input that also conflicts
                const germanSlugResult = await adminClient.query(slugForEntityDocument, {
                    input: {
                        entityName: 'Product',
                        fieldName: 'slug',
                        inputValue: 'Computer DE',
                    },
                });

                expect(germanSlugResult.slugForEntity).toBe('computer-de-1');

                // Generate slug with French input that doesn't conflict
                const frenchSlugResult = await adminClient.query(slugForEntityDocument, {
                    input: {
                        entityName: 'Product',
                        fieldName: 'slug',
                        inputValue: 'Ordinateur',
                    },
                });

                expect(frenchSlugResult.slugForEntity).toBe('ordinateur');
            });

            it('handles translation entity exclusion correctly with multiple languages', async () => {
                // Create a product with multiple language translations
                const createProduct = await adminClient.query(createProductDocument, {
                    input: {
                        translations: [
                            {
                                languageCode: LanguageCode.en,
                                name: 'Multilingual Product',
                                slug: 'multilingual-product',
                                description: 'Product in English',
                            },
                            {
                                languageCode: LanguageCode.de,
                                name: 'Mehrsprachiges Produkt',
                                slug: 'mehrsprachiges-produkt',
                                description: 'Produkt auf Deutsch',
                            },
                        ],
                    },
                });

                const productId = createProduct.createProduct.id;

                // Update English translation - should not conflict with itself
                const englishUpdateResult = await adminClient.query(slugForEntityDocument, {
                    input: {
                        entityName: 'Product',
                        fieldName: 'slug',
                        inputValue: 'Multilingual Product Updated',
                        entityId: productId,
                    },
                });

                expect(englishUpdateResult.slugForEntity).toBe('multilingual-product-updated');

                // Update German translation - should not conflict with itself
                const germanUpdateResult = await adminClient.query(slugForEntityDocument, {
                    input: {
                        entityName: 'Product',
                        fieldName: 'slug',
                        inputValue: 'Mehrsprachiges Produkt Aktualisiert',
                        entityId: productId,
                    },
                });

                expect(germanUpdateResult.slugForEntity).toBe('mehrsprachiges-produkt-aktualisiert');
            });
        });

        describe('multi-language collections', () => {
            it('generates unique slugs for collection translations', async () => {
                // Create a collection with multiple language translations
                const createCollection = await adminClient.query(createCollectionDocument, {
                    input: {
                        translations: [
                            {
                                languageCode: LanguageCode.en,
                                name: 'Tech Collection',
                                slug: 'tech-collection',
                                description: 'Technology products',
                            },
                            {
                                languageCode: LanguageCode.fr,
                                name: 'Collection Tech',
                                slug: 'collection-tech',
                                description: 'Produits technologiques',
                            },
                        ],
                        filters: [],
                    },
                });

                const collectionId = createCollection.createCollection.id;

                // Test generating new slug for Spanish translation
                const spanishResult = await adminClient.query(slugForEntityDocument, {
                    input: {
                        entityName: 'Collection',
                        fieldName: 'slug',
                        inputValue: 'Colección Tecnológica',
                        entityId: collectionId,
                    },
                });

                expect(spanishResult.slugForEntity).toBe('coleccion-tecnologica');
            });

            it('handles collection slug conflicts across languages', async () => {
                // Create collection with English name
                await adminClient.query(createCollectionDocument, {
                    input: {
                        translations: [
                            {
                                languageCode: LanguageCode.en,
                                name: 'Fashion Collection',
                                slug: 'fashion-collection',
                                description: 'Fashion items',
                            },
                        ],
                        filters: [],
                    },
                });

                // Generate slug for another collection with similar name
                const result = await adminClient.query(slugForEntityDocument, {
                    input: {
                        entityName: 'Collection',
                        fieldName: 'slug',
                        inputValue: 'Fashion Collection',
                    },
                });

                expect(result.slugForEntity).toBe('fashion-collection-1');

                // Test with international name that transliterates to similar slug
                const internationalResult = await adminClient.query(slugForEntityDocument, {
                    input: {
                        entityName: 'Collection',
                        fieldName: 'slug',
                        inputValue: 'Façhion Collêction',
                    },
                });

                expect(internationalResult.slugForEntity).toBe('fachion-collection');
            });
        });

        describe('international character handling', () => {
            it('handles various language scripts in slug generation', async () => {
                // Test different language inputs
                const testCases = [
                    { input: 'Café Français', expected: 'cafe-francais' },
                    { input: 'Niño Español', expected: 'nino-espanol' },
                    { input: 'Größer Schön', expected: 'groer-schon' },
                    { input: 'Naïve Résumé', expected: 'naive-resume' },
                    { input: 'Crème Brûlée', expected: 'creme-brulee' },
                    { input: 'Piñata Jalapeño', expected: 'pinata-jalapeno' },
                ];

                for (const testCase of testCases) {
                    const result = await adminClient.query(slugForEntityDocument, {
                        input: {
                            entityName: 'Product',
                            fieldName: 'slug',
                            inputValue: testCase.input,
                        },
                    });
                    expect(result.slugForEntity).toBe(testCase.expected);
                }
            });

            it('handles mixed language input', async () => {
                const result = await adminClient.query(slugForEntityDocument, {
                    input: {
                        entityName: 'Product',
                        fieldName: 'slug',
                        inputValue: 'English Français Español Deutsch Mix',
                    },
                });

                expect(result.slugForEntity).toBe('english-francais-espanol-deutsch-mix');
            });
        });

        describe('auto-detection functionality', () => {
            it('auto-detects translation entity for slug field', async () => {
                // Using base entity name, should automatically detect ProductTranslation
                const result = await adminClient.query(slugForEntityDocument, {
                    input: {
                        entityName: 'Product',
                        fieldName: 'slug',
                        inputValue: 'Auto Detection Test',
                    },
                });

                expect(result.slugForEntity).toBe('auto-detection-test');
            });

            it('works with explicit translation entity names', async () => {
                // Still works when explicitly using translation entity name
                const result = await adminClient.query(slugForEntityDocument, {
                    input: {
                        entityName: 'ProductTranslation',
                        fieldName: 'slug',
                        inputValue: 'Explicit Translation Test',
                    },
                });

                expect(result.slugForEntity).toBe('explicit-translation-test');
            });

            it('works with Collection entity auto-detection', async () => {
                // Using base entity name, should automatically detect CollectionTranslation
                const result = await adminClient.query(slugForEntityDocument, {
                    input: {
                        entityName: 'Collection',
                        fieldName: 'slug',
                        inputValue: 'Collection Auto Detection',
                    },
                });

                expect(result.slugForEntity).toBe('collection-auto-detection');
            });

            it('auto-detects translation entities for different languages', async () => {
                // Test that auto-detection works regardless of the intended language
                const testCases = [
                    { input: 'Auto Detection English', expected: 'auto-detection-english' },
                    { input: 'Détection Automatique', expected: 'detection-automatique' },
                    { input: 'Detección Automática', expected: 'deteccion-automatica' },
                    { input: 'Automatische Erkennung', expected: 'automatische-erkennung' },
                ];

                for (const testCase of testCases) {
                    const result = await adminClient.query(slugForEntityDocument, {
                        input: {
                            entityName: 'Product',
                            fieldName: 'slug',
                            inputValue: testCase.input,
                        },
                    });
                    expect(result.slugForEntity).toBe(testCase.expected);
                }
            });
        });

        describe('error handling', () => {
            it('throws error for non-existent entity', async () => {
                try {
                    await adminClient.query(slugForEntityDocument, {
                        input: {
                            entityName: 'NonExistentEntity',
                            fieldName: 'slug',
                            inputValue: 'Test',
                        },
                    });
                    expect.fail('Should have thrown an error');
                } catch (error: any) {
                    expect(error.message).toContain('error.entity-not-found');
                }
            });

            it('throws error for non-existent field', async () => {
                try {
                    await adminClient.query(slugForEntityDocument, {
                        input: {
                            entityName: 'Product',
                            fieldName: 'nonExistentField',
                            inputValue: 'Test',
                        },
                    });
                    expect.fail('Should have thrown an error');
                } catch (error: any) {
                    expect(error.message).toContain('error.entity-has-no-field');
                }
            });
        });
    });
});

const slugForEntityDocument = graphql(`
    query SlugForEntity($input: SlugForEntityInput!) {
        slugForEntity(input: $input)
    }
`);
