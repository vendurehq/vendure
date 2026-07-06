/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { LanguageCode, LogicalOperator } from '@vendure/common/lib/generated-types';
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
    createProductDocument,
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
    getCollectionsWithOptionsDocument,
    getCollectionVariantsDocument,
    getFacetsWithOptionsDocument,
    getProduct1Document,
    getProduct2VariantsDocument,
    getProductCollectionDocument,
    getProductFacetValuesDocument,
    getProductsTake3Document,
    getProductsWithOptionsDocument,
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

    // The Shop API injects mandatory guard filters (Product.enabled = true,
    // Collection/Facet.isPrivate = false). These guards must always be applied, regardless of
    // the caller's filterOperator.
    describe('list query guard filters are always applied', () => {
        let disabledProductId: string;
        let privateCollectionId: string;
        let privateFacetId: string;
        // A known-public collection/facet to OR alongside the private one, so the guard tests
        // assert the public entity is returned while the private one is dropped (non-vacuous).
        let publicCollectionId: string;
        let publicFacetId: string;

        beforeAll(async () => {
            const { createProduct } = await adminClient.query(createProductDocument, {
                input: {
                    enabled: false,
                    translations: [
                        {
                            languageCode: LanguageCode.en,
                            name: 'Secret Disabled Product',
                            slug: 'secret-disabled-product',
                            description: '',
                        },
                    ],
                },
            });
            disabledProductId = createProduct.id;

            const { createCollection } = await adminClient.query(createCollectionDocument, {
                input: {
                    isPrivate: true,
                    filters: [],
                    translations: [
                        {
                            languageCode: LanguageCode.en,
                            name: 'Secret Private Collection',
                            slug: 'secret-private-collection',
                            description: '',
                        },
                    ],
                },
            });
            privateCollectionId = createCollection.id;

            const { createFacet } = await adminClient.query(createFacetDocument, {
                input: {
                    code: 'secret-private-facet',
                    isPrivate: true,
                    translations: [{ languageCode: LanguageCode.en, name: 'Secret Private Facet' }],
                    values: [],
                },
            });
            privateFacetId = createFacet.id;

            await awaitRunningJobs(adminClient);

            // The Shop API only returns public entities, so the first item is guaranteed public.
            const { collections } = await shopClient.query(getCollectionsWithOptionsDocument, {
                options: { take: 1 },
            });
            publicCollectionId = collections.items[0].id;
            const { facets } = await shopClient.query(getFacetsWithOptionsDocument, {
                options: { take: 1 },
            });
            publicFacetId = facets.items[0].id;
        });

        it('products: disabled products are excluded when filterOperator is OR', async () => {
            // OR a guard-violating clause (the disabled product) with a legitimate enabled product.
            // The guard must drop the disabled product while the enabled one (curvy-monitor = T_2)
            // is still returned — so the result is non-empty for the right reason, not vacuously.
            const result = await shopClient.query(getProductsWithOptionsDocument, {
                options: {
                    filterOperator: LogicalOperator.OR,
                    filter: { id: { eq: disabledProductId }, slug: { eq: 'curvy-monitor' } },
                },
            });

            expect(result.products.items.map(p => p.id)).toEqual(['T_2']);
            expect(result.products.items.map(p => p.id)).not.toContain(disabledProductId);
        });

        it('products: caller filter is still applied alongside the guard', async () => {
            // Ensures the guard does not swallow the caller's own filter (the guard is
            // AND-combined with it, not substituted for it).
            const result = await shopClient.query(getProductsWithOptionsDocument, {
                options: { filter: { id: { eq: 'T_2' } } },
            });

            expect(result.products.items.map(p => p.id)).toEqual(['T_2']);
        });

        it('products: OR semantics preserved across caller filter fields', async () => {
            // T_2 (curvy-monitor) and T_3 are both enabled. An OR across two fields must return
            // both, proving the guard is AND-combined with the caller's filter without downgrading
            // the caller's own OR to AND.
            const result = await shopClient.query(getProductsWithOptionsDocument, {
                options: {
                    filterOperator: LogicalOperator.OR,
                    filter: { slug: { eq: 'curvy-monitor' }, id: { eq: 'T_3' } },
                },
            });

            expect(result.products.items.map(p => p.id).sort()).toEqual(['T_2', 'T_3']);
        });

        it('products: disabled products are excluded with an _or filter block', async () => {
            // The guard must also hold when the caller embeds an _or group in the filter object
            // itself (rather than via filterOperator). OR the disabled product with an enabled one
            // so a passing result proves the guard removed only the disabled product.
            const result = await shopClient.query(getProductsWithOptionsDocument, {
                options: {
                    filter: { _or: [{ id: { eq: disabledProductId } }, { id: { eq: 'T_2' } }] },
                },
            });

            expect(result.products.items.map(p => p.id)).toEqual(['T_2']);
            expect(result.products.items.map(p => p.id)).not.toContain(disabledProductId);
        });

        it('collections: private collections are excluded when filterOperator is OR', async () => {
            // Request both the private and a public collection. The guard must drop the private one
            // while the public one is returned, so the result is non-empty for the right reason.
            const result = await shopClient.query(getCollectionsWithOptionsDocument, {
                options: {
                    filterOperator: LogicalOperator.OR,
                    filter: { id: { in: [privateCollectionId, publicCollectionId] } },
                },
            });

            const ids = result.collections.items.map(c => c.id);
            expect(ids).toContain(publicCollectionId);
            expect(ids).not.toContain(privateCollectionId);
        });

        it('facets: private facets are excluded when filterOperator is OR', async () => {
            // Request both the private and a public facet. The guard must drop the private one
            // while the public one is returned, so the result is non-empty for the right reason.
            const result = await shopClient.query(getFacetsWithOptionsDocument, {
                options: {
                    filterOperator: LogicalOperator.OR,
                    filter: { id: { in: [privateFacetId, publicFacetId] } },
                },
            });

            const ids = result.facets.items.map(f => f.id);
            expect(ids).toContain(publicFacetId);
            expect(ids).not.toContain(privateFacetId);
        });
    });
});
