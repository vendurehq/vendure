/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
    CurrencyCode,
    GlobalFlag,
    JobState,
    LanguageCode,
    LogicalOperator,
    SortOrder,
} from '@vendure/common/lib/generated-types';
import { pick } from '@vendure/common/lib/pick';
import {
    DefaultJobQueuePlugin,
    DefaultSearchPlugin,
    facetValueCollectionFilter,
    mergeConfig,
} from '@vendure/core';
import {
    createErrorResultGuard,
    createTestEnvironment,
    E2E_DEFAULT_CHANNEL_TOKEN,
    ErrorResultGuard,
    SimpleGraphQLClient,
} from '@vendure/testing';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import {
    reindexDocument,
    searchGetAssetsDocument,
    searchGetPricesDocument,
    searchProductsAdminDocument,
} from './graphql/admin-definitions';
import { channelFragment } from './graphql/fragments-admin';
import { FragmentOf, ResultOf, VariablesOf } from './graphql/graphql-admin';
import {
    assignProductToChannelDocument,
    assignProductVariantToChannelDocument,
    createChannelDocument,
    createCollectionDocument,
    createFacetDocument,
    createProductDocument,
    createProductVariantsDocument,
    deleteAssetDocument,
    deleteProductDocument,
    deleteProductVariantDocument,
    getRunningJobsDocument,
    removeProductFromChannelDocument,
    removeProductVariantFromChannelDocument,
    updateAssetDocument,
    updateChannelDocument,
    updateCollectionDocument,
    updateProductDocument,
    updateProductVariantsDocument,
    updateTaxRateDocument,
} from './graphql/shared-definitions';
import {
    searchCollectionsDocument,
    searchFacetValuesDocument,
    searchGetPricesShopDocument,
    searchProductsShopDocument,
} from './graphql/shop-definitions';
import { awaitRunningJobs } from './utils/await-running-jobs';

type SearchInput = VariablesOf<typeof searchProductsAdminDocument>['input'];

type SearchProductsShopInput = VariablesOf<typeof searchProductsShopDocument>['input'];
type SearchProductsShopQueryVariablesExt = {
    input: SearchProductsShopInput & {
        // This input field is dynamically added only when the `indexStockStatus` init option
        // is set to `true`, and therefore not included in the generated type. Therefore
        // we need to manually patch it here.
        inStock?: boolean;
    };
};

describe('Default search plugin', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            plugins: [DefaultSearchPlugin.init({ indexStockStatus: true }), DefaultJobQueuePlugin],
        }),
    );

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-default-search.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
        // We have extra time here because a lot of jobs are
        // triggered from all the product updates
        await awaitRunningJobs(adminClient, 10_000, 1000);
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await awaitRunningJobs(adminClient);
        await server.destroy();
    });

    function testProductsShop(input: SearchProductsShopQueryVariablesExt['input']) {
        return shopClient.query(searchProductsShopDocument, { input });
    }

    function testProductsAdmin(input: SearchInput) {
        return adminClient.query(searchProductsAdminDocument, { input });
    }

    type TestProducts = (
        input: SearchInput,
    ) => Promise<ResultOf<typeof searchProductsShopDocument> | ResultOf<typeof searchProductsAdminDocument>>;

    async function testGroupByProduct(testProducts: TestProducts) {
        const result = await testProducts({
            groupByProduct: true,
        });

        expect(result.search.totalItems).toBe(20);
    }

    async function testNoGrouping(testProducts: TestProducts) {
        const result = await testProducts({
            groupByProduct: false,
        });

        expect(result.search.totalItems).toBe(34);
    }

    async function testSortingWithGrouping(
        testProducts: TestProducts,
        sortBy: keyof NonNullable<SearchInput['sort']>,
    ) {
        const result = await testProducts({
            groupByProduct: true,
            sort: {
                [sortBy]: SortOrder.ASC,
            },
            take: 3,
        });

        const expected =
            sortBy === 'name'
                ? ['Bonsai Tree', 'Boxing Gloves', 'Camera Lens']
                : ['Skipping Rope', 'Tripod', 'Spiky Cactus'];

        expect(result.search.items.map(i => i.productName)).toEqual(expected);
    }

    async function testSortingNoGrouping(
        testProducts: TestProducts,
        sortBy: keyof NonNullable<SearchInput['sort']>,
    ) {
        const result = await testProducts({
            groupByProduct: false,
            sort: {
                [sortBy]: SortOrder.DESC,
            },
            take: 3,
        });

        const expected =
            sortBy === 'name'
                ? ['USB Cable', 'Tripod', 'Tent']
                : ['Road Bike', 'Laptop 15 inch 16GB', 'Laptop 13 inch 16GB'];

        expect(result.search.items.map(i => i.productVariantName)).toEqual(expected);
    }

    async function testMatchSearchTerm(testProducts: TestProducts) {
        const result = await testProducts({
            term: 'camera',
            groupByProduct: true,
            sort: {
                name: SortOrder.ASC,
            },
        });

        expect(result.search.items.map(i => i.productName)).toEqual([
            'Camera Lens',
            'Instant Camera',
            'Slr Camera',
        ]);
    }

    async function testMatchPartialSearchTerm(testProducts: TestProducts) {
        const result = await testProducts({
            term: 'lap',
            groupByProduct: true,
            sort: {
                name: SortOrder.ASC,
            },
        });

        expect(result.search.items.map(i => i.productName)).toEqual(['Laptop']);
    }

    async function testMatchFacetIdsAnd(testProducts: TestProducts) {
        const result = await testProducts({
            facetValueIds: ['T_1', 'T_2'],
            facetValueOperator: LogicalOperator.AND,
            groupByProduct: true,
        });

        expect(result.search.items.map(i => i.productName)).toEqual([
            'Laptop',
            'Curvy Monitor',
            'Gaming PC',
            'Hard Drive',
            'Clacky Keyboard',
            'USB Cable',
        ]);
    }

    async function testMatchFacetIdsOr(testProducts: TestProducts) {
        const result = await testProducts({
            facetValueIds: ['T_1', 'T_5'],
            facetValueOperator: LogicalOperator.OR,
            groupByProduct: true,
        });

        expect(result.search.items.map(i => i.productName)).toEqual([
            'Laptop',
            'Curvy Monitor',
            'Gaming PC',
            'Hard Drive',
            'Clacky Keyboard',
            'USB Cable',
            'Instant Camera',
            'Camera Lens',
            'Tripod',
            'Slr Camera',
            'Spiky Cactus',
            'Orchid',
            'Bonsai Tree',
        ]);
    }

    async function testMatchFacetValueFiltersAnd(testProducts: TestProducts) {
        const result = await testProducts({
            groupByProduct: true,
            facetValueFilters: [{ and: 'T_1' }, { and: 'T_2' }],
        });

        expect(result.search.items.map(i => i.productName)).toEqual([
            'Laptop',
            'Curvy Monitor',
            'Gaming PC',
            'Hard Drive',
            'Clacky Keyboard',
            'USB Cable',
        ]);
    }

    async function testMatchFacetValueFiltersOr(testProducts: TestProducts) {
        const result = await testProducts({
            groupByProduct: true,
            facetValueFilters: [{ or: ['T_1', 'T_5'] }],
        });

        expect(result.search.items.map(i => i.productName)).toEqual([
            'Laptop',
            'Curvy Monitor',
            'Gaming PC',
            'Hard Drive',
            'Clacky Keyboard',
            'USB Cable',
            'Instant Camera',
            'Camera Lens',
            'Tripod',
            'Slr Camera',
            'Spiky Cactus',
            'Orchid',
            'Bonsai Tree',
        ]);
    }

    async function testMatchFacetValueFiltersOrWithAnd(testProducts: TestProducts) {
        const result = await testProducts({
            groupByProduct: true,
            facetValueFilters: [{ and: 'T_1' }, { or: ['T_2', 'T_3'] }],
        });

        expect(result.search.items.map(i => i.productName)).toEqual([
            'Laptop',
            'Curvy Monitor',
            'Gaming PC',
            'Hard Drive',
            'Clacky Keyboard',
            'USB Cable',
            'Instant Camera',
            'Camera Lens',
            'Tripod',
            'Slr Camera',
        ]);
    }

    async function testMatchFacetValueFiltersWithFacetIdsOr(testProducts: TestProducts) {
        const result = await testProducts({
            facetValueIds: ['T_2', 'T_3'],
            facetValueOperator: LogicalOperator.OR,
            facetValueFilters: [{ and: 'T_1' }],
            groupByProduct: true,
        });

        expect(result.search.items.map(i => i.productName)).toEqual([
            'Laptop',
            'Curvy Monitor',
            'Gaming PC',
            'Hard Drive',
            'Clacky Keyboard',
            'USB Cable',
            'Instant Camera',
            'Camera Lens',
            'Tripod',
            'Slr Camera',
        ]);
    }

    async function testMatchFacetValueFiltersWithFacetIdsAnd(testProducts: TestProducts) {
        const result = await testProducts({
            facetValueIds: ['T_1'],
            facetValueFilters: [{ and: 'T_3' }],
            facetValueOperator: LogicalOperator.AND,
            groupByProduct: true,
        });

        expect(result.search.items.map(i => i.productName)).toEqual([
            'Instant Camera',
            'Camera Lens',
            'Tripod',
            'Slr Camera',
        ]);
    }

    async function testMatchCollectionId(testProducts: TestProducts) {
        const result = await testProducts({
            collectionId: 'T_2',
            groupByProduct: true,
        });

        expect(result.search.items.map(i => i.productName)).toEqual([
            'Spiky Cactus',
            'Orchid',
            'Bonsai Tree',
        ]);
    }

    async function testMatchCollectionSlug(testProducts: TestProducts) {
        const result = await testProducts({
            collectionSlug: 'plants',
            groupByProduct: true,
        });

        expect(result.search.items.map(i => i.productName)).toEqual([
            'Spiky Cactus',
            'Orchid',
            'Bonsai Tree',
        ]);
    }

    async function testMatchCollectionIds(testProducts: TestProducts) {
        const result = await testProducts({
            collectionIds: ['T_2', 'T_3'],
            groupByProduct: true,
        });

        // Should return products from both Plants (T_2) and Electronics (T_3) collections
        // Plants has 3 products in the default test data
        expect(result.search.items.length).toBeGreaterThanOrEqual(3);
        expect(result.search.totalItems).toBeGreaterThanOrEqual(3);

        const productNames = result.search.items.map(i => i.productName);

        // Verify that products from Plants collection are included
        expect(productNames).toContain('Bonsai Tree');
        expect(productNames).toContain('Orchid');
        expect(productNames).toContain('Spiky Cactus');
    }

    async function testMatchCollectionSlugs(testProducts: TestProducts) {
        const result = await testProducts({
            collectionSlugs: ['plants', 'electronics'],
            groupByProduct: true,
        });

        // Should return products from both Plants and Electronics collections
        // Plants has 3 products in the default test data
        expect(result.search.items.length).toBeGreaterThanOrEqual(3);
        expect(result.search.totalItems).toBeGreaterThanOrEqual(3);

        const productNames = result.search.items.map(i => i.productName);

        // Verify that products from Plants collection are included
        expect(productNames).toContain('Bonsai Tree');
        expect(productNames).toContain('Orchid');
        expect(productNames).toContain('Spiky Cactus');
    }

    async function testCollectionIdsEdgeCases(testProducts: TestProducts) {
        // Test with duplicate IDs - should handle gracefully
        const resultWithDuplicates = await testProducts({
            collectionIds: ['T_2', 'T_2', 'T_2'],
            groupByProduct: true,
        });

        // Should still return Plants collection products, de-duplicated
        expect(resultWithDuplicates.search.items.map(i => i.productName).sort()).toEqual([
            'Bonsai Tree',
            'Orchid',
            'Spiky Cactus',
        ]);

        // Test with non-existent collection ID - should return no results
        const resultNonExistent = await testProducts({
            collectionIds: ['T_999'],
            groupByProduct: true,
        });

        expect(resultNonExistent.search.items).toEqual([]);
        expect(resultNonExistent.search.totalItems).toBe(0);
    }

    async function testCollectionSlugsEdgeCases(testProducts: TestProducts) {
        // Test with duplicate slugs - should handle gracefully
        const resultWithDuplicates = await testProducts({
            collectionSlugs: ['plants', 'plants', 'plants'],
            groupByProduct: true,
        });

        // Should still return Plants collection products, de-duplicated
        expect(resultWithDuplicates.search.items.map(i => i.productName).sort()).toEqual([
            'Bonsai Tree',
            'Orchid',
            'Spiky Cactus',
        ]);

        // Test with non-existent collection slug - should return no results
        const resultNonExistent = await testProducts({
            collectionSlugs: ['non-existent'],
            groupByProduct: true,
        });

        expect(resultNonExistent.search.items).toEqual([]);
        expect(resultNonExistent.search.totalItems).toBe(0);
    }

    async function testSinglePrices(
        client: SimpleGraphQLClient,
        document:
            | typeof searchGetPricesDocument
            | typeof searchGetPricesShopDocument = searchGetPricesDocument,
    ) {
        const result = await client.query(document, {
            input: {
                groupByProduct: false,
                take: 3,
            },
        });

        expect(result.search.items).toEqual([
            {
                price: { value: 129900 },
                priceWithTax: { value: 155880 },
            },
            {
                price: { value: 139900 },
                priceWithTax: { value: 167880 },
            },
            {
                price: { value: 219900 },
                priceWithTax: { value: 263880 },
            },
        ]);
    }

    async function testPriceRanges(
        client: SimpleGraphQLClient,
        document:
            | typeof searchGetPricesDocument
            | typeof searchGetPricesShopDocument = searchGetPricesDocument,
    ) {
        const result = await client.query(document, {
            input: {
                groupByProduct: true,
                take: 3,
            },
        });

        expect(result.search.items).toEqual([
            {
                price: { min: 129900, max: 229900 },
                priceWithTax: { min: 155880, max: 275880 },
            },
            {
                price: { min: 14374, max: 16994 },
                priceWithTax: { min: 17249, max: 20393 },
            },
            {
                price: { min: 93120, max: 109995 },
                priceWithTax: { min: 111744, max: 131994 },
            },
        ]);
    }

    describe('shop api', () => {
        it('group by product', () => testGroupByProduct(testProductsShop));

        it('no grouping', () => testNoGrouping(testProductsShop));

        it('matches search term', () => testMatchSearchTerm(testProductsShop));

        it('matches partial search term', () => testMatchPartialSearchTerm(testProductsShop));

        // https://github.com/vendurehq/vendure/security/advisories/GHSA-9pp3-53p2-ww9v
        it('does not error when search term contains special characters', async () => {
            // A single quote in the search term should not cause a tsquery
            // syntax error on Postgres. On other DBs this is a no-op.
            const result = await testProductsShop({
                term: "laptop'",
                groupByProduct: true,
            });
            expect(result.search.totalItems).toBeDefined();
        });

        it('matches by facetId with AND operator', () => testMatchFacetIdsAnd(testProductsShop));

        it('matches by facetId with OR operator', () => testMatchFacetIdsOr(testProductsShop));

        it('matches by FacetValueFilters AND', () => testMatchFacetValueFiltersAnd(testProductsShop));

        it('matches by FacetValueFilters OR', () => testMatchFacetValueFiltersOr(testProductsShop));

        it('matches by FacetValueFilters OR and AND', () =>
            testMatchFacetValueFiltersOrWithAnd(testProductsShop));

        it('matches by FacetValueFilters with facetId OR operator', () =>
            testMatchFacetValueFiltersWithFacetIdsOr(testProductsShop));

        it('matches by FacetValueFilters with facetId AND operator', () =>
            testMatchFacetValueFiltersWithFacetIdsAnd(testProductsShop));

        it('matches by collectionId', () => testMatchCollectionId(testProductsShop));

        it('matches by collectionSlug', () => testMatchCollectionSlug(testProductsShop));

        it('matches by multiple collectionIds', () => testMatchCollectionIds(testProductsShop));

        it('matches by multiple collectionSlugs', () => testMatchCollectionSlugs(testProductsShop));

        it('handles collectionIds edge cases', () => testCollectionIdsEdgeCases(testProductsShop));

        it('handles collectionSlugs edge cases', () => testCollectionSlugsEdgeCases(testProductsShop));

        it('single prices', () => testSinglePrices(shopClient, searchGetPricesShopDocument));

        it('price ranges', () => testPriceRanges(shopClient, searchGetPricesShopDocument));

        it('returns correct facetValues when not grouped by product', async () => {
            const result = await shopClient.query(searchFacetValuesDocument, {
                input: {
                    groupByProduct: false,
                },
            });
            expect(result.search.facetValues).toEqual([
                { count: 21, facetValue: { id: 'T_1', name: 'electronics' } },
                { count: 17, facetValue: { id: 'T_2', name: 'computers' } },
                { count: 4, facetValue: { id: 'T_3', name: 'photo' } },
                { count: 10, facetValue: { id: 'T_4', name: 'sports equipment' } },
                { count: 3, facetValue: { id: 'T_5', name: 'home & garden' } },
                { count: 3, facetValue: { id: 'T_6', name: 'plants' } },
            ]);
        });

        it('returns correct facetValues when grouped by product', async () => {
            const result = await shopClient.query(searchFacetValuesDocument, {
                input: {
                    groupByProduct: true,
                },
            });
            expect(result.search.facetValues).toEqual([
                { count: 10, facetValue: { id: 'T_1', name: 'electronics' } },
                { count: 6, facetValue: { id: 'T_2', name: 'computers' } },
                { count: 4, facetValue: { id: 'T_3', name: 'photo' } },
                { count: 7, facetValue: { id: 'T_4', name: 'sports equipment' } },
                { count: 3, facetValue: { id: 'T_5', name: 'home & garden' } },
                { count: 3, facetValue: { id: 'T_6', name: 'plants' } },
            ]);
        });

        // https://github.com/vendurehq/vendure/issues/1236
        it('returns correct facetValues when not grouped by product, with search term', async () => {
            const result = await shopClient.query(searchFacetValuesDocument, {
                input: {
                    groupByProduct: false,
                    term: 'laptop',
                },
            });
            expect(result.search.facetValues).toEqual([
                { count: 4, facetValue: { id: 'T_1', name: 'electronics' } },
                { count: 4, facetValue: { id: 'T_2', name: 'computers' } },
            ]);
        });

        it('omits facetValues of private facets', async () => {
            const { createFacet } = await adminClient.query(createFacetDocument, {
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
            await adminClient.query(updateProductDocument, {
                input: {
                    id: 'T_2',
                    // T_1 & T_2 are the existing facetValues (electronics & photo)
                    facetValueIds: ['T_1', 'T_2', createFacet.values[0].id],
                },
            });

            await awaitRunningJobs(adminClient);

            const result = await shopClient.query(searchFacetValuesDocument, {
                input: {
                    groupByProduct: true,
                },
            });
            expect(result.search.facetValues).toEqual([
                { count: 10, facetValue: { id: 'T_1', name: 'electronics' } },
                { count: 6, facetValue: { id: 'T_2', name: 'computers' } },
                { count: 4, facetValue: { id: 'T_3', name: 'photo' } },
                { count: 7, facetValue: { id: 'T_4', name: 'sports equipment' } },
                { count: 3, facetValue: { id: 'T_5', name: 'home & garden' } },
                { count: 3, facetValue: { id: 'T_6', name: 'plants' } },
            ]);
        });

        it('returns correct collections when not grouped by product', async () => {
            const result = await shopClient.query(searchCollectionsDocument, {
                input: {
                    groupByProduct: false,
                },
            });
            expect(result.search.collections).toEqual([
                { collection: { id: 'T_2', name: 'Plants' }, count: 3 },
            ]);
        });

        it('returns correct collections when grouped by product', async () => {
            const result = await shopClient.query(searchCollectionsDocument, {
                input: {
                    groupByProduct: true,
                },
            });
            expect(result.search.collections).toEqual([
                { collection: { id: 'T_2', name: 'Plants' }, count: 3 },
            ]);
        });

        it('encodes the productId and productVariantId', async () => {
            const result = await shopClient.query(searchProductsShopDocument, {
                input: {
                    groupByProduct: false,
                    take: 1,
                },
            });
            expect(pick(result.search.items[0], ['productId', 'productVariantId'])).toEqual({
                productId: 'T_1',
                productVariantId: 'T_1',
            });
        });

        it('sort name with grouping', () => testSortingWithGrouping(testProductsShop, 'name'));

        it('sort price with grouping', () => testSortingWithGrouping(testProductsShop, 'price'));

        it('sort name without grouping', () => testSortingNoGrouping(testProductsShop, 'name'));

        it('sort price without grouping', () => testSortingNoGrouping(testProductsShop, 'price'));

        it('omits results for disabled ProductVariants', async () => {
            await adminClient.query(updateProductVariantsDocument, {
                input: [{ id: 'T_3', enabled: false }],
            });
            await awaitRunningJobs(adminClient);
            const result = await shopClient.query(searchProductsShopDocument, {
                input: {
                    groupByProduct: false,
                    take: 3,
                },
            });
            expect(result.search.items.map(i => i.productVariantId)).toEqual(['T_1', 'T_2', 'T_4']);
        });

        it('encodes collectionIds', async () => {
            const result = await shopClient.query(searchProductsShopDocument, {
                input: {
                    groupByProduct: false,
                    term: 'cactus',
                    take: 1,
                },
            });

            expect(result.search.items[0].collectionIds).toEqual(['T_2']);
        });

        it('inStock is false and not grouped by product', async () => {
            const result = await shopClient.query(searchProductsShopDocument, {
                input: {
                    groupByProduct: false,
                    inStock: false,
                },
            });
            expect(result.search.totalItems).toBe(2);
        });

        it('inStock is false and grouped by product', async () => {
            const result = await shopClient.query(searchProductsShopDocument, {
                input: {
                    groupByProduct: true,
                    inStock: false,
                },
            });
            expect(result.search.totalItems).toBe(1);
        });

        it('inStock is true and not grouped by product', async () => {
            const result = await shopClient.query(searchProductsShopDocument, {
                input: {
                    groupByProduct: false,
                    inStock: true,
                },
            });
            expect(result.search.totalItems).toBe(31);
        });

        it('inStock is true and grouped by product', async () => {
            const result = await shopClient.query(searchProductsShopDocument, {
                input: {
                    groupByProduct: true,
                    inStock: true,
                },
            });
            expect(result.search.totalItems).toBe(19);
        });

        it('inStock is undefined and not grouped by product', async () => {
            const result = await shopClient.query(searchProductsShopDocument, {
                input: {
                    groupByProduct: false,
                    inStock: undefined,
                },
            });
            expect(result.search.totalItems).toBe(33);
        });

        it('inStock is undefined and grouped by product', async () => {
            const result = await shopClient.query(searchProductsShopDocument, {
                input: {
                    groupByProduct: true,
                    inStock: undefined,
                },
            });
            expect(result.search.totalItems).toBe(20);
        });
    });

    describe('admin api', () => {
        it('group by product', () => testGroupByProduct(testProductsAdmin));

        it('no grouping', () => testNoGrouping(testProductsAdmin));

        it('matches search term', () => testMatchSearchTerm(testProductsAdmin));

        it('matches partial search term', () => testMatchPartialSearchTerm(testProductsAdmin));

        it('matches by facetId with AND operator', () => testMatchFacetIdsAnd(testProductsAdmin));

        it('matches by facetId with OR operator', () => testMatchFacetIdsOr(testProductsAdmin));

        it('matches by FacetValueFilters AND', () => testMatchFacetValueFiltersAnd(testProductsAdmin));

        it('matches by FacetValueFilters OR', () => testMatchFacetValueFiltersOr(testProductsAdmin));

        it('matches by FacetValueFilters OR and AND', () =>
            testMatchFacetValueFiltersOrWithAnd(testProductsAdmin));

        it('matches by FacetValueFilters with facetId OR operator', () =>
            testMatchFacetValueFiltersWithFacetIdsOr(testProductsAdmin));

        it('matches by FacetValueFilters with facetId AND operator', () =>
            testMatchFacetValueFiltersWithFacetIdsAnd(testProductsAdmin));

        it('matches by collectionId', () => testMatchCollectionId(testProductsAdmin));

        it('matches by collectionSlug', () => testMatchCollectionSlug(testProductsAdmin));

        it('matches by multiple collectionIds', () => testMatchCollectionIds(testProductsAdmin));

        it('matches by multiple collectionSlugs', () => testMatchCollectionSlugs(testProductsAdmin));

        it('handles collectionIds edge cases', () => testCollectionIdsEdgeCases(testProductsAdmin));

        it('handles collectionSlugs edge cases', () => testCollectionSlugsEdgeCases(testProductsAdmin));

        it('single prices', () => testSinglePrices(adminClient));

        it('price ranges', () => testPriceRanges(adminClient));

        it('sort name with grouping', () => testSortingWithGrouping(testProductsAdmin, 'name'));

        it('sort price with grouping', () => testSortingWithGrouping(testProductsAdmin, 'price'));

        it('sort name without grouping', () => testSortingNoGrouping(testProductsAdmin, 'name'));

        it('sort price without grouping', () => testSortingNoGrouping(testProductsAdmin, 'price'));

        describe('updating the index', () => {
            it('updates index when ProductVariants are changed', async () => {
                await awaitRunningJobs(adminClient);
                const { search } = await testProductsAdmin({ term: 'drive', groupByProduct: false });
                expect(search.items.map(i => i.sku)).toEqual([
                    'IHD455T1',
                    'IHD455T2',
                    'IHD455T3',
                    'IHD455T4',
                    'IHD455T6',
                ]);

                await adminClient.query(updateProductVariantsDocument, {
                    input: search.items.map(i => ({
                        id: i.productVariantId,
                        sku: i.sku + '_updated',
                    })),
                });

                await awaitRunningJobs(adminClient);
                const { search: search2 } = await testProductsAdmin({
                    term: 'drive',
                    groupByProduct: false,
                });

                expect(search2.items.map(i => i.sku)).toEqual([
                    'IHD455T1_updated',
                    'IHD455T2_updated',
                    'IHD455T3_updated',
                    'IHD455T4_updated',
                    'IHD455T6_updated',
                ]);
            });

            it('updates index when ProductVariants are deleted', async () => {
                await awaitRunningJobs(adminClient);
                const { search } = await testProductsAdmin({ term: 'drive', groupByProduct: false });

                const variantToDelete = search.items[0];
                expect(variantToDelete.sku).toBe('IHD455T1_updated');

                await adminClient.query(deleteProductVariantDocument, {
                    id: variantToDelete.productVariantId,
                });

                await awaitRunningJobs(adminClient);
                const { search: search2 } = await testProductsAdmin({
                    term: 'drive',
                    groupByProduct: false,
                });

                expect(search2.items.map(i => i.sku)).toEqual([
                    'IHD455T2_updated',
                    'IHD455T3_updated',
                    'IHD455T4_updated',
                    'IHD455T6_updated',
                ]);
            });

            it('updates index when a Product is changed', async () => {
                await adminClient.query(updateProductDocument, {
                    input: {
                        id: 'T_1',
                        facetValueIds: [],
                    },
                });
                await awaitRunningJobs(adminClient);
                const result = await testProductsAdmin({ facetValueIds: ['T_2'], groupByProduct: true });
                expect(result.search.items.map(i => i.productName)).toEqual([
                    'Curvy Monitor',
                    'Gaming PC',
                    'Hard Drive',
                    'Clacky Keyboard',
                    'USB Cable',
                ]);
            });

            it('updates index when a Product is deleted', async () => {
                const { search } = await testProductsAdmin({ facetValueIds: ['T_2'], groupByProduct: true });
                expect(search.items.map(i => i.productId)).toEqual(['T_2', 'T_3', 'T_4', 'T_5', 'T_6']);
                await adminClient.query(deleteProductDocument, {
                    id: 'T_5',
                });
                await awaitRunningJobs(adminClient);
                const { search: search2 } = await testProductsAdmin({
                    facetValueIds: ['T_2'],
                    groupByProduct: true,
                });
                expect(search2.items.map(i => i.productId)).toEqual(['T_2', 'T_3', 'T_4', 'T_6']);
            });

            it('updates index when a Collection is changed', async () => {
                await adminClient.query(updateCollectionDocument, {
                    input: {
                        id: 'T_2',
                        filters: [
                            {
                                code: facetValueCollectionFilter.code,
                                arguments: [
                                    {
                                        name: 'facetValueIds',
                                        value: '["T_4"]',
                                    },
                                    {
                                        name: 'containsAny',
                                        value: 'false',
                                    },
                                ],
                            },
                        ],
                    },
                });
                await awaitRunningJobs(adminClient);
                // add an additional check for the collection filters to update
                await awaitRunningJobs(adminClient);
                const result1 = await testProductsAdmin({ collectionId: 'T_2', groupByProduct: true });

                expect(result1.search.items.map(i => i.productName)).toEqual([
                    'Road Bike',
                    'Skipping Rope',
                    'Boxing Gloves',
                    'Tent',
                    'Cruiser Skateboard',
                    'Football',
                    'Running Shoe',
                ]);

                const result2 = await testProductsAdmin({ collectionSlug: 'plants', groupByProduct: true });

                expect(result2.search.items.map(i => i.productName)).toEqual([
                    'Road Bike',
                    'Skipping Rope',
                    'Boxing Gloves',
                    'Tent',
                    'Cruiser Skateboard',
                    'Football',
                    'Running Shoe',
                ]);
            }, 10000);

            it('updates index when a Collection created', async () => {
                const { createCollection } = await adminClient.query(createCollectionDocument, {
                    input: {
                        translations: [
                            {
                                languageCode: LanguageCode.en,
                                name: 'Photo',
                                description: '',
                                slug: 'photo',
                            },
                        ],
                        filters: [
                            {
                                code: facetValueCollectionFilter.code,
                                arguments: [
                                    {
                                        name: 'facetValueIds',
                                        value: '["T_3"]',
                                    },
                                    {
                                        name: 'containsAny',
                                        value: 'false',
                                    },
                                ],
                            },
                        ],
                    },
                });
                await awaitRunningJobs(adminClient);
                // add an additional check for the collection filters to update
                await awaitRunningJobs(adminClient);
                const result = await testProductsAdmin({
                    collectionId: createCollection.id,
                    groupByProduct: true,
                });
                expect(result.search.items.map(i => i.productName)).toEqual([
                    'Instant Camera',
                    'Camera Lens',
                    'Tripod',
                    'Slr Camera',
                ]);
            });

            it('updates index when a taxRate is changed', async () => {
                await adminClient.query(updateTaxRateDocument, {
                    input: {
                        // Default Channel's defaultTaxZone is Europe (id 2) and the id of the standard TaxRate
                        // to Europe is 2.
                        id: 'T_2',
                        value: 50,
                    },
                });
                await awaitRunningJobs(adminClient);
                const result = await adminClient.query(searchGetPricesDocument, {
                    input: {
                        groupByProduct: true,
                        term: 'laptop',
                    } as SearchInput,
                });
                expect(result.search.items).toEqual([
                    {
                        price: { min: 129900, max: 229900 },
                        priceWithTax: { min: 194850, max: 344850 },
                    },
                ]);
            });

            describe('asset changes', () => {
                function searchForLaptop() {
                    return adminClient.query(searchGetAssetsDocument, {
                        input: {
                            term: 'laptop',
                            take: 1,
                        },
                    });
                }

                it('updates index when asset focalPoint is changed', async () => {
                    const { search: search1 } = await searchForLaptop();

                    expect(search1.items[0].productAsset!.id).toBe('T_1');
                    expect(search1.items[0].productAsset!.focalPoint).toBeNull();

                    await adminClient.query(updateAssetDocument, {
                        input: {
                            id: 'T_1',
                            focalPoint: {
                                x: 0.42,
                                y: 0.42,
                            },
                        },
                    });

                    await awaitRunningJobs(adminClient);

                    const { search: search2 } = await searchForLaptop();

                    expect(search2.items[0].productAsset!.id).toBe('T_1');
                    expect(search2.items[0].productAsset!.focalPoint).toEqual({ x: 0.42, y: 0.42 });
                });

                it('updates index when asset deleted', async () => {
                    const { search: search1 } = await searchForLaptop();

                    const assetId = search1.items[0].productAsset?.id;
                    expect(assetId).toBeTruthy();

                    await adminClient.query(deleteAssetDocument, {
                        input: {
                            assetId: assetId!,
                            force: true,
                        },
                    });

                    await awaitRunningJobs(adminClient);

                    const { search: search2 } = await searchForLaptop();

                    expect(search2.items[0].productAsset).toBeNull();
                });

                it('updates index when asset is added to a ProductVariant', async () => {
                    const { search: search1 } = await searchForLaptop();

                    expect(search1.items[0].productVariantAsset).toBeNull();

                    await adminClient.query(updateProductVariantsDocument, {
                        input: search1.items.map(item => ({
                            id: item.productVariantId,
                            featuredAssetId: 'T_2',
                        })),
                    });

                    await awaitRunningJobs(adminClient);

                    const { search: search2 } = await searchForLaptop();

                    expect(search2.items[0].productVariantAsset!.id).toBe('T_2');
                });
            });

            it('does not include deleted ProductVariants in index', async () => {
                const { search: s1 } = await testProductsAdmin({
                    term: 'hard drive',
                    groupByProduct: false,
                });

                await adminClient.query(deleteProductVariantDocument, {
                    id: s1.items[0].productVariantId,
                });

                await awaitRunningJobs(adminClient);

                const { search } = await adminClient.query(searchGetPricesDocument, {
                    input: { term: 'hard drive', groupByProduct: true },
                });
                expect(search.items[0].price).toEqual({
                    min: 7896,
                    max: 13435,
                });
            });

            it('returns enabled field when not grouped', async () => {
                const result = await testProductsAdmin({ groupByProduct: false, take: 3 });
                expect(result.search.items.map(pick(['productVariantId', 'enabled']))).toEqual([
                    { productVariantId: 'T_1', enabled: true },
                    { productVariantId: 'T_2', enabled: true },
                    { productVariantId: 'T_3', enabled: false },
                ]);
            });

            it('when grouped, enabled is true if at least one variant is enabled', async () => {
                await adminClient.query(updateProductVariantsDocument, {
                    input: [
                        { id: 'T_1', enabled: false },
                        { id: 'T_2', enabled: false },
                    ],
                });
                await awaitRunningJobs(adminClient);
                const result = await testProductsAdmin({ groupByProduct: true, take: 3 });
                expect(result.search.items.map(pick(['productId', 'enabled']))).toEqual([
                    { productId: 'T_1', enabled: true },
                    { productId: 'T_2', enabled: true },
                    { productId: 'T_3', enabled: true },
                ]);
            });

            it('when grouped, enabled is false if all variants are disabled', async () => {
                await adminClient.query(updateProductVariantsDocument, {
                    input: [{ id: 'T_4', enabled: false }],
                });
                await awaitRunningJobs(adminClient);
                const result = await testProductsAdmin({ groupByProduct: true, take: 3 });
                expect(result.search.items.map(pick(['productId', 'enabled']))).toEqual([
                    { productId: 'T_1', enabled: false },
                    { productId: 'T_2', enabled: true },
                    { productId: 'T_3', enabled: true },
                ]);
            });

            it('when grouped, enabled is false if product is disabled', async () => {
                await adminClient.query(updateProductDocument, {
                    input: {
                        id: 'T_3',
                        enabled: false,
                    },
                });
                await awaitRunningJobs(adminClient);
                const result = await testProductsAdmin({ groupByProduct: true, take: 3 });
                expect(result.search.items.map(pick(['productId', 'enabled']))).toEqual([
                    { productId: 'T_1', enabled: false },
                    { productId: 'T_2', enabled: true },
                    { productId: 'T_3', enabled: false },
                ]);
            });

            // https://github.com/vendurehq/vendure/issues/295
            it('enabled status survives reindex', async () => {
                await adminClient.query(reindexDocument);

                await awaitRunningJobs(adminClient);
                const result = await testProductsAdmin({ groupByProduct: true, take: 3 });
                expect(result.search.items.map(pick(['productId', 'enabled']))).toEqual([
                    { productId: 'T_1', enabled: false },
                    { productId: 'T_2', enabled: true },
                    { productId: 'T_3', enabled: false },
                ]);
            });

            // https://github.com/vendurehq/vendure/issues/1482
            it('price range omits disabled variant', async () => {
                const result1 = await shopClient.query(searchGetPricesShopDocument, {
                    input: {
                        groupByProduct: true,
                        term: 'monitor',
                        take: 3,
                    } as SearchInput,
                });
                expect(result1.search.items).toEqual([
                    {
                        price: { min: 14374, max: 16994 },
                        priceWithTax: { min: 21561, max: 25491 },
                    },
                ]);
                await adminClient.query(updateProductVariantsDocument, {
                    input: [{ id: 'T_5', enabled: false }],
                });
                await awaitRunningJobs(adminClient);

                const result2 = await shopClient.query(searchGetPricesShopDocument, {
                    input: {
                        groupByProduct: true,
                        term: 'monitor',
                        take: 3,
                    } as SearchInput,
                });
                expect(result2.search.items).toEqual([
                    {
                        price: { min: 16994, max: 16994 },
                        priceWithTax: { min: 25491, max: 25491 },
                    },
                ]);
            });

            // https://github.com/vendurehq/vendure/issues/745
            it('very long Product descriptions no not cause indexing to fail', async () => {
                // We generate this long string out of random chars because Postgres uses compression
                // when storing the string value, so e.g. a long series of a single character will not
                // reproduce the error.
                const description = Array.from({ length: 220 })
                    .map(() => Math.random().toString(36))
                    .join(' ');

                const { createProduct } = await adminClient.query(createProductDocument, {
                    input: {
                        translations: [
                            {
                                languageCode: LanguageCode.en,
                                name: 'Very long description aabbccdd',
                                slug: 'very-long-description',
                                description,
                            },
                        ],
                    },
                });
                await adminClient.query(createProductVariantsDocument, {
                    input: [
                        {
                            productId: createProduct.id,
                            sku: 'VLD01',
                            price: 100,
                            translations: [
                                { languageCode: LanguageCode.en, name: 'Very long description variant' },
                            ],
                        },
                    ],
                });
                await awaitRunningJobs(adminClient);
                const result = await testProductsAdmin({ term: 'aabbccdd' });
                expect(result.search.items.map(i => i.productName)).toEqual([
                    'Very long description aabbccdd',
                ]);
                await adminClient.query(deleteProductDocument, {
                    id: createProduct.id,
                });
            });
        });

        // https://github.com/vendurehq/vendure/issues/609
        describe('Synthetic index items', () => {
            let createdProductId: string;

            it('creates synthetic index item for Product with no variants', async () => {
                const { createProduct } = await adminClient.query(createProductDocument, {
                    input: {
                        facetValueIds: ['T_1'],
                        translations: [
                            {
                                languageCode: LanguageCode.en,
                                name: 'Strawberry cheesecake',
                                slug: 'strawberry-cheesecake',
                                description: 'A yummy dessert',
                            },
                        ],
                    },
                });

                await awaitRunningJobs(adminClient);
                const result = await testProductsAdmin({ groupByProduct: true, term: 'strawberry' });
                expect(
                    result.search.items.map(
                        pick([
                            'productId',
                            'enabled',
                            'productName',
                            'productVariantName',
                            'slug',
                            'description',
                        ]),
                    ),
                ).toEqual([
                    {
                        productId: createProduct.id,
                        enabled: false,
                        productName: 'Strawberry cheesecake',
                        productVariantName: 'Strawberry cheesecake',
                        slug: 'strawberry-cheesecake',
                        description: 'A yummy dessert',
                    },
                ]);
                createdProductId = createProduct.id;
            });

            it('removes synthetic index item once a variant is created', async () => {
                await adminClient.query(createProductVariantsDocument, {
                    input: [
                        {
                            productId: createdProductId,
                            sku: 'SC01',
                            price: 1399,
                            translations: [
                                { languageCode: LanguageCode.en, name: 'Strawberry Cheesecake Pie' },
                            ],
                        },
                    ],
                });
                await awaitRunningJobs(adminClient);

                const result = await testProductsAdmin({ groupByProduct: false, term: 'strawberry' });
                expect(result.search.items.map(pick(['productVariantName']))).toEqual([
                    { productVariantName: 'Strawberry Cheesecake Pie' },
                ]);
            });
        });

        // https://github.com/vendurehq/vendure/issues/4805
        describe('duplicate index writes', () => {
            async function getFailedJobsCount(): Promise<number> {
                const { jobs } = await adminClient.query(getRunningJobsDocument, {
                    options: { filter: { state: { eq: JobState.FAILED } } },
                });
                return jobs.totalItems;
            }

            it('indexes a second Product with no variants without failing the update job', async () => {
                const failedJobsBefore = await getFailedJobsCount();
                await adminClient.query(createProductDocument, {
                    input: {
                        translations: [
                            {
                                languageCode: LanguageCode.en,
                                name: 'Bread pudding',
                                slug: 'bread-pudding',
                                description: 'A variant-less product',
                            },
                        ],
                    },
                });
                await adminClient.query(createProductDocument, {
                    input: {
                        translations: [
                            {
                                languageCode: LanguageCode.en,
                                name: 'Rice pudding',
                                slug: 'rice-pudding',
                                description: 'Another variant-less product',
                            },
                        ],
                    },
                });
                await awaitRunningJobs(adminClient);

                const failedJobsAfter = await getFailedJobsCount();
                const result = await testProductsAdmin({ groupByProduct: true, term: 'pudding' });
                expect(failedJobsAfter - failedJobsBefore).toBe(0);
                expect(result.search.items.map(i => i.productName)).toContain('Rice pudding');
            });

            it('reindex converges to identical results when run twice', async () => {
                const byVariantId = (
                    items: Array<{ productVariantId: string; productId: string }>,
                ): Array<{ productVariantId: string; productId: string }> =>
                    [...items].sort(
                        (a, b) =>
                            a.productVariantId.localeCompare(b.productVariantId) ||
                            a.productId.localeCompare(b.productId),
                    );

                await adminClient.query(reindexDocument);
                await awaitRunningJobs(adminClient);
                const firstResult = await testProductsAdmin({ groupByProduct: false, take: 100 });

                await adminClient.query(reindexDocument);
                await awaitRunningJobs(adminClient);
                const secondResult = await testProductsAdmin({ groupByProduct: false, take: 100 });

                expect(secondResult.search.totalItems).toBe(firstResult.search.totalItems);
                expect(byVariantId(secondResult.search.items)).toEqual(byVariantId(firstResult.search.items));
            });
        });

        describe('channel handling', () => {
            const SECOND_CHANNEL_TOKEN = 'second-channel-token';
            let secondChannel: FragmentOf<typeof channelFragment>;

            beforeAll(async () => {
                const { createChannel } = await adminClient.query(createChannelDocument, {
                    input: {
                        code: 'second-channel',
                        token: SECOND_CHANNEL_TOKEN,
                        defaultLanguageCode: LanguageCode.en,
                        availableLanguageCodes: [LanguageCode.en, LanguageCode.de, LanguageCode.zh],
                        currencyCode: CurrencyCode.GBP,
                        pricesIncludeTax: true,
                        defaultTaxZoneId: 'T_1',
                        defaultShippingZoneId: 'T_1',
                    },
                });
                const channelGuard: ErrorResultGuard<FragmentOf<typeof channelFragment>> =
                    createErrorResultGuard(input => !!input && !('errorCode' in input));
                channelGuard.assertSuccess(createChannel);
                secondChannel = createChannel;
            });

            it('assign product to channel', async () => {
                adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
                await adminClient.query(assignProductToChannelDocument, {
                    input: { channelId: secondChannel.id, productIds: ['T_1', 'T_2'] },
                });
                await awaitRunningJobs(adminClient);

                adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
                const { search } = await testProductsAdmin({ groupByProduct: true });
                expect(search.items.map(i => i.productId)).toEqual(['T_1', 'T_2']);
            }, 10000);

            it('removing product from channel', async () => {
                adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
                await adminClient.query(removeProductFromChannelDocument, {
                    input: {
                        productIds: ['T_2'],
                        channelId: secondChannel.id,
                    },
                });
                await awaitRunningJobs(adminClient);

                adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
                const { search } = await testProductsAdmin({ groupByProduct: true });
                expect(search.items.map(i => i.productId)).toEqual(['T_1']);
            }, 10000);

            it('assign product variant to channel', async () => {
                adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
                await adminClient.query(assignProductVariantToChannelDocument, {
                    input: { channelId: secondChannel.id, productVariantIds: ['T_10', 'T_15'] },
                });
                await awaitRunningJobs(adminClient);

                adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);

                const { search: searchGrouped } = await testProductsAdmin({ groupByProduct: true });
                expect(searchGrouped.items.map(i => i.productId)).toEqual(['T_1', 'T_3', 'T_4']);

                const { search: searchUngrouped } = await testProductsAdmin({ groupByProduct: false });
                expect(searchUngrouped.items.map(i => i.productVariantId)).toEqual([
                    'T_1',
                    'T_2',
                    'T_3',
                    'T_4',
                    'T_10',
                    'T_15',
                ]);
            }, 10000);

            it('removing product variant from channel', async () => {
                adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
                await adminClient.query(removeProductVariantFromChannelDocument, {
                    input: { channelId: secondChannel.id, productVariantIds: ['T_1', 'T_15'] },
                });
                await awaitRunningJobs(adminClient);

                adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);

                const { search: searchGrouped } = await testProductsAdmin({ groupByProduct: true });
                expect(searchGrouped.items.map(i => i.productId)).toEqual(['T_1', 'T_3']);

                const { search: searchUngrouped } = await testProductsAdmin({ groupByProduct: false });
                expect(searchUngrouped.items.map(i => i.productVariantId)).toEqual([
                    'T_2',
                    'T_3',
                    'T_4',
                    'T_10',
                ]);
            }, 10000);

            it('updating product affects current channel', async () => {
                adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
                await adminClient.query(updateProductDocument, {
                    input: {
                        id: 'T_3',
                        enabled: true,
                        translations: [{ languageCode: LanguageCode.en, name: 'xyz' }],
                    },
                });

                await awaitRunningJobs(adminClient);

                const { search: searchGrouped } = await testProductsAdmin({
                    groupByProduct: true,
                    term: 'xyz',
                });
                expect(searchGrouped.items.map(i => i.productName)).toEqual(['xyz']);
            });

            it('updating product affects other channels', async () => {
                adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
                const { search: searchGrouped } = await testProductsAdmin({
                    groupByProduct: true,
                    term: 'xyz',
                });
                expect(searchGrouped.items.map(i => i.productName)).toEqual(['xyz']);
            });

            // https://github.com/vendurehq/vendure/issues/896
            it('removing from channel with multiple languages', async () => {
                adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);

                await adminClient.query(updateProductDocument, {
                    input: {
                        id: 'T_4',
                        translations: [
                            {
                                languageCode: LanguageCode.en,
                                name: 'product en',
                                slug: 'product-en',
                                description: 'en',
                            },
                            {
                                languageCode: LanguageCode.de,
                                name: 'product de',
                                slug: 'product-de',
                                description: 'de',
                            },
                        ],
                    },
                });

                await adminClient.query(assignProductToChannelDocument, {
                    input: { channelId: secondChannel.id, productIds: ['T_4'] },
                });
                await awaitRunningJobs(adminClient);

                async function searchSecondChannelForDEProduct() {
                    adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
                    const { search } = await adminClient.query(
                        searchProductsAdminDocument,
                        {
                            input: { term: 'product', groupByProduct: true },
                        },
                        { languageCode: LanguageCode.de },
                    );
                    return search;
                }

                const search1 = await searchSecondChannelForDEProduct();
                expect(search1.items.map(i => i.productName)).toEqual(['product de']);

                adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
                await adminClient.query(removeProductFromChannelDocument, {
                    input: {
                        productIds: ['T_4'],
                        channelId: secondChannel.id,
                    },
                });
                await awaitRunningJobs(adminClient);

                const search2 = await searchSecondChannelForDEProduct();
                expect(search2.items.map(i => i.productName)).toEqual([]);
            });
        });

        describe('multiple language handling', () => {
            beforeAll(async () => {
                adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);

                await adminClient.query(updateChannelDocument, {
                    input: {
                        id: 'T_1',
                        availableLanguageCodes: [LanguageCode.en, LanguageCode.de, LanguageCode.zh],
                    },
                });

                const { updateProduct } = await adminClient.query(updateProductDocument, {
                    input: {
                        id: 'T_1',
                        translations: [
                            {
                                languageCode: LanguageCode.en,
                                name: 'Laptop en',
                                slug: 'laptop-slug-en',
                                description: 'Laptop description en',
                            },
                            {
                                languageCode: LanguageCode.de,
                                name: 'Laptop de',
                                slug: 'laptop-slug-de',
                                description: 'Laptop description de',
                            },
                            {
                                languageCode: LanguageCode.zh,
                                name: 'Laptop zh',
                                slug: 'laptop-slug-zh',
                                description: 'Laptop description zh',
                            },
                        ],
                    },
                });

                expect(updateProduct.variants.length).toEqual(4);

                await adminClient.query(updateProductVariantsDocument, {
                    input: [
                        {
                            id: updateProduct.variants[0].id,
                            translations: [
                                {
                                    languageCode: LanguageCode.en,
                                    name: 'Laptop variant T_1 en',
                                },
                                {
                                    languageCode: LanguageCode.de,
                                    name: 'Laptop variant T_1 de',
                                },
                                {
                                    languageCode: LanguageCode.zh,
                                    name: 'Laptop variant T_1 zh',
                                },
                            ],
                        },
                        {
                            id: updateProduct.variants[1].id,
                            translations: [
                                {
                                    languageCode: LanguageCode.en,
                                    name: 'Laptop variant T_2 en',
                                },
                                {
                                    languageCode: LanguageCode.de,
                                    name: 'Laptop variant T_2 de',
                                },
                            ],
                        },
                        {
                            id: updateProduct.variants[2].id,
                            translations: [
                                {
                                    languageCode: LanguageCode.en,
                                    name: 'Laptop variant T_3 en',
                                },
                                {
                                    languageCode: LanguageCode.zh,
                                    name: 'Laptop variant T_3 zh',
                                },
                            ],
                        },
                        {
                            id: updateProduct.variants[3].id,
                            translations: [
                                {
                                    languageCode: LanguageCode.en,
                                    name: 'Laptop variant T_4 en',
                                },
                            ],
                        },
                    ],
                });

                await awaitRunningJobs(adminClient);
            });

            describe('search products', () => {
                function searchInLanguage(languageCode: LanguageCode) {
                    return adminClient.query(
                        searchProductsAdminDocument,
                        {
                            input: {
                                take: 100,
                            },
                        },
                        {
                            languageCode,
                        },
                    );
                }

                it('fallbacks to default language en', async () => {
                    const { search } = await searchInLanguage(LanguageCode.af);

                    const laptopVariants = search.items.filter(i => i.productId === 'T_1');
                    expect(laptopVariants.length).toEqual(4);

                    const laptopVariantT1 = laptopVariants.find(i => i.productVariantId === 'T_1');
                    expect(laptopVariantT1?.productVariantName).toEqual('Laptop variant T_1 en');
                    expect(laptopVariantT1?.productName).toEqual('Laptop en');
                    expect(laptopVariantT1?.slug).toEqual('laptop-slug-en');
                    expect(laptopVariantT1?.description).toEqual('Laptop description en');

                    const laptopVariantT2 = laptopVariants.find(i => i.productVariantId === 'T_2');
                    expect(laptopVariantT2?.productVariantName).toEqual('Laptop variant T_2 en');
                    expect(laptopVariantT2?.productName).toEqual('Laptop en');
                    expect(laptopVariantT2?.slug).toEqual('laptop-slug-en');
                    expect(laptopVariantT2?.description).toEqual('Laptop description en');

                    const laptopVariantT3 = laptopVariants.find(i => i.productVariantId === 'T_3');
                    expect(laptopVariantT3?.productVariantName).toEqual('Laptop variant T_3 en');
                    expect(laptopVariantT3?.productName).toEqual('Laptop en');
                    expect(laptopVariantT3?.slug).toEqual('laptop-slug-en');
                    expect(laptopVariantT3?.description).toEqual('Laptop description en');

                    const laptopVariantT4 = laptopVariants.find(i => i.productVariantId === 'T_4');
                    expect(laptopVariantT4?.productVariantName).toEqual('Laptop variant T_4 en');
                    expect(laptopVariantT4?.productName).toEqual('Laptop en');
                    expect(laptopVariantT4?.slug).toEqual('laptop-slug-en');
                    expect(laptopVariantT4?.description).toEqual('Laptop description en');
                });

                it('indexes non-default language de when it is available language of channel', async () => {
                    const { search } = await searchInLanguage(LanguageCode.de);

                    const laptopVariants = search.items.filter(i => i.productId === 'T_1');
                    expect(laptopVariants.length).toEqual(4);

                    const laptopVariantT1 = laptopVariants.find(i => i.productVariantId === 'T_1');
                    expect(laptopVariantT1?.productVariantName).toEqual('Laptop variant T_1 de');
                    expect(laptopVariantT1?.productName).toEqual('Laptop de');
                    expect(laptopVariantT1?.slug).toEqual('laptop-slug-de');
                    expect(laptopVariantT1?.description).toEqual('Laptop description de');

                    const laptopVariantT2 = laptopVariants.find(i => i.productVariantId === 'T_2');
                    expect(laptopVariantT2?.productVariantName).toEqual('Laptop variant T_2 de');
                    expect(laptopVariantT2?.productName).toEqual('Laptop de');
                    expect(laptopVariantT2?.slug).toEqual('laptop-slug-de');
                    expect(laptopVariantT2?.description).toEqual('Laptop description de');

                    const laptopVariantT3 = laptopVariants.find(i => i.productVariantId === 'T_3');
                    expect(laptopVariantT3?.productVariantName).toEqual('Laptop variant T_3 en');
                    expect(laptopVariantT3?.productName).toEqual('Laptop de');
                    expect(laptopVariantT3?.slug).toEqual('laptop-slug-de');
                    expect(laptopVariantT3?.description).toEqual('Laptop description de');

                    const laptopVariantT4 = laptopVariants.find(i => i.productVariantId === 'T_4');
                    expect(laptopVariantT4?.productVariantName).toEqual('Laptop variant T_4 en');
                    expect(laptopVariantT4?.productName).toEqual('Laptop de');
                    expect(laptopVariantT4?.slug).toEqual('laptop-slug-de');
                    expect(laptopVariantT4?.description).toEqual('Laptop description de');
                });

                it('indexes non-default language zh when it is available language of channel', async () => {
                    const { search } = await searchInLanguage(LanguageCode.zh);

                    const laptopVariants = search.items.filter(i => i.productId === 'T_1');
                    expect(laptopVariants.length).toEqual(4);

                    const laptopVariantT1 = laptopVariants.find(i => i.productVariantId === 'T_1');
                    expect(laptopVariantT1?.productVariantName).toEqual('Laptop variant T_1 zh');
                    expect(laptopVariantT1?.productName).toEqual('Laptop zh');
                    expect(laptopVariantT1?.slug).toEqual('laptop-slug-zh');
                    expect(laptopVariantT1?.description).toEqual('Laptop description zh');

                    const laptopVariantT2 = laptopVariants.find(i => i.productVariantId === 'T_2');
                    expect(laptopVariantT2?.productVariantName).toEqual('Laptop variant T_2 en');
                    expect(laptopVariantT2?.productName).toEqual('Laptop zh');
                    expect(laptopVariantT2?.slug).toEqual('laptop-slug-zh');
                    expect(laptopVariantT2?.description).toEqual('Laptop description zh');

                    const laptopVariantT3 = laptopVariants.find(i => i.productVariantId === 'T_3');
                    expect(laptopVariantT3?.productVariantName).toEqual('Laptop variant T_3 zh');
                    expect(laptopVariantT3?.productName).toEqual('Laptop zh');
                    expect(laptopVariantT3?.slug).toEqual('laptop-slug-zh');
                    expect(laptopVariantT3?.description).toEqual('Laptop description zh');

                    const laptopVariantT4 = laptopVariants.find(i => i.productVariantId === 'T_4');
                    expect(laptopVariantT4?.productVariantName).toEqual('Laptop variant T_4 en');
                    expect(laptopVariantT4?.productName).toEqual('Laptop zh');
                    expect(laptopVariantT4?.slug).toEqual('laptop-slug-zh');
                    expect(laptopVariantT4?.description).toEqual('Laptop description zh');
                });
            });

            describe('search products grouped by product and sorted by name ASC', () => {
                function searchInLanguage(languageCode: LanguageCode) {
                    return adminClient.query(
                        searchProductsAdminDocument,
                        {
                            input: {
                                groupByProduct: true,
                                take: 100,
                                sort: {
                                    name: SortOrder.ASC,
                                },
                            },
                        },
                        {
                            languageCode,
                        },
                    );
                }

                // https://github.com/vendurehq/vendure/issues/1752
                // https://github.com/vendurehq/vendure/issues/1746
                it('fallbacks to default language en', async () => {
                    const { search } = await searchInLanguage(LanguageCode.af);

                    const productNames = [
                        'Bonsai Tree',
                        'Boxing Gloves',
                        'Camera Lens',
                        'Cruiser Skateboard',
                        'Curvy Monitor',
                        'Football',
                        'Gaming PC',
                        'Instant Camera',
                        'Laptop en', // fallback language en
                        'Orchid',
                        'product en', // fallback language en
                        'Road Bike',
                        'Running Shoe',
                        'Skipping Rope',
                        'Slr Camera',
                        'Spiky Cactus',
                        'Strawberry cheesecake',
                        'Tent',
                        'Tripod',
                        'USB Cable',
                    ];

                    expect(search.items.map(i => i.productName)).toEqual(productNames);
                });

                it('indexes non-default language de', async () => {
                    const { search } = await searchInLanguage(LanguageCode.de);

                    const productNames = [
                        'Bonsai Tree',
                        'Boxing Gloves',
                        'Camera Lens',
                        'Cruiser Skateboard',
                        'Curvy Monitor',
                        'Football',
                        'Gaming PC',
                        'Instant Camera',
                        'Laptop de', // language de
                        'Orchid',
                        'product de', // language de
                        'Road Bike',
                        'Running Shoe',
                        'Skipping Rope',
                        'Slr Camera',
                        'Spiky Cactus',
                        'Strawberry cheesecake',
                        'Tent',
                        'Tripod',
                        'USB Cable',
                    ];

                    expect(search.items.map(i => i.productName)).toEqual(productNames);
                });

                it('indexes non-default language zh', async () => {
                    const { search } = await searchInLanguage(LanguageCode.zh);

                    const productNames = [
                        'Bonsai Tree',
                        'Boxing Gloves',
                        'Camera Lens',
                        'Cruiser Skateboard',
                        'Curvy Monitor',
                        'Football',
                        'Gaming PC',
                        'Instant Camera',
                        'Laptop zh', // language zh
                        'Orchid',
                        'product en', // fallback language en
                        'Road Bike',
                        'Running Shoe',
                        'Skipping Rope',
                        'Slr Camera',
                        'Spiky Cactus',
                        'Strawberry cheesecake',
                        'Tent',
                        'Tripod',
                        'USB Cable',
                    ];

                    expect(search.items.map(i => i.productName)).toEqual(productNames);
                });
            });
        });

        // https://github.com/vendurehq/vendure/issues/1789
        describe('input escaping', () => {
            function search(term: string) {
                return adminClient.query(
                    searchProductsAdminDocument,
                    {
                        input: { take: 10, term },
                    },
                    {
                        languageCode: LanguageCode.en,
                    },
                );
            }
            it('correctly escapes "a & b"', async () => {
                const result = await search('laptop & camera');
                expect(result.search.items).toBeDefined();
            });

            it('correctly escapes other special chars', async () => {
                const result = await search('a : b ? * (c) ! "foo"');
                expect(result.search.items).toBeDefined();
            });

            it('correctly escapes mysql binary mode chars', async () => {
                expect((await search('foo+')).search.items).toBeDefined();
                expect((await search('foo-')).search.items).toBeDefined();
                expect((await search('foo<')).search.items).toBeDefined();
                expect((await search('foo>')).search.items).toBeDefined();
                expect((await search('foo*')).search.items).toBeDefined();
                expect((await search('foo~')).search.items).toBeDefined();
                expect((await search('foo@bar')).search.items).toBeDefined();
                expect((await search('foo + - *')).search.items).toBeDefined();
                expect((await search('foo + - bar')).search.items).toBeDefined();
            });
        });
    });

    // https://github.com/vendurehq/community-plugins/issues/1
    describe('multi-channel productInStock cache', () => {
        const STOCK_CHANNEL_TOKEN = 'stock-test-channel-token';
        let stockTestChannelId: string;
        let testProductId: string;

        beforeAll(async () => {
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            await adminClient.asSuperAdmin();

            // Create a second channel for testing stock isolation
            const { createChannel } = await adminClient.query(createChannelDocument, {
                input: {
                    code: 'stock-test-channel',
                    token: STOCK_CHANNEL_TOKEN,
                    defaultLanguageCode: LanguageCode.en,
                    currencyCode: CurrencyCode.GBP,
                    pricesIncludeTax: true,
                    defaultTaxZoneId: 'T_2',
                    defaultShippingZoneId: 'T_1',
                },
            });
            const channelGuard: ErrorResultGuard<FragmentOf<typeof channelFragment>> = createErrorResultGuard(
                input => !!input && !('errorCode' in input),
            );
            channelGuard.assertSuccess(createChannel);
            stockTestChannelId = createChannel.id;

            // Create a product with a variant that has stock in the default channel
            const { createProduct } = await adminClient.query(createProductDocument, {
                input: {
                    translations: [
                        {
                            languageCode: LanguageCode.en,
                            name: 'Stock Test Product',
                            slug: 'stock-test-product',
                            description: 'A product for testing multi-channel stock',
                        },
                    ],
                },
            });
            testProductId = createProduct.id;

            await adminClient.query(createProductVariantsDocument, {
                input: [
                    {
                        productId: testProductId,
                        sku: 'STOCK-TEST-1',
                        price: 1000,
                        stockOnHand: 100,
                        trackInventory: GlobalFlag.TRUE,
                        translations: [{ languageCode: LanguageCode.en, name: 'Stock Test Variant' }],
                    },
                ],
            });
            await awaitRunningJobs(adminClient);

            // Assign the product to the second channel (no stock location there)
            await adminClient.query(assignProductToChannelDocument, {
                input: { channelId: stockTestChannelId, productIds: [testProductId] },
            });
            await awaitRunningJobs(adminClient);

            // Reindex default channel first
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            await adminClient.query(reindexDocument);
            await awaitRunningJobs(adminClient);

            // Reindex the second channel
            adminClient.setChannelToken(STOCK_CHANNEL_TOKEN);
            await adminClient.query(reindexDocument);
            await awaitRunningJobs(adminClient);

            // Reset admin token after reindexing second channel
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        });

        it('product is inStock in default channel', async () => {
            shopClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const result = await shopClient.query(searchProductsShopDocument, {
                input: {
                    term: 'Stock Test Product',
                    groupByProduct: true,
                    inStock: true,
                },
            });
            expect(result.search.items.map(i => i.productName)).toContain('Stock Test Product');
        });

        it('product is NOT inStock in second channel (no stock location)', async () => {
            shopClient.setChannelToken(STOCK_CHANNEL_TOKEN);
            const result = await shopClient.query(searchProductsShopDocument, {
                input: {
                    term: 'Stock Test Product',
                    groupByProduct: true,
                    inStock: true,
                },
            });
            expect(result.search.items.map(i => i.productName)).not.toContain('Stock Test Product');
        });

        it('product appears when filtering inStock: false in second channel', async () => {
            shopClient.setChannelToken(STOCK_CHANNEL_TOKEN);
            const result = await shopClient.query(searchProductsShopDocument, {
                input: {
                    term: 'Stock Test Product',
                    groupByProduct: true,
                    inStock: false,
                },
            });
            expect(result.search.items.map(i => i.productName)).toContain('Stock Test Product');
        });

        afterAll(() => {
            shopClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        });
    });
});
