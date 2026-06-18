/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { LanguageCode } from '@vendure/common/lib/generated-types';
import { facetValueCollectionFilter } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { disableProductDocument } from './graphql/admin-definitions';
import { ResultOf } from './graphql/graphql-admin';
import {
    createCollectionDocument,
    createFacetDocument,
    getFacetListDocument,
    getProductSimpleDocument,
    getProductWithVariantsDocument,
    updateCollectionDocument,
    updateProductDocument,
    updateProductVariantsDocument,
} from './graphql/shared-definitions';
import {
    getCollectionListDocument,
    getCollectionShopDocument,
    getCollectionVariantsDocument,
    getProduct1Document,
    getProduct2VariantsDocument,
    getProductCollectionDocument,
    getProductFacetValuesDocument,
    getProductsTake3Document,
    getProductVariantFacetValuesDocument,
} from './graphql/shop-definitions';
import { assertThrowsWithMessage } from './utils/assert-throws-with-message';
import { awaitRunningJobs } from './utils/await-running-jobs';

describe('Shop catalog', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(testConfig());

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

    describe('products', () => {
        beforeAll(async () => {
            // disable the first product
            await adminClient.query(disableProductDocument, {
                id: 'T_1',
            });

            const monitorProduct = await adminClient.query(getProductWithVariantsDocument, {
                id: 'T_2',
            });
            if (monitorProduct.product) {
                await adminClient.query(updateProductVariantsDocument, {
                    input: [
                        {
                            id: monitorProduct.product.variants[0].id,
                            enabled: false,
                        },
                    ],
                });
            }
        });

        it('products list omits disabled products', async () => {
            const result = await shopClient.query(getProductsTake3Document);

            expect(result.products.items.map(item => item.id).sort()).toEqual(['T_2', 'T_3', 'T_4']);
        });

        it('by id', async () => {
            const { product } = await shopClient.query(getProductSimpleDocument, { id: 'T_2' });

            if (!product) {
                fail('Product not found');
                return;
            }
            expect(product.id).toBe('T_2');
        });

        it('by slug', async () => {
            const { product } = await shopClient.query(getProductSimpleDocument, { slug: 'curvy-monitor' });

            if (!product) {
                fail('Product not found');
                return;
            }
            expect(product.slug).toBe('curvy-monitor');
        });

        it(
            'throws if neither id nor slug provided',
            assertThrowsWithMessage(async () => {
                await shopClient.query(getProductSimpleDocument, {});
            }, 'Either the Product id or slug must be provided'),
        );

        it('product returns null for disabled product', async () => {
            const result = await shopClient.query(getProduct1Document);

            expect(result.product).toBeNull();
        });

        it('omits disabled variants from product response', async () => {
            const result = await shopClient.query(getProduct2VariantsDocument);

            expect(result.product!.variants).toEqual([{ id: 'T_6', name: 'Curvy Monitor 27 inch' }]);
        });
    });

    describe('facets', () => {
        let facetValue: ResultOf<typeof createFacetDocument>['createFacet']['values'][number];

        beforeAll(async () => {
            const result = await adminClient.query(createFacetDocument, {
                input: {
                    code: 'profit-margin',
                    isPrivate: true,
                    translations: [{ languageCode: LanguageCode.en, name: 'Profit Margin' }],
                    values: [
                        {
                            code: 'massive',
                            translations: [{ languageCode: LanguageCode.en, name: 'massive' }],
                        },
                    ],
                },
            });
            facetValue = result.createFacet.values[0];

            await adminClient.query(updateProductDocument, {
                input: {
                    id: 'T_2',
                    facetValueIds: [facetValue.id],
                },
            });

            await adminClient.query(updateProductVariantsDocument, {
                input: [
                    {
                        id: 'T_6',
                        facetValueIds: [facetValue.id],
                    },
                ],
            });
        });

        it('omits private Product.facetValues', async () => {
            const result = await shopClient.query(getProductFacetValuesDocument, {
                id: 'T_2',
            });

            expect(result.product!.facetValues.map(fv => fv.name)).toEqual([]);
        });

        it('omits private ProductVariant.facetValues', async () => {
            const result = await shopClient.query(getProductVariantFacetValuesDocument, {
                id: 'T_2',
            });

            expect(result.product!.variants[0].facetValues.map(fv => fv.name)).toEqual([]);
        });
    });

    describe('collections', () => {
        let collection: ResultOf<typeof createCollectionDocument>['createCollection'];

        async function createNewCollection(name: string, isPrivate: boolean, parentId?: string) {
            return await adminClient.query(createCollectionDocument, {
                input: {
                    translations: [
                        {
                            languageCode: LanguageCode.en,
                            name,
                            description: '',
                            slug: name,
                        },
                    ],
                    isPrivate,
                    parentId,
                    filters: [],
                },
            });
        }

        beforeAll(async () => {
            const result = await adminClient.query(getFacetListDocument);
            const category = result.facets.items[0];
            const sportsEquipment = category.values.find(v => v.code === 'sports-equipment')!;
            const { createCollection } = await adminClient.query(createCollectionDocument, {
                input: {
                    filters: [
                        {
                            code: facetValueCollectionFilter.code,
                            arguments: [
                                {
                                    name: 'facetValueIds',
                                    value: `["${sportsEquipment.id}"]`,
                                },
                                {
                                    name: 'containsAny',
                                    value: 'false',
                                },
                            ],
                        },
                    ],
                    translations: [
                        {
                            languageCode: LanguageCode.en,
                            name: 'My Collection',
                            description: '',
                            slug: 'my-collection',
                        },
                    ],
                },
            });
            collection = createCollection;
            await awaitRunningJobs(adminClient);
        });

        it('returns collection with variants', async () => {
            const result = await shopClient.query(getCollectionVariantsDocument, { id: collection.id });
            expect(result.collection!.productVariants.items).toEqual([
                { id: 'T_22', name: 'Road Bike' },
                { id: 'T_23', name: 'Skipping Rope' },
                { id: 'T_24', name: 'Boxing Gloves' },
                { id: 'T_25', name: 'Tent' },
                { id: 'T_26', name: 'Cruiser Skateboard' },
                { id: 'T_27', name: 'Football' },
                { id: 'T_28', name: 'Running Shoe Size 40' },
                { id: 'T_29', name: 'Running Shoe Size 42' },
                { id: 'T_30', name: 'Running Shoe Size 44' },
                { id: 'T_31', name: 'Running Shoe Size 46' },
            ]);
        });

        it('collection by slug', async () => {
            const result = await shopClient.query(getCollectionVariantsDocument, { slug: collection.slug });
            expect(result.collection?.id).toBe(collection.id);
        });

        it('omits variants from disabled products', async () => {
            await adminClient.query(disableProductDocument, {
                id: 'T_17',
            });
            await awaitRunningJobs(adminClient);

            const result = await shopClient.query(getCollectionVariantsDocument, { id: collection.id });
            expect(result.collection!.productVariants.items).toEqual([
                { id: 'T_22', name: 'Road Bike' },
                { id: 'T_23', name: 'Skipping Rope' },
                { id: 'T_24', name: 'Boxing Gloves' },
                { id: 'T_25', name: 'Tent' },
                { id: 'T_26', name: 'Cruiser Skateboard' },
                { id: 'T_27', name: 'Football' },
            ]);
        });

        it('omits disabled product variants', async () => {
            await adminClient.query(updateProductVariantsDocument, {
                input: [{ id: 'T_22', enabled: false }],
            });
            await awaitRunningJobs(adminClient);

            const result = await shopClient.query(getCollectionVariantsDocument, { id: collection.id });
            expect(result.collection!.productVariants.items).toEqual([
                { id: 'T_23', name: 'Skipping Rope' },
                { id: 'T_24', name: 'Boxing Gloves' },
                { id: 'T_25', name: 'Tent' },
                { id: 'T_26', name: 'Cruiser Skateboard' },
                { id: 'T_27', name: 'Football' },
            ]);
        });

        it('collection list', async () => {
            const result = await shopClient.query(getCollectionListDocument);

            expect(result.collections.items).toEqual([
                { id: 'T_2', name: 'Plants' },
                { id: 'T_3', name: 'My Collection' },
            ]);
        });

        it('omits private collections', async () => {
            await adminClient.query(updateCollectionDocument, {
                input: {
                    id: collection.id,
                    isPrivate: true,
                },
            });
            await awaitRunningJobs(adminClient);
            const result = await shopClient.query(getCollectionListDocument);

            expect(result.collections.items).toEqual([{ id: 'T_2', name: 'Plants' }]);
        });

        it('returns null for private collection', async () => {
            const result = await shopClient.query(getCollectionVariantsDocument, { id: collection.id });

            expect(result.collection).toBeNull();
        });

        it('product.collections list omits private collections', async () => {
            const result = await shopClient.query(getProductCollectionDocument);

            expect(result.product!.collections).toEqual([]);
        });

        it('private children not returned in Shop API', async () => {
            const { createCollection: parent } = await createNewCollection('public-parent', false);
            const { createCollection: child } = await createNewCollection('private-child', true, parent.id);

            const result = await shopClient.query(getCollectionShopDocument, {
                id: parent.id,
            });

            expect(result.collection?.children).toEqual([]);
        });

        it('private parent not returned in Shop API', async () => {
            const { createCollection: parent } = await createNewCollection('private-parent', true);
            const { createCollection: child } = await createNewCollection('public-child', false, parent.id);

            const result = await shopClient.query(getCollectionShopDocument, {
                id: child.id,
            });

            expect(result.collection?.parent).toBeNull();
        });
    });
});
