import { DeletionResult, ErrorCode, LanguageCode, SortOrder } from '@vendure/common/lib/generated-types';
import { omit } from '@vendure/common/lib/omit';
import { pick } from '@vendure/common/lib/pick';
import { notNullOrUndefined } from '@vendure/common/lib/shared-utils';
import { createErrorResultGuard, createTestEnvironment, ErrorResultGuard } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
    productVariantFragment,
    productWithOptionsFragment,
    productWithVariantsFragment,
} from './graphql/fragments-admin';
import type { ResultOf, VariablesOf } from './graphql/graphql-admin';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import {
    addOptionGroupToProductDocument,
    createProductDocument,
    createProductOptionGroupDocument,
    createProductVariantsDocument,
    deleteProductDocument,
    deleteProductVariantDocument,
    getAssetListDocument,
    getOptionGroupDocument,
    getProductListDocument,
    getProductSimpleDocument,
    getProductVariantDocument,
    getProductVariantListDocument,
    getProductWithVariantListDocument,
    getProductWithVariantsDocument,
    removeOptionGroupFromProductDocument,
    updateChannelDocument,
    updateGlobalSettingsDocument,
    updateProductDocument,
    updateProductVariantsDocument,
} from './graphql/shared-definitions';
import { assertThrowsWithMessage } from './utils/assert-throws-with-message';

/* eslint-disable @typescript-eslint/no-non-null-assertion */

describe('Product resolver', () => {
    const { server, adminClient, shopClient } = createTestEnvironment({
        ...testConfig(),
    });

    const removeOptionGuard: ErrorResultGuard<ResultOf<typeof productWithOptionsFragment>> =
        createErrorResultGuard(input => !!input && 'optionGroups' in input);

    const updateChannelGuard: ErrorResultGuard<ResultOf<typeof updateChannelDocument>['updateChannel']> =
        createErrorResultGuard(input => !!input && 'id' in input);

    const productGuard: ErrorResultGuard<
        NonNullable<ResultOf<typeof getProductWithVariantsDocument>['product']>
    > = createErrorResultGuard(input => !!input && 'id' in input);

    const variantGuard: ErrorResultGuard<
        NonNullable<ResultOf<typeof createProductVariantsDocument>['createProductVariants'][number]>
    > = createErrorResultGuard(input => !!input && 'id' in input);

    const productQueryGuard: ErrorResultGuard<
        NonNullable<ResultOf<typeof getProductSimpleDocument>['product']>
    > = createErrorResultGuard(input => !!input && 'id' in input);

    const updateVariantGuard: ErrorResultGuard<
        NonNullable<ResultOf<typeof updateProductVariantsDocument>['updateProductVariants'][number]>
    > = createErrorResultGuard(input => !!input && 'id' in input);

    beforeAll(async () => {
        await server.init({
            initialData,
            customerCount: 1,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    describe('products list query', () => {
        it('returns all products when no options passed', async () => {
            const result = await adminClient.query(getProductListDocument, {});

            expect(result.products.items.length).toBe(20);
            expect(result.products.totalItems).toBe(20);
        });

        it('limits result set with skip & take', async () => {
            const result = await adminClient.query(getProductListDocument, {
                options: {
                    skip: 0,
                    take: 3,
                },
            });

            expect(result.products.items.length).toBe(3);
            expect(result.products.totalItems).toBe(20);
        });

        it('filters by name admin', async () => {
            const result = await adminClient.query(getProductListDocument, {
                options: {
                    filter: {
                        name: {
                            contains: 'skateboard',
                        },
                    },
                },
            });

            expect(result.products.items.length).toBe(1);
            expect(result.products.items[0].name).toBe('Cruiser Skateboard');
        });

        it('filters multiple admin', async () => {
            const result = await adminClient.query(getProductListDocument, {
                options: {
                    filter: {
                        name: {
                            contains: 'camera',
                        },
                        slug: {
                            contains: 'tent',
                        },
                    },
                },
            });

            expect(result.products.items.length).toBe(0);
        });

        it('sorts by name admin', async () => {
            const result = await adminClient.query(getProductListDocument, {
                options: {
                    sort: {
                        name: SortOrder.ASC,
                    },
                },
            });

            expect(result.products.items.map(p => p.name)).toEqual([
                'Bonsai Tree',
                'Boxing Gloves',
                'Camera Lens',
                'Clacky Keyboard',
                'Cruiser Skateboard',
                'Curvy Monitor',
                'Football',
                'Gaming PC',
                'Hard Drive',
                'Instant Camera',
                'Laptop',
                'Orchid',
                'Road Bike',
                'Running Shoe',
                'Skipping Rope',
                'Slr Camera',
                'Spiky Cactus',
                'Tent',
                'Tripod',
                'USB Cable',
            ]);
        });

        it('filters by name shop', async () => {
            const result = await shopClient.query(getProductListDocument, {
                options: {
                    filter: {
                        name: {
                            contains: 'skateboard',
                        },
                    },
                },
            });

            expect(result.products.items.length).toBe(1);
            expect(result.products.items[0].name).toBe('Cruiser Skateboard');
        });

        it('filters by sku admin', async () => {
            const result = await adminClient.query(getProductListDocument, {
                options: {
                    filter: {
                        sku: {
                            contains: 'IHD455T1',
                        },
                    },
                },
            });

            expect(result.products.items.length).toBe(1);
            expect(result.products.items[0].name).toBe('Hard Drive');
        });

        it('sorts by name shop', async () => {
            const result = await shopClient.query(getProductListDocument, {
                options: {
                    sort: {
                        name: SortOrder.ASC,
                    },
                },
            });

            expect(result.products.items.map(p => p.name)).toEqual([
                'Bonsai Tree',
                'Boxing Gloves',
                'Camera Lens',
                'Clacky Keyboard',
                'Cruiser Skateboard',
                'Curvy Monitor',
                'Football',
                'Gaming PC',
                'Hard Drive',
                'Instant Camera',
                'Laptop',
                'Orchid',
                'Road Bike',
                'Running Shoe',
                'Skipping Rope',
                'Slr Camera',
                'Spiky Cactus',
                'Tent',
                'Tripod',
                'USB Cable',
            ]);
        });
    });

    describe('product query', () => {
        it('by id', async () => {
            const { product } = await adminClient.query(getProductSimpleDocument, { id: 'T_2' });
            productQueryGuard.assertSuccess(product);
            expect(product.id).toBe('T_2');
        });

        it('by slug', async () => {
            const { product } = await adminClient.query(getProductSimpleDocument, { slug: 'curvy-monitor' });
            productQueryGuard.assertSuccess(product);
            expect(product.slug).toBe('curvy-monitor');
        });

        // https://github.com/vendurehq/vendure/issues/820
        it('by slug with multiple assets', async () => {
            const { product: product1 } = await adminClient.query(getProductSimpleDocument, { id: 'T_1' });
            productQueryGuard.assertSuccess(product1);
            await adminClient.query(updateProductDocument, {
                input: {
                    id: product1.id,
                    assetIds: ['T_1', 'T_2', 'T_3'],
                },
            });
            const { product } = await adminClient.query(getProductWithVariantsDocument, {
                slug: product1.slug,
            });
            productQueryGuard.assertSuccess(product);
            expect(product.assets.map(a => a.id)).toEqual(['T_1', 'T_2', 'T_3']);
        });

        // https://github.com/vendurehq/vendure/issues/538
        it('falls back to default language slug', async () => {
            const { product } = await adminClient.query(
                getProductSimpleDocument,
                { slug: 'curvy-monitor' },
                { languageCode: LanguageCode.de },
            );
            productQueryGuard.assertSuccess(product);
            expect(product.slug).toBe('curvy-monitor');
        });

        // GHSA-9pp3-53p2-ww9v
        it('does not allow SQL injection via languageCode query parameter', async () => {
            // A single quote in the languageCode breaks the SQL when interpolated
            // directly via a template literal. With parameterized queries, it is
            // safely bound as a value and the query executes normally.
            const { product } = await shopClient.query(
                getProductSimpleDocument,
                { slug: 'laptop' },
                { languageCode: "en' OR 1=1 --" },
            );
            expect(product).not.toBeNull();
        });

        it(
            'throws if neither id nor slug provided',
            assertThrowsWithMessage(async () => {
                await adminClient.query(getProductSimpleDocument, {});
            }, 'Either the Product id or slug must be provided'),
        );

        it(
            'throws if id and slug do not refer to the same Product',
            assertThrowsWithMessage(async () => {
                await adminClient.query(getProductSimpleDocument, {
                    id: 'T_2',
                    slug: 'laptop',
                });
            }, 'The provided id and slug refer to different Products'),
        );

        it('returns expected properties', async () => {
            const { product } = await adminClient.query(getProductWithVariantsDocument, {
                id: 'T_2',
            });

            productGuard.assertSuccess(product);
            expect(omit(product, ['variants'])).toMatchSnapshot();
            expect(product.variants.length).toBe(2);
        });

        it('ProductVariant price properties are correct', async () => {
            const result = await adminClient.query(getProductWithVariantsDocument, {
                id: 'T_2',
            });
            productGuard.assertSuccess(result.product);
            expect(result.product.variants[0].price).toBe(14374);
            expect(result.product.variants[0].taxCategory).toEqual({
                id: 'T_1',
                name: 'Standard Tax',
            });
        });

        it('returns null when id not found', async () => {
            const result = await adminClient.query(getProductWithVariantsDocument, {
                id: 'bad_id',
            });

            expect(result.product).toBeNull();
        });

        it('returns null when slug not found', async () => {
            const result = await adminClient.query(getProductWithVariantsDocument, {
                slug: 'bad_slug',
            });

            expect(result.product).toBeNull();
        });

        describe('product query with translations', () => {
            let translatedProduct: ResultOf<typeof productWithVariantsFragment>;
            let en_translation: ResultOf<typeof productWithVariantsFragment>['translations'][number];
            let de_translation: ResultOf<typeof productWithVariantsFragment>['translations'][number];

            beforeAll(async () => {
                const result = await adminClient.query(createProductDocument, {
                    input: {
                        translations: [
                            {
                                languageCode: LanguageCode.en,
                                name: 'en Pineapple',
                                slug: 'en-pineapple',
                                description: 'A delicious pineapple',
                            },
                            {
                                languageCode: LanguageCode.de,
                                name: 'de Ananas',
                                slug: 'de-ananas',
                                description: 'Eine köstliche Ananas',
                            },
                        ],
                    },
                });
                translatedProduct = result.createProduct;
                const en = translatedProduct.translations.find(t => t.languageCode === LanguageCode.en);
                const de = translatedProduct.translations.find(t => t.languageCode === LanguageCode.de);
                expect(en).toBeDefined();
                expect(de).toBeDefined();
                en_translation = en as typeof en_translation;
                de_translation = de as typeof de_translation;
            });

            it('en slug without translation arg', async () => {
                const { product } = await adminClient.query(getProductSimpleDocument, {
                    slug: en_translation.slug,
                });
                productQueryGuard.assertSuccess(product);
                expect(product.slug).toBe(en_translation.slug);
            });

            it('de slug without translation arg', async () => {
                const { product } = await adminClient.query(getProductSimpleDocument, {
                    slug: de_translation.slug,
                });
                productQueryGuard.assertSuccess(product);
                expect(product.slug).toBe(en_translation.slug);
            });

            it('en slug with translation en', async () => {
                const { product } = await adminClient.query(
                    getProductSimpleDocument,
                    { slug: en_translation.slug },
                    { languageCode: LanguageCode.en },
                );
                productQueryGuard.assertSuccess(product);
                expect(product.slug).toBe(en_translation.slug);
            });

            it('de slug with translation en', async () => {
                const { product } = await adminClient.query(
                    getProductSimpleDocument,
                    { slug: de_translation.slug },
                    { languageCode: LanguageCode.en },
                );
                productQueryGuard.assertSuccess(product);
                expect(product.slug).toBe(en_translation.slug);
            });

            it('en slug with translation de', async () => {
                const { product } = await adminClient.query(
                    getProductSimpleDocument,
                    { slug: en_translation.slug },
                    { languageCode: LanguageCode.de },
                );
                productQueryGuard.assertSuccess(product);
                expect(product.slug).toBe(de_translation.slug);
            });

            it('de slug with translation de', async () => {
                const { product } = await adminClient.query(
                    getProductSimpleDocument,
                    { slug: de_translation.slug },
                    { languageCode: LanguageCode.de },
                );
                productQueryGuard.assertSuccess(product);
                expect(product.slug).toBe(de_translation.slug);
            });

            it('de slug with translation ru', async () => {
                const { product } = await adminClient.query(
                    getProductSimpleDocument,
                    { slug: de_translation.slug },
                    { languageCode: LanguageCode.ru },
                );
                productQueryGuard.assertSuccess(product);
                expect(product.slug).toBe(en_translation.slug);
            });
        });

        describe('product.variants', () => {
            it('returns product variants', async () => {
                const { product } = await adminClient.query(getProductWithVariantsDocument, {
                    id: 'T_1',
                });

                expect(product?.variants.length).toBe(4);
            });

            it('returns product variants in existing language', async () => {
                const { product } = await adminClient.query(
                    getProductWithVariantsDocument,
                    {
                        id: 'T_1',
                    },
                    { languageCode: LanguageCode.en },
                );

                expect(product?.variants.length).toBe(4);
            });

            it('returns product variants in non-existing language', async () => {
                const { product } = await adminClient.query(
                    getProductWithVariantsDocument,
                    {
                        id: 'T_1',
                    },
                    { languageCode: LanguageCode.ru },
                );

                expect(product?.variants.length).toBe(4);
            });
        });

        describe('product.variants', () => {
            it('returns product variants', async () => {
                const { product } = await adminClient.query(getProductWithVariantsDocument, {
                    id: 'T_1',
                });

                expect(product?.variants.length).toBe(4);
            });

            it('returns product variants in existing language', async () => {
                const { product } = await adminClient.query(
                    getProductWithVariantsDocument,
                    {
                        id: 'T_1',
                    },
                    { languageCode: LanguageCode.en },
                );

                expect(product?.variants.length).toBe(4);
            });

            it('returns product variants in non-existing language', async () => {
                const { product } = await adminClient.query(
                    getProductWithVariantsDocument,
                    {
                        id: 'T_1',
                    },
                    { languageCode: LanguageCode.ru },
                );

                expect(product?.variants.length).toBe(4);
            });
        });

        describe('product.variantList', () => {
            it('returns product variants', async () => {
                const { product } = await adminClient.query(getProductWithVariantListDocument, {
                    id: 'T_1',
                });

                expect(product?.variantList.items.length).toBe(4);
                expect(product?.variantList.totalItems).toBe(4);
            });

            it('returns product variants in existing language', async () => {
                const { product } = await adminClient.query(
                    getProductWithVariantListDocument,
                    {
                        id: 'T_1',
                    },
                    { languageCode: LanguageCode.en },
                );

                expect(product?.variantList.items.length).toBe(4);
            });

            it('returns product variants in non-existing language', async () => {
                const { product } = await adminClient.query(
                    getProductWithVariantListDocument,
                    {
                        id: 'T_1',
                    },
                    { languageCode: LanguageCode.ru },
                );

                expect(product?.variantList.items.length).toBe(4);
            });

            it('filter & sort', async () => {
                const { product } = await adminClient.query(getProductWithVariantListDocument, {
                    id: 'T_1',
                    variantListOptions: {
                        filter: {
                            name: {
                                contains: '15',
                            },
                        },
                        sort: {
                            price: SortOrder.DESC,
                        },
                    },
                });

                expect(product?.variantList.items.map(i => i.name)).toEqual([
                    'Laptop 15 inch 16GB',
                    'Laptop 15 inch 8GB',
                ]);
            });
        });
    });

    describe('productVariants list query', () => {
        it('returns list', async () => {
            const { productVariants } = await adminClient.query(getProductVariantListDocument, {
                options: {
                    take: 3,
                    sort: {
                        name: SortOrder.ASC,
                    },
                },
            });

            expect(
                productVariants.items.map(i => pick(i, ['id', 'name', 'price', 'priceWithTax', 'sku'])),
            ).toEqual([
                {
                    id: 'T_34',
                    name: 'Bonsai Tree',
                    price: 1999,
                    priceWithTax: 2399,
                    sku: 'B01MXFLUSV',
                },
                {
                    id: 'T_24',
                    name: 'Boxing Gloves',
                    price: 3304,
                    priceWithTax: 3965,
                    sku: 'B000ZYLPPU',
                },
                {
                    id: 'T_19',
                    name: 'Camera Lens',
                    price: 10400,
                    priceWithTax: 12480,
                    sku: 'B0012UUP02',
                },
            ]);
        });

        it('sort by price', async () => {
            const { productVariants } = await adminClient.query(getProductVariantListDocument, {
                options: {
                    take: 3,
                    sort: {
                        price: SortOrder.ASC,
                    },
                },
            });

            expect(
                productVariants.items.map(i => pick(i, ['id', 'name', 'price', 'priceWithTax', 'sku'])),
            ).toEqual([
                {
                    id: 'T_23',
                    name: 'Skipping Rope',
                    price: 799,
                    priceWithTax: 959,
                    sku: 'B07CNGXVXT',
                },
                {
                    id: 'T_20',
                    name: 'Tripod',
                    price: 1498,
                    priceWithTax: 1798,
                    sku: 'B00XI87KV8',
                },
                {
                    id: 'T_32',
                    name: 'Spiky Cactus',
                    price: 1550,
                    priceWithTax: 1860,
                    sku: 'SC011001',
                },
            ]);
        });

        it('sort by priceWithTax', async () => {
            const { productVariants } = await adminClient.query(getProductVariantListDocument, {
                options: {
                    take: 3,
                    sort: {
                        priceWithTax: SortOrder.ASC,
                    },
                },
            });

            expect(
                productVariants.items.map(i => pick(i, ['id', 'name', 'price', 'priceWithTax', 'sku'])),
            ).toEqual([
                {
                    id: 'T_23',
                    name: 'Skipping Rope',
                    price: 799,
                    priceWithTax: 959,
                    sku: 'B07CNGXVXT',
                },
                {
                    id: 'T_20',
                    name: 'Tripod',
                    price: 1498,
                    priceWithTax: 1798,
                    sku: 'B00XI87KV8',
                },
                {
                    id: 'T_32',
                    name: 'Spiky Cactus',
                    price: 1550,
                    priceWithTax: 1860,
                    sku: 'SC011001',
                },
            ]);
        });

        it('filter by price', async () => {
            const { productVariants } = await adminClient.query(getProductVariantListDocument, {
                options: {
                    take: 3,
                    filter: {
                        price: {
                            between: {
                                start: 1400,
                                end: 1500,
                            },
                        },
                    },
                },
            });

            expect(
                productVariants.items.map(i => pick(i, ['id', 'name', 'price', 'priceWithTax', 'sku'])),
            ).toEqual([
                {
                    id: 'T_20',
                    name: 'Tripod',
                    price: 1498,
                    priceWithTax: 1798,
                    sku: 'B00XI87KV8',
                },
            ]);
        });

        it('filter by priceWithTax', async () => {
            const { productVariants } = await adminClient.query(getProductVariantListDocument, {
                options: {
                    take: 3,
                    filter: {
                        priceWithTax: {
                            between: {
                                start: 1400,
                                end: 1500,
                            },
                        },
                    },
                },
            });

            // Note the results are incorrect. This is a design trade-off. See the
            // commend on the ProductVariant.priceWithTax annotation for explanation.
            expect(
                productVariants.items.map(i => pick(i, ['id', 'name', 'price', 'priceWithTax', 'sku'])),
            ).toEqual([
                {
                    id: 'T_20',
                    name: 'Tripod',
                    price: 1498,
                    priceWithTax: 1798,
                    sku: 'B00XI87KV8',
                },
            ]);
        });

        it('returns variants for particular product by id', async () => {
            const { productVariants } = await adminClient.query(getProductVariantListDocument, {
                options: {
                    take: 3,
                    sort: {
                        price: SortOrder.ASC,
                    },
                },
                productId: 'T_1',
            });

            expect(
                productVariants.items.map(i => pick(i, ['id', 'name', 'price', 'priceWithTax', 'sku'])),
            ).toEqual([
                {
                    id: 'T_1',
                    name: 'Laptop 13 inch 8GB',
                    price: 129900,
                    priceWithTax: 155880,
                    sku: 'L2201308',
                },
                {
                    id: 'T_2',
                    name: 'Laptop 15 inch 8GB',
                    price: 139900,
                    priceWithTax: 167880,
                    sku: 'L2201508',
                },
                {
                    id: 'T_3',
                    name: 'Laptop 13 inch 16GB',
                    priceWithTax: 263880,
                    price: 219900,
                    sku: 'L2201316',
                },
            ]);
        });
    });

    describe('productVariant query', () => {
        it('by id', async () => {
            const { productVariant } = await adminClient.query(getProductVariantDocument, {
                id: 'T_1',
            });

            expect(productVariant?.id).toBe('T_1');
            expect(productVariant?.name).toBe('Laptop 13 inch 8GB');
        });
        it('returns null when id not found', async () => {
            const { productVariant } = await adminClient.query(getProductVariantDocument, {
                id: 'T_999',
            });

            expect(productVariant).toBeNull();
        });
    });

    describe('product mutation', () => {
        let newTranslatedProduct: ResultOf<typeof productWithVariantsFragment>;
        let newProduct: ResultOf<typeof productWithVariantsFragment>;
        let newProductWithAssets: ResultOf<typeof productWithVariantsFragment>;

        it('createProduct creates a new Product', async () => {
            const result = await adminClient.query(createProductDocument, {
                input: {
                    translations: [
                        {
                            languageCode: LanguageCode.en,
                            name: 'en Baked Potato',
                            slug: 'en Baked Potato',
                            description: 'A baked potato',
                        },
                        {
                            languageCode: LanguageCode.de,
                            name: 'de Baked Potato',
                            slug: 'de-baked-potato',
                            description: 'Eine baked Erdapfel',
                        },
                    ],
                },
            });
            expect(omit(result.createProduct, ['translations'])).toMatchSnapshot();
            expect(result.createProduct.translations.map(t => t.description).sort()).toEqual([
                'A baked potato',
                'Eine baked Erdapfel',
            ]);
            newTranslatedProduct = result.createProduct;
        });

        it('createProduct creates a new Product with assets', async () => {
            const assetsResult = await adminClient.query(getAssetListDocument);
            const assetIds = assetsResult.assets.items.slice(0, 2).map(a => a.id);
            const featuredAssetId = assetsResult.assets.items[0].id;

            const result = await adminClient.query(createProductDocument, {
                input: {
                    assetIds,
                    featuredAssetId,
                    translations: [
                        {
                            languageCode: LanguageCode.en,
                            name: 'en Has Assets',
                            slug: 'en-has-assets',
                            description: 'A product with assets',
                        },
                    ],
                },
            });
            expect(result.createProduct.assets.map(a => a.id)).toEqual(assetIds);
            expect(result.createProduct.featuredAsset).toBeDefined();
            expect(result.createProduct.featuredAsset?.id).toBe(featuredAssetId);
            newProductWithAssets = result.createProduct;
        });

        it('createProduct creates a disabled Product', async () => {
            const result = await adminClient.query(createProductDocument, {
                input: {
                    enabled: false,
                    translations: [
                        {
                            languageCode: LanguageCode.en,
                            name: 'en Small apple',
                            slug: 'en-small-apple',
                            description: 'A small apple',
                        },
                    ],
                },
            });
            expect(result.createProduct.enabled).toBe(false);
            newProduct = result.createProduct;
        });

        it('updateProduct updates a Product', async () => {
            const result = await adminClient.query(updateProductDocument, {
                input: {
                    id: newProduct.id,
                    translations: [
                        {
                            languageCode: LanguageCode.en,
                            name: 'en Mashed Potato',
                            slug: 'en-mashed-potato',
                            description: 'A blob of mashed potato',
                        },
                        {
                            languageCode: LanguageCode.de,
                            name: 'de Mashed Potato',
                            slug: 'de-mashed-potato',
                            description: 'Eine blob von gemashed Erdapfel',
                        },
                    ],
                },
            });
            expect(result.updateProduct.translations.map(t => t.description).sort()).toEqual([
                'A blob of mashed potato',
                'Eine blob von gemashed Erdapfel',
            ]);
        });

        it('slug is normalized to be url-safe', async () => {
            const result = await adminClient.query(updateProductDocument, {
                input: {
                    id: newProduct.id,
                    translations: [
                        {
                            languageCode: LanguageCode.en,
                            name: 'en Mashed Potato',
                            slug: 'A (very) nice potato!!',
                            description: 'A blob of mashed potato',
                        },
                    ],
                },
            });
            expect(result.updateProduct.slug).toBe('a-very-nice-potato');
        });

        it('create with duplicate slug is renamed to be unique', async () => {
            const result = await adminClient.query(createProductDocument, {
                input: {
                    translations: [
                        {
                            languageCode: LanguageCode.en,
                            name: 'Another baked potato',
                            slug: 'a-very-nice-potato',
                            description: 'Another baked potato but a bit different',
                        },
                    ],
                },
            });
            expect(result.createProduct.slug).toBe('a-very-nice-potato-2');
        });

        it('update with duplicate slug is renamed to be unique', async () => {
            const result = await adminClient.query(updateProductDocument, {
                input: {
                    id: newProduct.id,
                    translations: [
                        {
                            languageCode: LanguageCode.en,
                            name: 'Yet another baked potato',
                            slug: 'a-very-nice-potato-2',
                            description: 'Possibly the final baked potato',
                        },
                    ],
                },
            });
            expect(result.updateProduct.slug).toBe('a-very-nice-potato-3');
        });

        it('slug duplicate check does not include self', async () => {
            const result = await adminClient.query(updateProductDocument, {
                input: {
                    id: newProduct.id,
                    translations: [
                        {
                            languageCode: LanguageCode.en,
                            slug: 'a-very-nice-potato-3',
                        },
                    ],
                },
            });
            expect(result.updateProduct.slug).toBe('a-very-nice-potato-3');
        });

        it('updateProduct accepts partial input', async () => {
            const result = await adminClient.query(updateProductDocument, {
                input: {
                    id: newProduct.id,
                    translations: [
                        {
                            languageCode: LanguageCode.en,
                            name: 'en Very Mashed Potato',
                        },
                    ],
                },
            });
            expect(result.updateProduct.translations.length).toBe(2);
            const deTranslation = result.updateProduct.translations.find(
                t => t.languageCode === LanguageCode.de,
            );
            const enTranslation = result.updateProduct.translations.find(
                t => t.languageCode === LanguageCode.en,
            );
            expect(deTranslation).toBeDefined();
            expect(enTranslation).toBeDefined();
            expect(deTranslation?.name).toBe('de Mashed Potato');
            expect(enTranslation?.name).toBe('en Very Mashed Potato');
            expect(enTranslation?.description).toBe('Possibly the final baked potato');
        });

        it('updateProduct adds Assets to a product and sets featured asset', async () => {
            const assetsResult = await adminClient.query(getAssetListDocument);
            const assetIds = assetsResult.assets.items.map(a => a.id);
            const featuredAssetId = assetsResult.assets.items[2].id;

            const result = await adminClient.query(updateProductDocument, {
                input: {
                    id: newProduct.id,
                    assetIds,
                    featuredAssetId,
                },
            });
            expect(result.updateProduct.assets.map(a => a.id)).toEqual(assetIds);
            expect(result.updateProduct.featuredAsset).toBeDefined();
            expect(result.updateProduct.featuredAsset?.id).toBe(featuredAssetId);
        });

        it('updateProduct sets a featured asset', async () => {
            const productResult = await adminClient.query(getProductWithVariantsDocument, {
                id: newProduct.id,
            });
            productGuard.assertSuccess(productResult.product);
            const assets = productResult.product.assets;

            const result = await adminClient.query(updateProductDocument, {
                input: {
                    id: newProduct.id,
                    featuredAssetId: assets[0].id,
                },
            });
            expect(result.updateProduct.featuredAsset).toBeDefined();
            expect(result.updateProduct.featuredAsset?.id).toBe(assets[0].id);
        });

        it('updateProduct updates assets', async () => {
            const result = await adminClient.query(updateProductDocument, {
                input: {
                    id: newProduct.id,
                    featuredAssetId: 'T_1',
                    assetIds: ['T_1', 'T_2'],
                },
            });
            expect(result.updateProduct.assets.map(a => a.id)).toEqual(['T_1', 'T_2']);
        });

        it('updateProduct updates FacetValues', async () => {
            const result = await adminClient.query(updateProductDocument, {
                input: {
                    id: newProduct.id,
                    facetValueIds: ['T_1'],
                },
            });
            expect(result.updateProduct.facetValues.length).toEqual(1);
        });

        it(
            'updateProduct errors with an invalid productId',
            assertThrowsWithMessage(
                () =>
                    adminClient.query(updateProductDocument, {
                        input: {
                            id: '999',
                            translations: [
                                {
                                    languageCode: LanguageCode.en,
                                    name: 'en Mashed Potato',
                                    slug: 'en-mashed-potato',
                                    description: 'A blob of mashed potato',
                                },
                                {
                                    languageCode: LanguageCode.de,
                                    name: 'de Mashed Potato',
                                    slug: 'de-mashed-potato',
                                    description: 'Eine blob von gemashed Erdapfel',
                                },
                            ],
                        },
                    }),
                'No Product with the id "999" could be found',
            ),
        );

        it('addOptionGroupToProduct adds an option group', async () => {
            const optionGroup = await createOptionGroup('Quark-type', ['Charm', 'Strange']);
            const result = await adminClient.query(addOptionGroupToProductDocument, {
                optionGroupId: optionGroup.id,
                productId: newProduct.id,
            });
            expect(result.addOptionGroupToProduct.optionGroups.length).toBe(1);
            expect(result.addOptionGroupToProduct.optionGroups[0].id).toBe(optionGroup.id);

            // not really testing this, but just cleaning up for later tests
            const { removeOptionGroupFromProduct } = await adminClient.query(
                removeOptionGroupFromProductDocument,
                {
                    optionGroupId: optionGroup.id,
                    productId: newProduct.id,
                },
            );
            removeOptionGuard.assertSuccess(removeOptionGroupFromProduct);
        });

        it(
            'addOptionGroupToProduct errors with an invalid productId',
            assertThrowsWithMessage(
                () =>
                    adminClient.query(addOptionGroupToProductDocument, {
                        optionGroupId: 'T_1',
                        productId: 'T_999',
                    }),
                'No Product with the id "999" could be found',
            ),
        );

        it('addOptionGroupToProduct allows the same group on multiple products', async () => {
            const result = await adminClient.query(addOptionGroupToProductDocument, {
                optionGroupId: 'T_1',
                productId: 'T_2',
            });
            expect(result.addOptionGroupToProduct.optionGroups.map((g: any) => g.id)).toContain('T_1');

            // Clean up: remove the shared group from T_2
            const { removeOptionGroupFromProduct } = await adminClient.query(
                removeOptionGroupFromProductDocument,
                {
                    optionGroupId: 'T_1',
                    productId: 'T_2',
                    force: true,
                },
            );
            removeOptionGuard.assertSuccess(removeOptionGroupFromProduct);
        });

        it(
            'addOptionGroupToProduct errors with an invalid optionGroupId',
            assertThrowsWithMessage(
                () =>
                    adminClient.query(addOptionGroupToProductDocument, {
                        optionGroupId: '999',
                        productId: newProduct.id,
                    }),
                'No ProductOptionGroup with the id "999" could be found',
            ),
        );

        it('removeOptionGroupFromProduct removes an option group', async () => {
            const optionGroup = await createOptionGroup('Length', ['Short', 'Long']);
            const { addOptionGroupToProduct } = await adminClient.query(addOptionGroupToProductDocument, {
                optionGroupId: optionGroup.id,
                productId: newProductWithAssets.id,
            });
            expect(addOptionGroupToProduct.optionGroups.length).toBe(1);
            const { removeOptionGroupFromProduct } = await adminClient.query(
                removeOptionGroupFromProductDocument,
                {
                    optionGroupId: optionGroup.id,
                    productId: newProductWithAssets.id,
                },
            );
            removeOptionGuard.assertSuccess(removeOptionGroupFromProduct);

            expect(removeOptionGroupFromProduct?.id).toBe(newProductWithAssets.id);
            expect(removeOptionGroupFromProduct?.optionGroups.length).toBe(0);
        });

        it('removeOptionGroupFromProduct return error result if the optionGroup is being used by variants', async () => {
            const { removeOptionGroupFromProduct } = await adminClient.query(
                removeOptionGroupFromProductDocument,
                {
                    optionGroupId: 'T_3',
                    productId: 'T_2',
                },
            );
            removeOptionGuard.assertErrorResult(removeOptionGroupFromProduct);

            expect(removeOptionGroupFromProduct.message).toBe(
                'Cannot remove ProductOptionGroup "curvy-monitor-monitor-size" as it is used by 2 ProductVariants. Use the `force` argument to remove it anyway',
            );
            expect(removeOptionGroupFromProduct.errorCode).toBe(ErrorCode.PRODUCT_OPTION_IN_USE_ERROR);
            expect(removeOptionGroupFromProduct.optionGroupCode).toBe('curvy-monitor-monitor-size');
            expect(removeOptionGroupFromProduct.productVariantCount).toBe(2);
        });

        it('removeOptionGroupFromProduct succeeds if all related ProductVariants are also deleted', async () => {
            const { product } = await adminClient.query(getProductWithVariantsDocument, { id: 'T_2' });
            productGuard.assertSuccess(product);

            // Delete all variants for that product
            for (const variant of product.variants) {
                await adminClient.query(deleteProductVariantDocument, {
                    id: variant.id,
                });
            }

            const { removeOptionGroupFromProduct } = await adminClient.query(
                removeOptionGroupFromProductDocument,
                {
                    optionGroupId: product.optionGroups[0].id,
                    productId: product.id,
                },
            );

            removeOptionGuard.assertSuccess(removeOptionGroupFromProduct);
        });

        it(
            'removeOptionGroupFromProduct errors with an invalid productId',
            assertThrowsWithMessage(
                () =>
                    adminClient.query(removeOptionGroupFromProductDocument, {
                        optionGroupId: '1',
                        productId: '999',
                    }),
                'No Product with the id "999" could be found',
            ),
        );

        it(
            'removeOptionGroupFromProduct errors with an invalid optionGroupId',
            assertThrowsWithMessage(
                () =>
                    adminClient.query(removeOptionGroupFromProductDocument, {
                        optionGroupId: '999',
                        productId: newProduct.id,
                    }),
                'No ProductOptionGroup with the id "999" could be found',
            ),
        );

        describe('variants', () => {
            let variants: ResultOf<typeof createProductVariantsDocument>['createProductVariants'];
            let optionGroup2: NonNullable<ResultOf<typeof getOptionGroupDocument>['productOptionGroup']>;
            let optionGroup3: NonNullable<ResultOf<typeof getOptionGroupDocument>['productOptionGroup']>;

            beforeAll(async () => {
                optionGroup2 = await createOptionGroup('group-2', ['group2-option-1', 'group2-option-2']);
                optionGroup3 = await createOptionGroup('group-3', ['group3-option-1', 'group3-option-2']);
                await adminClient.query(addOptionGroupToProductDocument, {
                    optionGroupId: optionGroup2.id,
                    productId: newProduct.id,
                });
                await adminClient.query(addOptionGroupToProductDocument, {
                    optionGroupId: optionGroup3.id,
                    productId: newProduct.id,
                });
            });

            it(
                'createProductVariants throws if optionIds not compatible with product',
                assertThrowsWithMessage(async () => {
                    await adminClient.query(createProductVariantsDocument, {
                        input: [
                            {
                                productId: newProduct.id,
                                sku: 'PV1',
                                optionIds: [],
                                translations: [{ languageCode: LanguageCode.en, name: 'Variant 1' }],
                            },
                        ],
                    });
                }, 'ProductVariant optionIds must include one optionId from each of the groups: group-2, group-3'),
            );

            it(
                'createProductVariants throws if optionIds are duplicated',
                assertThrowsWithMessage(async () => {
                    await adminClient.query(createProductVariantsDocument, {
                        input: [
                            {
                                productId: newProduct.id,
                                sku: 'PV1',
                                optionIds: [optionGroup2.options[0].id, optionGroup2.options[1].id],
                                translations: [{ languageCode: LanguageCode.en, name: 'Variant 1' }],
                            },
                        ],
                    });
                }, 'ProductVariant optionIds must include one optionId from each of the groups: group-2, group-3'),
            );

            it('createProductVariants works', async () => {
                const { createProductVariants } = await adminClient.query(createProductVariantsDocument, {
                    input: [
                        {
                            productId: newProduct.id,
                            sku: 'PV1',
                            optionIds: [optionGroup2.options[0].id, optionGroup3.options[0].id],
                            translations: [{ languageCode: LanguageCode.en, name: 'Variant 1' }],
                        },
                    ],
                });
                const createdVariant = createProductVariants[0];
                variantGuard.assertSuccess(createdVariant);
                expect(createdVariant.name).toBe('Variant 1');
                expect(createdVariant.options.map(pick(['id']))).toContainEqual({
                    id: optionGroup2.options[0].id,
                });
                expect(createdVariant.options.map(pick(['id']))).toContainEqual({
                    id: optionGroup3.options[0].id,
                });
            });

            it('createProductVariants adds multiple variants at once', async () => {
                const { createProductVariants } = await adminClient.query(createProductVariantsDocument, {
                    input: [
                        {
                            productId: newProduct.id,
                            sku: 'PV2',
                            optionIds: [optionGroup2.options[1].id, optionGroup3.options[0].id],
                            translations: [{ languageCode: LanguageCode.en, name: 'Variant 2' }],
                        },
                        {
                            productId: newProduct.id,
                            sku: 'PV3',
                            optionIds: [optionGroup2.options[1].id, optionGroup3.options[1].id],
                            translations: [{ languageCode: LanguageCode.en, name: 'Variant 3' }],
                        },
                    ],
                });
                const variant2 = createProductVariants.find(v => v?.name === 'Variant 2');
                const variant3 = createProductVariants.find(v => v?.name === 'Variant 3');
                variantGuard.assertSuccess(variant2);
                variantGuard.assertSuccess(variant3);
                expect(variant2.options.map(pick(['id']))).toContainEqual({ id: optionGroup2.options[1].id });
                expect(variant2.options.map(pick(['id']))).toContainEqual({ id: optionGroup3.options[0].id });
                expect(variant3.options.map(pick(['id']))).toContainEqual({ id: optionGroup2.options[1].id });
                expect(variant3.options.map(pick(['id']))).toContainEqual({ id: optionGroup3.options[1].id });

                variants = createProductVariants.filter(notNullOrUndefined);
            });

            it(
                'createProductVariants throws if options combination already exists',
                assertThrowsWithMessage(async () => {
                    await adminClient.query(createProductVariantsDocument, {
                        input: [
                            {
                                productId: newProduct.id,
                                sku: 'PV2',
                                optionIds: [optionGroup2.options[0].id, optionGroup3.options[0].id],
                                translations: [{ languageCode: LanguageCode.en, name: 'Variant 2' }],
                            },
                        ],
                    });
                }, 'A ProductVariant with the selected options already exists: Variant 1'),
            );

            it('updateProductVariants updates variants', async () => {
                const firstVariant = variants[0];
                variantGuard.assertSuccess(firstVariant);
                const { updateProductVariants } = await adminClient.query(updateProductVariantsDocument, {
                    input: [
                        {
                            id: firstVariant.id,
                            translations: firstVariant.translations,
                            sku: 'ABC',
                            price: 432,
                        },
                    ],
                });
                const updatedVariant = updateProductVariants[0];
                updateVariantGuard.assertSuccess(updatedVariant);
                expect(updatedVariant.sku).toBe('ABC');
                expect(updatedVariant.price).toBe(432);
            });

            // https://github.com/vendurehq/vendure/issues/1101
            it('after update, the updatedAt should be modified', async () => {
                // Pause for a second to ensure the updatedAt date is more than 1s
                // later than the createdAt date, since sqlite does not seem to store
                // down to millisecond resolution.
                await new Promise(resolve => setTimeout(resolve, 1000));

                const firstVariant = variants[0];
                variantGuard.assertSuccess(firstVariant);
                const { updateProductVariants } = await adminClient.query(updateProductVariantsDocument, {
                    input: [
                        {
                            id: firstVariant.id,
                            translations: firstVariant.translations,
                            sku: 'ABCD',
                            price: 432,
                        },
                    ],
                });

                const updatedVariant = updateProductVariants.find(v => v?.id === firstVariant.id);

                expect(updatedVariant?.updatedAt).not.toBe(updatedVariant?.createdAt);
            });

            it('updateProductVariants updates assets', async () => {
                const firstVariant = variants[0];
                variantGuard.assertSuccess(firstVariant);
                const result = await adminClient.query(updateProductVariantsDocument, {
                    input: [
                        {
                            id: firstVariant.id,
                            assetIds: ['T_1', 'T_2'],
                            featuredAssetId: 'T_2',
                        },
                    ],
                });
                const updatedVariant = result.updateProductVariants[0];
                updateVariantGuard.assertSuccess(updatedVariant);
                expect(updatedVariant.assets.map(a => a.id)).toEqual(['T_1', 'T_2']);
                expect(updatedVariant.featuredAsset).toBeDefined();
                expect(updatedVariant.featuredAsset?.id).toBe('T_2');
            });

            it('updateProductVariants updates assets again', async () => {
                const firstVariant = variants[0];
                variantGuard.assertSuccess(firstVariant);
                const result = await adminClient.query(updateProductVariantsDocument, {
                    input: [
                        {
                            id: firstVariant.id,
                            assetIds: ['T_4', 'T_3'],
                            featuredAssetId: 'T_4',
                        },
                    ],
                });
                const updatedVariant = result.updateProductVariants[0];
                updateVariantGuard.assertSuccess(updatedVariant);
                expect(updatedVariant.assets.map(a => a.id)).toEqual(['T_4', 'T_3']);
                expect(updatedVariant.featuredAsset).toBeDefined();
                expect(updatedVariant.featuredAsset?.id).toBe('T_4');
            });

            it('updateProductVariants updates taxCategory and price', async () => {
                const firstVariant = variants[0];
                variantGuard.assertSuccess(firstVariant);
                const result = await adminClient.query(updateProductVariantsDocument, {
                    input: [
                        {
                            id: firstVariant.id,
                            price: 105,
                            taxCategoryId: 'T_2',
                        },
                    ],
                });
                const updatedVariant = result.updateProductVariants[0];
                updateVariantGuard.assertSuccess(updatedVariant);
                expect(updatedVariant.price).toBe(105);
                expect(updatedVariant.taxCategory.id).toBe('T_2');
            });

            it('updateProductVariants updates facetValues', async () => {
                const firstVariant = variants[0];
                variantGuard.assertSuccess(firstVariant);
                const result = await adminClient.query(updateProductVariantsDocument, {
                    input: [
                        {
                            id: firstVariant.id,
                            facetValueIds: ['T_1'],
                        },
                    ],
                });
                const updatedVariant = result.updateProductVariants[0];
                updateVariantGuard.assertSuccess(updatedVariant);
                expect(updatedVariant.facetValues.length).toBe(1);
                expect(updatedVariant.facetValues[0].id).toBe('T_1');
            });

            it('updateProductVariants throws with an invalid variant id', async () => {
                const firstVariant = variants[0];
                variantGuard.assertSuccess(firstVariant);
                await expect(
                    adminClient.query(updateProductVariantsDocument, {
                        input: [
                            {
                                id: 'T_999',
                                translations: firstVariant.translations,
                                sku: 'ABC',
                                price: 432,
                            },
                        ],
                    }),
                ).rejects.toThrow('No ProductVariant with the id "999" could be found');
            });

            describe('adding options to existing variants', () => {
                let variantToModify: NonNullable<
                    ResultOf<typeof createProductVariantsDocument>['createProductVariants'][number]
                >;
                let initialOptionIds: string[];
                let newOptionGroup: ResultOf<
                    typeof createProductOptionGroupDocument
                >['createProductOptionGroup'];

                beforeAll(() => {
                    const firstVariant = variants[0];
                    expect(firstVariant).toBeDefined();
                    variantToModify = firstVariant as typeof variantToModify;
                    initialOptionIds = variantToModify.options.map(o => o.id);
                });
                it('assert initial state', async () => {
                    expect(variantToModify.options.map(o => o.code)).toEqual([
                        'group2-option-2',
                        'group3-option-1',
                    ]);
                });

                it(
                    'passing optionIds from an invalid OptionGroup throws',
                    assertThrowsWithMessage(async () => {
                        await adminClient.query(updateProductVariantsDocument, {
                            input: [
                                {
                                    id: variantToModify.id,
                                    optionIds: [...variantToModify.options.map(o => o.id), 'T_1'],
                                },
                            ],
                        });
                    }, 'ProductVariant optionIds must include one optionId from each of the groups: group-2, group-3'),
                );

                it('passing optionIds that match an existing variant should not throw', async () => {
                    const { updateProductVariants } = await adminClient.query(updateProductVariantsDocument, {
                        input: [
                            {
                                id: variantToModify.id,
                                optionIds: variantToModify.options.map(o => o.id),
                                sku: 'ABC',
                                price: 432,
                            },
                        ],
                    });
                    const updatedVariant = updateProductVariants[0];
                    updateVariantGuard.assertSuccess(updatedVariant);
                    expect(updatedVariant.sku).toBe('ABC');
                    expect(updatedVariant.price).toBe(432);
                });

                it('addOptionGroupToProduct and then update existing ProductVariant with a new option', async () => {
                    const optionGroup4 = await createOptionGroup('group-4', [
                        'group4-option-1',
                        'group4-option-2',
                    ]);
                    newOptionGroup = optionGroup4;
                    const result = await adminClient.query(addOptionGroupToProductDocument, {
                        optionGroupId: optionGroup4.id,
                        productId: newProduct.id,
                    });
                    expect(result.addOptionGroupToProduct.optionGroups.length).toBe(3);
                    expect(result.addOptionGroupToProduct.optionGroups[2].id).toBe(optionGroup4.id);

                    const { updateProductVariants } = await adminClient.query(updateProductVariantsDocument, {
                        input: [
                            {
                                id: variantToModify.id,
                                optionIds: [
                                    ...variantToModify.options.map(o => o.id),
                                    optionGroup4.options[0].id,
                                ],
                            },
                        ],
                    });

                    const updatedVariant = updateProductVariants[0];
                    updateVariantGuard.assertSuccess(updatedVariant);
                    expect(updatedVariant.options.map(o => o.code)).toEqual([
                        'group2-option-2',
                        'group3-option-1',
                        'group4-option-1',
                    ]);
                });

                it('removeOptionGroup fails because option is in use', async () => {
                    const { removeOptionGroupFromProduct } = await adminClient.query(
                        removeOptionGroupFromProductDocument,
                        {
                            optionGroupId: newOptionGroup.id,
                            productId: newProduct.id,
                        },
                    );
                    removeOptionGuard.assertErrorResult(removeOptionGroupFromProduct);

                    expect(removeOptionGroupFromProduct.message).toBe(
                        'Cannot remove ProductOptionGroup "group-4" as it is used by 3 ProductVariants. Use the `force` argument to remove it anyway',
                    );
                });

                it('removeOptionGroup with force argument', async () => {
                    const { removeOptionGroupFromProduct } = await adminClient.query(
                        removeOptionGroupFromProductDocument,
                        {
                            optionGroupId: newOptionGroup.id,
                            productId: newProduct.id,
                            force: true,
                        },
                    );
                    removeOptionGuard.assertSuccess(removeOptionGroupFromProduct);

                    expect(removeOptionGroupFromProduct?.optionGroups.length).toBe(2);

                    const { product } = await adminClient.query(getProductWithVariantsDocument, {
                        id: newProduct.id,
                    });
                    productGuard.assertSuccess(product);
                    function assertNoOptionGroup(
                        variant: ResultOf<typeof productVariantFragment>,
                        optionGroupId: string,
                    ) {
                        expect(variant.options.map(o => o.groupId).every(id => id !== optionGroupId)).toBe(
                            true,
                        );
                    }
                    assertNoOptionGroup(product.variants[0], newOptionGroup.id);
                    assertNoOptionGroup(product.variants[1], newOptionGroup.id);
                    assertNoOptionGroup(product.variants[2], newOptionGroup.id);
                });
            });

            let deletedVariant: ResultOf<typeof productVariantFragment>;

            it('deleteProductVariant', async () => {
                const result1 = await adminClient.query(getProductWithVariantsDocument, {
                    id: newProduct.id,
                });
                productGuard.assertSuccess(result1.product);
                const sortedVariantIds = result1.product.variants.map(v => v.id).sort();
                expect(sortedVariantIds).toEqual(['T_35', 'T_36', 'T_37']);

                const { deleteProductVariant } = await adminClient.query(deleteProductVariantDocument, {
                    id: sortedVariantIds[0],
                });

                expect(deleteProductVariant.result).toBe(DeletionResult.DELETED);

                const result2 = await adminClient.query(getProductWithVariantsDocument, {
                    id: newProduct.id,
                });
                productGuard.assertSuccess(result2.product);
                expect(result2.product.variants.map(v => v.id).sort()).toEqual(['T_36', 'T_37']);

                const foundVariant = result1.product.variants.find(v => v.id === 'T_35');
                variantGuard.assertSuccess(foundVariant);
                deletedVariant = foundVariant;
            });

            /** Testing https://github.com/vendurehq/vendure/issues/412 **/
            it('createProductVariants ignores deleted variants when checking for existing combinations', async () => {
                const { createProductVariants } = await adminClient.query(createProductVariantsDocument, {
                    input: [
                        {
                            productId: newProduct.id,
                            sku: 'RE1',
                            optionIds: [deletedVariant.options[0].id, deletedVariant.options[1].id],
                            translations: [{ languageCode: LanguageCode.en, name: 'Re-created Variant' }],
                        },
                    ],
                });

                expect(createProductVariants.length).toBe(1);
                const createdVariant = createProductVariants[0];
                variantGuard.assertSuccess(createdVariant);
                expect(createdVariant.options.map(o => o.code).sort()).toEqual(
                    deletedVariant.options.map(o => o.code).sort(),
                );
            });

            // https://github.com/vendurehq/vendure/issues/980
            it('creating variants in a non-default language', async () => {
                const { createProduct } = await adminClient.query(createProductDocument, {
                    input: {
                        translations: [
                            {
                                languageCode: LanguageCode.de,
                                name: 'Ananas',
                                slug: 'ananas',
                                description: 'Yummy Ananas',
                            },
                        ],
                    },
                });

                const { createProductVariants } = await adminClient.query(createProductVariantsDocument, {
                    input: [
                        {
                            productId: createProduct.id,
                            sku: 'AN1110111',
                            optionIds: [],
                            translations: [{ languageCode: LanguageCode.de, name: 'Ananas Klein' }],
                        },
                    ],
                });

                expect(createProductVariants.length).toBe(1);
                expect(createProductVariants[0]?.name).toBe('Ananas Klein');

                const { product } = await adminClient.query(
                    getProductWithVariantsDocument,
                    {
                        id: createProduct.id,
                    },
                    { languageCode: LanguageCode.en },
                );

                expect(product?.variants.length).toBe(1);
            });

            // https://github.com/vendurehq/vendure/issues/1631
            describe('changing the Channel default language', () => {
                let productId: string;

                function getProductWithVariantsInLanguage(
                    id: string,
                    languageCode: LanguageCode,
                    variantListOptions?: VariablesOf<
                        typeof getProductWithVariantListDocument
                    >['variantListOptions'],
                ) {
                    return adminClient.query(
                        getProductWithVariantListDocument,
                        { id, variantListOptions },
                        { languageCode },
                    );
                }

                beforeAll(async () => {
                    await adminClient.query(updateGlobalSettingsDocument, {
                        input: {
                            availableLanguages: [LanguageCode.en, LanguageCode.de],
                        },
                    });
                    const { createProduct } = await adminClient.query(createProductDocument, {
                        input: {
                            translations: [
                                {
                                    languageCode: LanguageCode.en,
                                    name: 'Bottle',
                                    slug: 'bottle',
                                    description: 'A container for liquids',
                                },
                            ],
                        },
                    });

                    productId = createProduct.id;
                    await adminClient.query(createProductVariantsDocument, {
                        input: [
                            {
                                productId,
                                sku: 'BOTTLE111',
                                optionIds: [],
                                translations: [{ languageCode: LanguageCode.en, name: 'Bottle' }],
                            },
                        ],
                    });
                });

                afterAll(async () => {
                    // Restore the default language to English for the subsequent tests
                    await adminClient.query(updateChannelDocument, {
                        input: {
                            id: 'T_1',
                            defaultLanguageCode: LanguageCode.en,
                        },
                    });
                });

                it('returns all variants', async () => {
                    const { product: product1 } = await adminClient.query(
                        getProductWithVariantsDocument,
                        {
                            id: productId,
                        },
                        { languageCode: LanguageCode.en },
                    );
                    expect(product1?.variants.length).toBe(1);

                    // Change the default language of the channel to "de"
                    const { updateChannel } = await adminClient.query(updateChannelDocument, {
                        input: {
                            id: 'T_1',
                            defaultLanguageCode: LanguageCode.de,
                        },
                    });
                    updateChannelGuard.assertSuccess(updateChannel);
                    expect((updateChannel as any).defaultLanguageCode).toBe(LanguageCode.de);

                    // Fetch the product in en, it should still return 1 variant
                    const { product: product2 } = await getProductWithVariantsInLanguage(
                        productId,
                        LanguageCode.en,
                    );
                    expect(product2?.variantList.items.length).toBe(1);

                    // Fetch the product in de, it should still return 1 variant
                    const { product: product3 } = await getProductWithVariantsInLanguage(
                        productId,
                        LanguageCode.de,
                    );
                    expect(product3?.variantList.items.length).toBe(1);
                });

                it('returns all variants when sorting on variant name', async () => {
                    // Fetch the product in en, it should still return 1 variant
                    const { product: product1 } = await getProductWithVariantsInLanguage(
                        productId,
                        LanguageCode.en,
                        { sort: { name: SortOrder.ASC } },
                    );
                    expect(product1?.variantList.items.length).toBe(1);

                    // Fetch the product in de, it should still return 1 variant
                    const { product: product2 } = await getProductWithVariantsInLanguage(
                        productId,
                        LanguageCode.de,
                        { sort: { name: SortOrder.ASC } },
                    );
                    expect(product2?.variantList.items.length).toBe(1);
                });
            });
        });
    });

    describe('deletion', () => {
        let allProducts: ResultOf<typeof getProductListDocument>['products']['items'];
        let productToDelete: NonNullable<ResultOf<typeof getProductWithVariantsDocument>['product']>;

        beforeAll(async () => {
            const result = await adminClient.query(getProductListDocument, {
                options: {
                    sort: {
                        id: SortOrder.ASC,
                    },
                },
            });
            allProducts = result.products.items;
        });

        it('deletes a product', async () => {
            const { product } = await adminClient.query(getProductWithVariantsDocument, {
                id: allProducts[0].id,
            });
            productGuard.assertSuccess(product);
            const result = await adminClient.query(deleteProductDocument, { id: product.id });

            expect(result.deleteProduct).toEqual({ result: DeletionResult.DELETED });

            productToDelete = product;
        });

        it('cannot get a deleted product', async () => {
            const { product } = await adminClient.query(getProductWithVariantsDocument, {
                id: productToDelete.id,
            });

            expect(product).toBe(null);
        });

        // https://github.com/vendurehq/vendure/issues/1096
        it('variants of deleted product are also deleted', async () => {
            for (const variant of productToDelete.variants) {
                const { productVariant } = await adminClient.query(getProductVariantDocument, {
                    id: variant.id,
                });

                expect(productVariant).toBe(null);
            }
        });

        it('deleted product omitted from list', async () => {
            const result = await adminClient.query(getProductListDocument);

            expect(result.products.items.length).toBe(allProducts.length - 1);
            expect(result.products.items.map(c => c.id).includes(productToDelete.id)).toBe(false);
        });

        it(
            'updateProduct throws for deleted product',
            assertThrowsWithMessage(
                () =>
                    adminClient.query(updateProductDocument, {
                        input: {
                            id: productToDelete.id,
                            facetValueIds: ['T_1'],
                        },
                    }),
                'No Product with the id "1" could be found',
            ),
        );

        it(
            'addOptionGroupToProduct throws for deleted product',
            assertThrowsWithMessage(
                () =>
                    adminClient.query(addOptionGroupToProductDocument, {
                        optionGroupId: 'T_1',
                        productId: productToDelete.id,
                    }),
                'No Product with the id "1" could be found',
            ),
        );

        it(
            'removeOptionGroupToProduct throws for deleted product',
            assertThrowsWithMessage(
                () =>
                    adminClient.query(removeOptionGroupFromProductDocument, {
                        optionGroupId: 'T_1',
                        productId: productToDelete.id,
                    }),
                'No Product with the id "1" could be found',
            ),
        );

        // https://github.com/vendurehq/vendure/issues/558
        it('slug of a deleted product can be re-used', async () => {
            const result = await adminClient.query(createProductDocument, {
                input: {
                    translations: [
                        {
                            languageCode: LanguageCode.en,
                            name: 'Product reusing deleted slug',
                            slug: productToDelete.slug,
                            description: 'stuff',
                        },
                    ],
                },
            });
            expect(result.createProduct.slug).toBe(productToDelete.slug);
        });

        // https://github.com/vendurehq/vendure/issues/1505
        it('attempting to re-use deleted slug twice is not allowed', async () => {
            const result = await adminClient.query(createProductDocument, {
                input: {
                    translations: [
                        {
                            languageCode: LanguageCode.en,
                            name: 'Product reusing deleted slug',
                            slug: productToDelete.slug,
                            description: 'stuff',
                        },
                    ],
                },
            });

            expect(result.createProduct.slug).not.toBe(productToDelete.slug);
            expect(result.createProduct.slug).toBe('laptop-2');
        });

        // https://github.com/vendurehq/vendure/issues/800
        it('product can be fetched by slug of a deleted product', async () => {
            const { product } = await adminClient.query(getProductSimpleDocument, {
                slug: productToDelete.slug,
            });
            productQueryGuard.assertSuccess(product);
            expect(product.slug).toBe(productToDelete.slug);
        });
    });

    async function createOptionGroup(name: string, options: string[]) {
        const { createProductOptionGroup } = await adminClient.query(createProductOptionGroupDocument, {
            input: {
                code: name.toLowerCase(),
                translations: [{ languageCode: LanguageCode.en, name }],
                options: options.map(option => ({
                    code: option.toLowerCase(),
                    translations: [{ languageCode: LanguageCode.en, name: option }],
                })),
            },
        });
        return createProductOptionGroup;
    }
});
